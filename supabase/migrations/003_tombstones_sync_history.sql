create extension if not exists pgcrypto;

-- FlightLog v1.8/v1.9 sync safety migration.
-- Run this after 001_cloud_backups.sql and 002_cloud_sync_lite.sql.
-- Existing cloud_backups rows are not changed. Existing synced_records rows remain valid.

alter table public.synced_records
  add column if not exists deleted_by_device_id text,
  add column if not exists delete_reason text,
  add column if not exists tombstone_version integer not null default 1,
  add column if not exists last_operation text not null default 'update';

alter table public.synced_records
  drop constraint if exists synced_records_last_operation_check;

alter table public.synced_records
  add constraint synced_records_last_operation_check
  check (last_operation in ('create', 'update', 'delete', 'restore'));

comment on column public.synced_records.deleted_at is
  'When set, this record is a FlightLog tombstone. Normal sync keeps the row instead of hard-deleting it.';
comment on column public.synced_records.deleted_by_device_id is
  'FlightLog local device id that created the tombstone, when known.';
comment on column public.synced_records.delete_reason is
  'User-visible reason or operation label for the tombstone.';
comment on column public.synced_records.tombstone_version is
  'Client tombstone metadata version for future-compatible deletion semantics.';
comment on column public.synced_records.last_operation is
  'Latest sync operation represented by this row: create, update, delete, or restore.';

create index if not exists synced_records_user_idx
  on public.synced_records (user_id);

create index if not exists synced_records_entity_idx
  on public.synced_records (entity_type);

create index if not exists synced_records_local_id_idx
  on public.synced_records (local_id);

create index if not exists synced_records_updated_idx
  on public.synced_records (updated_at desc);

create index if not exists synced_records_deleted_idx
  on public.synced_records (deleted_at)
  where deleted_at is not null;

create index if not exists synced_records_user_deleted_idx
  on public.synced_records (user_id, deleted_at desc)
  where deleted_at is not null;

create table if not exists public.sync_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'compare',
    'push',
    'pull',
    'conflict_resolve',
    'backup_before_sync',
    'tombstone_push',
    'tombstone_pull',
    'device_register',
    'error'
  )),
  device_id text,
  summary jsonb,
  created_at timestamptz not null default now()
);

comment on table public.sync_events is
  'FlightLog sync history events. Summaries must not contain secrets, auth tokens, or provider API keys.';

create index if not exists sync_events_user_created_idx
  on public.sync_events (user_id, created_at desc);

create index if not exists sync_events_user_type_idx
  on public.sync_events (user_id, event_type);

create table if not exists public.sync_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_name text,
  last_seen_at timestamptz,
  last_sync_event_at timestamptz,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);

comment on table public.sync_devices is
  'FlightLog browser/device registry for manual Sync Lite workflows.';

create index if not exists sync_devices_user_last_seen_idx
  on public.sync_devices (user_id, last_seen_at desc);

alter table public.sync_events enable row level security;
alter table public.sync_devices enable row level security;

create or replace function public.set_sync_devices_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_sync_devices_updated_at on public.sync_devices;
create trigger set_sync_devices_updated_at
before update on public.sync_devices
for each row execute function public.set_sync_devices_updated_at();

drop policy if exists "Users can select own sync events" on public.sync_events;
create policy "Users can select own sync events"
on public.sync_events
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own sync events" on public.sync_events;
create policy "Users can insert own sync events"
on public.sync_events
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own sync events" on public.sync_events;
create policy "Users can update own sync events"
on public.sync_events
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own sync events" on public.sync_events;
create policy "Users can delete own sync events"
on public.sync_events
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can select own sync devices" on public.sync_devices;
create policy "Users can select own sync devices"
on public.sync_devices
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own sync devices" on public.sync_devices;
create policy "Users can insert own sync devices"
on public.sync_devices
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own sync devices" on public.sync_devices;
create policy "Users can update own sync devices"
on public.sync_devices
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own sync devices" on public.sync_devices;
create policy "Users can delete own sync devices"
on public.sync_devices
for delete
to authenticated
using ((select auth.uid()) = user_id);
