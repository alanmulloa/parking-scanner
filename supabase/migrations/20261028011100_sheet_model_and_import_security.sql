-- Parking Comunidad - model aligned with DDBB QR Comunidad.xlsx.
-- Additive migration: applied migrations 100-110 are intentionally untouched.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

alter table public.communities
  add column if not exists legacy_id text,
  add column if not exists description text;

update public.communities
   set description = short_description
 where description is null
   and short_description is not null;

create unique index if not exists communities_legacy_id_unique
  on public.communities(legacy_id)
  where legacy_id is not null;

alter table public.profiles
  add column if not exists last_access_at timestamptz;

-- Historical audit needs both a resolvable UUID and the original Sheet identifier.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_log' and column_name = 'entity_id'
       and data_type = 'text'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_log' and column_name = 'legacy_entity_id'
  ) then
    alter table public.audit_log rename column entity_id to legacy_entity_id;
  end if;
end;
$$;

alter table public.audit_log
  add column if not exists actor_user_id uuid references public.profiles(user_id) on delete set null,
  add column if not exists entity_id uuid,
  add column if not exists legacy_entity_id text,
  add column if not exists source text not null default 'APPLICATION';

update public.audit_log
   set actor_user_id = user_id
 where actor_user_id is null and user_id is not null;

alter table public.audit_log
  drop constraint if exists audit_log_source_check;
alter table public.audit_log
  add constraint audit_log_source_check
  check (source in ('APPLICATION', 'LEGACY_SHEET', 'MIGRATION'));

create index if not exists audit_log_legacy_entity_idx
  on public.audit_log(community_id, entity, legacy_entity_id);
create index if not exists audit_log_entity_uuid_idx
  on public.audit_log(community_id, entity_id) where entity_id is not null;

alter table public.qr_controls
  add column if not exists vehicle_id uuid,
  add column if not exists result text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.plate_controls
  add column if not exists vehicle_id uuid,
  add column if not exists result text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Technical import log is deliberately separate from functional audit history.
create table if not exists public.migration_runs (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete set null,
  source_file text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  mode text not null check (mode in ('DRY_RUN', 'APPLY')),
  state text not null default 'RUNNING' check (state in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  inserts jsonb not null default '{}'::jsonb,
  updates jsonb not null default '{}'::jsonb,
  skips jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  importer_version text not null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists migration_runs_checksum_idx
  on public.migration_runs(source_sha256, started_at desc);

create table if not exists public.migration_run_items (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.migration_runs(id) on delete cascade,
  sheet_name text not null,
  legacy_id text,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'SKIP', 'ERROR')),
  message text,
  created_at timestamptz not null default now()
);
create index if not exists migration_run_items_run_idx
  on public.migration_run_items(run_id, sheet_name, operation);

alter table public.migration_runs enable row level security;
alter table public.migration_run_items enable row level security;
revoke all on public.migration_runs, public.migration_run_items from anon, authenticated;
grant select on public.migration_runs, public.migration_run_items to authenticated;
grant all on public.migration_runs, public.migration_run_items to service_role;
grant usage, select on sequence public.migration_run_items_id_seq to service_role;

drop policy if exists migration_runs_select_admin on public.migration_runs;
create policy migration_runs_select_admin on public.migration_runs
for select to authenticated
using (
  private.is_root()
  or (community_id is not null and private.has_community_role(community_id, array['ADMIN']::text[]))
);

drop policy if exists migration_run_items_select_admin on public.migration_run_items;
create policy migration_run_items_select_admin on public.migration_run_items
for select to authenticated
using (
  exists (
    select 1 from public.migration_runs mr
     where mr.id = run_id
       and (
         private.is_root()
         or (mr.community_id is not null and private.has_community_role(mr.community_id, array['ADMIN']::text[]))
       )
  )
);

-- Temporary credential vault for transparent first-login conversion.
create table if not exists private.legacy_auth_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  legacy_user_id text not null unique,
  email text not null,
  password_hash text,
  password_salt text,
  algorithm text not null default 'PC_SHA256_ITERATED_V2',
  iterations integer not null check (iterations between 1 and 1000000),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  password_changed_at timestamptz,
  session_version integer not null default 1,
  imported_at timestamptz not null default now(),
  migrated_at timestamptz,
  check (
    (migrated_at is null and password_hash is not null and password_salt is not null)
    or (migrated_at is not null and password_hash is null and password_salt is null)
  )
);
create unique index if not exists legacy_auth_credentials_email_unique_ci
  on private.legacy_auth_credentials(lower(email));

revoke all on private.legacy_auth_credentials from public, anon, authenticated;
grant select, insert, update, delete on private.legacy_auth_credentials to service_role;

create or replace function public.import_legacy_auth_credential(
  target_user_id uuid,
  target_legacy_user_id text,
  target_email text,
  target_password_hash text,
  target_password_salt text,
  target_algorithm text,
  target_iterations integer,
  target_failed_attempts integer default 0,
  target_locked_until timestamptz default null,
  target_password_changed_at timestamptz default null,
  target_session_version integer default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_password_hash is null or target_password_salt is null then
    raise exception 'legacy credential is incomplete';
  end if;
  insert into private.legacy_auth_credentials (
    user_id, legacy_user_id, email, password_hash, password_salt, algorithm, iterations,
    failed_attempts, locked_until, password_changed_at, session_version
  ) values (
    target_user_id, target_legacy_user_id, lower(trim(target_email)),
    target_password_hash, target_password_salt, target_algorithm, target_iterations,
    greatest(coalesce(target_failed_attempts, 0), 0), target_locked_until,
    target_password_changed_at, greatest(coalesce(target_session_version, 1), 1)
  )
  on conflict (user_id) do update set
    legacy_user_id = excluded.legacy_user_id,
    email = excluded.email,
    password_hash = case when private.legacy_auth_credentials.migrated_at is null then excluded.password_hash else null end,
    password_salt = case when private.legacy_auth_credentials.migrated_at is null then excluded.password_salt else null end,
    algorithm = excluded.algorithm,
    iterations = excluded.iterations,
    failed_attempts = excluded.failed_attempts,
    locked_until = excluded.locked_until,
    password_changed_at = excluded.password_changed_at,
    session_version = excluded.session_version;
end;
$$;

create or replace function public.legacy_auth_get_for_migration(target_email text)
returns table (
  user_id uuid,
  password_hash text,
  password_salt text,
  algorithm text,
  iterations integer,
  locked_until timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select c.user_id, c.password_hash, c.password_salt, c.algorithm, c.iterations, c.locked_until
    from private.legacy_auth_credentials c
   where lower(c.email) = lower(trim(target_email))
     and c.migrated_at is null
     and (c.locked_until is null or c.locked_until <= now())
   limit 1;
$$;

create or replace function public.legacy_auth_record_attempt(
  target_user_id uuid,
  was_successful boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if was_successful then
    update private.legacy_auth_credentials
       set migrated_at = now(), password_hash = null, password_salt = null,
           failed_attempts = 0, locked_until = null
     where user_id = target_user_id and migrated_at is null;
  else
    update private.legacy_auth_credentials
       set failed_attempts = failed_attempts + 1,
           locked_until = case
             when failed_attempts + 1 >= 5 then now() + interval '15 minutes'
             else locked_until
           end
     where user_id = target_user_id and migrated_at is null;
  end if;
end;
$$;

revoke all on function public.import_legacy_auth_credential(uuid,text,text,text,text,text,integer,integer,timestamptz,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.legacy_auth_get_for_migration(text) from public, anon, authenticated;
revoke all on function public.legacy_auth_record_attempt(uuid,boolean) from public, anon, authenticated;
grant execute on function public.import_legacy_auth_credential(uuid,text,text,text,text,text,integer,integer,timestamptz,timestamptz,integer) to service_role;
grant execute on function public.legacy_auth_get_for_migration(text) to service_role;
grant execute on function public.legacy_auth_record_attempt(uuid,boolean) to service_role;

-- Composite keys make cross-community references impossible at database level.
alter table public.requests add constraint requests_id_community_unique unique (id, community_id);
alter table public.incidents add constraint incidents_id_community_unique unique (id, community_id);

alter table public.dwellings
  add constraint dwellings_responsible_membership_fk
  foreign key (community_id, responsible_user_id)
  references public.community_members(community_id, user_id)
  on delete set null (responsible_user_id);

alter table public.requests
  add constraint requests_dwelling_community_fk
    foreign key (dwelling_id, community_id) references public.dwellings(id, community_id) on delete restrict,
  add constraint requests_vehicle_community_fk
    foreign key (vehicle_id, community_id) references public.vehicles(id, community_id) on delete set null (vehicle_id),
  add constraint requests_requested_by_membership_fk
    foreign key (community_id, requested_by) references public.community_members(community_id, user_id) on delete set null (requested_by),
  add constraint requests_resolved_by_membership_fk
    foreign key (community_id, resolved_by) references public.community_members(community_id, user_id) on delete set null (resolved_by);

alter table public.incidents
  add constraint incidents_dwelling_community_fk
    foreign key (dwelling_id, community_id) references public.dwellings(id, community_id) on delete set null (dwelling_id),
  add constraint incidents_vehicle_community_fk
    foreign key (vehicle_id, community_id) references public.vehicles(id, community_id) on delete set null (vehicle_id),
  add constraint incidents_related_dwelling_community_fk
    foreign key (related_dwelling_id, community_id) references public.dwellings(id, community_id) on delete set null (related_dwelling_id),
  add constraint incidents_related_vehicle_community_fk
    foreign key (related_vehicle_id, community_id) references public.vehicles(id, community_id) on delete set null (related_vehicle_id),
  add constraint incidents_created_by_membership_fk
    foreign key (community_id, created_by) references public.community_members(community_id, user_id) on delete set null (created_by),
  add constraint incidents_closed_by_membership_fk
    foreign key (community_id, closed_by) references public.community_members(community_id, user_id) on delete set null (closed_by);

alter table public.incident_followups
  add constraint followups_incident_community_fk
    foreign key (incident_id, community_id) references public.incidents(id, community_id) on delete cascade,
  add constraint followups_related_dwelling_community_fk
    foreign key (related_dwelling_id, community_id) references public.dwellings(id, community_id) on delete set null (related_dwelling_id),
  add constraint followups_related_vehicle_community_fk
    foreign key (related_vehicle_id, community_id) references public.vehicles(id, community_id) on delete set null (related_vehicle_id),
  add constraint followups_created_by_membership_fk
    foreign key (community_id, created_by) references public.community_members(community_id, user_id) on delete set null (created_by);

alter table public.qr_controls
  add constraint qr_controls_vehicle_community_fk
    foreign key (vehicle_id, community_id) references public.vehicles(id, community_id) on delete set null (vehicle_id),
  add constraint qr_controls_user_membership_fk
    foreign key (community_id, user_id) references public.community_members(community_id, user_id) on delete set null (user_id);

alter table public.plate_controls
  add constraint plate_controls_vehicle_community_fk
    foreign key (vehicle_id, community_id) references public.vehicles(id, community_id) on delete set null (vehicle_id),
  add constraint plate_controls_user_membership_fk
    foreign key (community_id, user_id) references public.community_members(community_id, user_id) on delete set null (user_id);

create index if not exists qr_controls_vehicle_idx on public.qr_controls(vehicle_id, occurred_at desc);
create index if not exists plate_controls_vehicle_idx on public.plate_controls(vehicle_id, occurred_at desc);

drop trigger if exists community_settings_set_updated_at on public.community_settings;
create trigger community_settings_set_updated_at before update on public.community_settings
for each row execute function private.set_updated_at();
