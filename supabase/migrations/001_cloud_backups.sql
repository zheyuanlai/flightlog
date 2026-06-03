create extension if not exists pgcrypto;

create table if not exists public.cloud_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  schema_version integer not null,
  backup_json jsonb not null,
  backup_checksum text,
  flight_count integer,
  trip_metadata_count integer,
  provider_airport_count integer,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  device_id text,
  app_version text,
  is_auto boolean not null default false
);

create index if not exists cloud_backups_user_created_idx
  on public.cloud_backups (user_id, created_at desc);

alter table public.cloud_backups enable row level security;

create or replace function public.set_cloud_backups_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_cloud_backups_updated_at on public.cloud_backups;
create trigger set_cloud_backups_updated_at
before update on public.cloud_backups
for each row execute function public.set_cloud_backups_updated_at();

drop policy if exists "Users can select own cloud backups" on public.cloud_backups;
create policy "Users can select own cloud backups"
on public.cloud_backups
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own cloud backups" on public.cloud_backups;
create policy "Users can insert own cloud backups"
on public.cloud_backups
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own cloud backups" on public.cloud_backups;
create policy "Users can update own cloud backups"
on public.cloud_backups
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own cloud backups" on public.cloud_backups;
create policy "Users can delete own cloud backups"
on public.cloud_backups
for delete
to authenticated
using ((select auth.uid()) = user_id);
