-- A successful JIT conversion no longer purges the legacy verifier immediately.
-- Retention, validation and purge are separate, explicit server-side stages.

alter table private.legacy_auth_credentials
  add column if not exists validated_at timestamptz,
  add column if not exists purged_at timestamptz;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'private.legacy_auth_credentials'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%password_hash%'
       and pg_get_constraintdef(c.oid) ilike '%migrated_at%'
  loop
    execute format('alter table private.legacy_auth_credentials drop constraint %I', constraint_name);
  end loop;
end;
$$;

alter table private.legacy_auth_credentials
  add constraint legacy_auth_credentials_retention_check
  check (
    (purged_at is null and password_hash is not null and password_salt is not null)
    or
    (purged_at is not null and validated_at is not null and password_hash is null and password_salt is null)
  );

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
       set migrated_at = coalesce(migrated_at, now()),
           failed_attempts = 0,
           locked_until = null
     where user_id = target_user_id;
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

create or replace function public.legacy_auth_mark_validated(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.legacy_auth_credentials
     set validated_at = coalesce(validated_at, now())
   where user_id = target_user_id
     and migrated_at is not null
     and purged_at is null;
  if not found then raise exception 'credential is not eligible for validation'; end if;
end;
$$;

create or replace function public.legacy_auth_purge_validated_credential(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.legacy_auth_credentials
     set password_hash = null,
         password_salt = null,
         purged_at = now()
   where user_id = target_user_id
     and validated_at is not null
     and purged_at is null;
  if not found then raise exception 'credential must be validated before purge'; end if;
end;
$$;

drop function if exists public.legacy_auth_migration_status();
create function public.legacy_auth_migration_status()
returns table (
  total bigint,
  pending bigint,
  migrated_unvalidated bigint,
  validated_retained bigint,
  purged bigint,
  currently_locked bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(*) filter (where c.migrated_at is null)::bigint,
    count(*) filter (where c.migrated_at is not null and c.validated_at is null)::bigint,
    count(*) filter (where c.validated_at is not null and c.purged_at is null)::bigint,
    count(*) filter (where c.purged_at is not null)::bigint,
    count(*) filter (where c.migrated_at is null and c.locked_until > now())::bigint
  from private.legacy_auth_credentials c;
$$;

create or replace function public.legacy_auth_credential_status(target_user_id uuid)
returns table (
  exists_in_vault boolean,
  migrated boolean,
  validated boolean,
  credentials_retained boolean,
  purged boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    true,
    c.migrated_at is not null,
    c.validated_at is not null,
    c.password_hash is not null and c.password_salt is not null,
    c.purged_at is not null
  from private.legacy_auth_credentials c
  where c.user_id = target_user_id;
$$;

revoke all on function public.legacy_auth_record_attempt(uuid,boolean) from public, anon, authenticated;
revoke all on function public.legacy_auth_mark_validated(uuid) from public, anon, authenticated;
revoke all on function public.legacy_auth_purge_validated_credential(uuid) from public, anon, authenticated;
revoke all on function public.legacy_auth_migration_status() from public, anon, authenticated;
revoke all on function public.legacy_auth_credential_status(uuid) from public, anon, authenticated;
grant execute on function public.legacy_auth_record_attempt(uuid,boolean) to service_role;
grant execute on function public.legacy_auth_mark_validated(uuid) to service_role;
grant execute on function public.legacy_auth_purge_validated_credential(uuid) to service_role;
grant execute on function public.legacy_auth_migration_status() to service_role;
grant execute on function public.legacy_auth_credential_status(uuid) to service_role;
