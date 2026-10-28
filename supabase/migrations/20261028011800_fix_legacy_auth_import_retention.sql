-- Align legacy credential import with the retention lifecycle introduced in 116.
--
-- Lifecycle:
-- pending             -> hash/salt retained
-- migrated            -> hash/salt retained
-- validated           -> hash/salt retained
-- purged              -> hash/salt NULL
--
-- Re-running the XLSX importer must never:
--   * purge a migrated verifier
--   * resurrect a purged verifier
--   * reset JIT migration state

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
  if target_password_hash is null
     or target_password_salt is null
     or btrim(target_password_hash) = ''
     or btrim(target_password_salt) = '' then
    raise exception 'legacy credential is incomplete';
  end if;

  insert into private.legacy_auth_credentials (
    user_id,
    legacy_user_id,
    email,
    password_hash,
    password_salt,
    algorithm,
    iterations,
    failed_attempts,
    locked_until,
    password_changed_at,
    session_version
  )
  values (
    target_user_id,
    target_legacy_user_id,
    lower(trim(target_email)),
    target_password_hash,
    target_password_salt,
    target_algorithm,
    target_iterations,
    greatest(coalesce(target_failed_attempts, 0), 0),
    target_locked_until,
    target_password_changed_at,
    greatest(coalesce(target_session_version, 1), 1)
  )
  on conflict (user_id) do update
  set
    legacy_user_id = excluded.legacy_user_id,
    email = excluded.email,

    -- Before JIT migration, refresh verifier from the Sheet.
    -- After migration, preserve the retained verifier.
    -- After purge, never resurrect it.
    password_hash = case
      when private.legacy_auth_credentials.purged_at is not null
        then private.legacy_auth_credentials.password_hash
      when private.legacy_auth_credentials.migrated_at is null
        then excluded.password_hash
      else private.legacy_auth_credentials.password_hash
    end,

    password_salt = case
      when private.legacy_auth_credentials.purged_at is not null
        then private.legacy_auth_credentials.password_salt
      when private.legacy_auth_credentials.migrated_at is null
        then excluded.password_salt
      else private.legacy_auth_credentials.password_salt
    end,

    -- Algorithm metadata must stay aligned with the retained verifier.
    algorithm = case
      when private.legacy_auth_credentials.migrated_at is null
           and private.legacy_auth_credentials.purged_at is null
        then excluded.algorithm
      else private.legacy_auth_credentials.algorithm
    end,

    iterations = case
      when private.legacy_auth_credentials.migrated_at is null
           and private.legacy_auth_credentials.purged_at is null
        then excluded.iterations
      else private.legacy_auth_credentials.iterations
    end,

    -- Do not reset JIT security/lifecycle state after conversion.
    failed_attempts = case
      when private.legacy_auth_credentials.migrated_at is null
        then excluded.failed_attempts
      else private.legacy_auth_credentials.failed_attempts
    end,

    locked_until = case
      when private.legacy_auth_credentials.migrated_at is null
        then excluded.locked_until
      else private.legacy_auth_credentials.locked_until
    end,

    password_changed_at = case
      when private.legacy_auth_credentials.migrated_at is null
        then excluded.password_changed_at
      else private.legacy_auth_credentials.password_changed_at
    end,

    session_version = case
      when private.legacy_auth_credentials.migrated_at is null
        then excluded.session_version
      else private.legacy_auth_credentials.session_version
    end;

  -- Intentionally do not modify:
  -- migrated_at
  -- validated_at
  -- purged_at
end;
$$;

revoke all on function public.import_legacy_auth_credential(
  uuid,text,text,text,text,text,integer,integer,timestamptz,timestamptz,integer
) from public, anon, authenticated;

grant execute on function public.import_legacy_auth_credential(
  uuid,text,text,text,text,text,integer,integer,timestamptz,timestamptz,integer
) to service_role;
