-- Aggregate-only operational status for the server-side JIT migration.
create or replace function public.legacy_auth_migration_status()
returns table (
  total bigint,
  pending bigint,
  migrated bigint,
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
    count(*) filter (where c.migrated_at is not null)::bigint,
    count(*) filter (where c.migrated_at is null and c.locked_until > now())::bigint
  from private.legacy_auth_credentials c;
$$;

revoke all on function public.legacy_auth_migration_status() from public, anon, authenticated;
grant execute on function public.legacy_auth_migration_status() to service_role;
