begin;

drop function if exists public.legacy_auth_credential_status(uuid);

create function public.legacy_auth_credential_status(target_user_id uuid)
returns table (
  exists_in_vault boolean,
  migrated boolean,
  validated boolean,
  credentials_retained boolean,
  purged boolean,
  failed_attempts integer,
  locked_until timestamptz
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
    c.purged_at is not null,
    c.failed_attempts,
    c.locked_until
  from private.legacy_auth_credentials c
  where c.user_id = target_user_id;
$$;

revoke all on function public.legacy_auth_credential_status(uuid)
  from public, anon, authenticated;
grant execute on function public.legacy_auth_credential_status(uuid)
  to service_role;

commit;
