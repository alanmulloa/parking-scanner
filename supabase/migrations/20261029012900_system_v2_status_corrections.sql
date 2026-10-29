-- Parking Comunidad - Sistema v2 status corrections.
-- Corrects legacy audit source accounting and refreshes displayed schema version.

begin;

create or replace function public.root_system_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_public jsonb;
begin
  if not private.is_root() then raise exception 'Acceso exclusivo ROOT.'; end if;
  select public.parking_public_state() into v_public;
  return jsonb_build_object(
    'checkedAt', now(),
    'database', 'OK',
    'backendVersion', 'Supabase migration 129',
    'schemaVersion', '20261029012900',
    'environment', 'PREPRODUCCIÓN',
    'communities', (select count(*) from public.communities),
    'profiles', (select count(*) from public.profiles where not is_root),
    'rootProfiles', (select count(*) from public.profiles where is_root),
    'members', (select count(*) from public.community_members),
    'dwellings', (select count(*) from public.dwellings),
    'vehicles', (select count(*) from public.vehicles),
    'openIncidents', (select count(*) from public.incidents where state='Abierta'),
    'openRequests', (select count(*) from public.requests where state='Abierta'),
    'legacyAuditRows', (select count(*) from public.audit_log where source='LEGACY_SHEET'),
    'auditRows', (select count(*) from public.audit_log),
    'maintenance', v_public->'maintenance',
    'integrations', jsonb_build_object(
      'mail', jsonb_build_object(
        'provider', 'Apps Script / Google',
        'state', 'LEGACY_ACTIVE',
        'detail', 'Se mantiene durante el primer cutover. Envíos y reintentos siguen gestionándose desde Apps Script.'
      ),
      'documents', jsonb_build_object(
        'provider', 'Google Drive / Docs',
        'state', 'LEGACY_ACTIVE',
        'detail', 'Se mantiene durante el primer cutover. La migración a OneDrive queda desacoplada para una fase posterior.'
      )
    )
  );
end;
$$;

revoke all on function public.root_system_status() from public, anon;
grant execute on function public.root_system_status() to authenticated, service_role;

create or replace function public.root_system_diagnostics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
begin
  if not private.is_root() then raise exception 'Acceso exclusivo ROOT.'; end if;
  select public.root_system_status() into v_status;
  return v_status || jsonb_build_object(
    'schemaVersion', '20261029012900',
    'rlsEnabledTables', (
      select count(*) from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity
    ),
    'checkedAt', now()
  );
end;
$$;

revoke all on function public.root_system_diagnostics() from public, anon;
grant execute on function public.root_system_diagnostics() to authenticated, service_role;

commit;
