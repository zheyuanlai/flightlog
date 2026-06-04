create extension if not exists pgcrypto;

create table if not exists public.synced_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('flight', 'tripMetadata', 'providerAirport', 'appSettings')),
  local_id text not null,
  record_json jsonb not null,
  record_checksum text not null,
  record_updated_at timestamptz,
  deleted_at timestamptz,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entity_type, local_id)
);

create index if not exists synced_records_user_updated_idx
  on public.synced_records (user_id, updated_at desc);

create index if not exists synced_records_user_entity_idx
  on public.synced_records (user_id, entity_type);

alter table public.synced_records enable row level security;

create or replace function public.set_synced_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_synced_records_updated_at on public.synced_records;
create trigger set_synced_records_updated_at
before update on public.synced_records
for each row execute function public.set_synced_records_updated_at();

drop policy if exists "Users can select own synced records" on public.synced_records;
create policy "Users can select own synced records"
on public.synced_records
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own synced records" on public.synced_records;
create policy "Users can insert own synced records"
on public.synced_records
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own synced records" on public.synced_records;
create policy "Users can update own synced records"
on public.synced_records
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own synced records" on public.synced_records;
create policy "Users can delete own synced records"
on public.synced_records
for delete
to authenticated
using ((select auth.uid()) = user_id);
