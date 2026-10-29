-- Parking Comunidad - Sistema v2 + modo mantenimiento.
-- Adds a public read-only state, ROOT-only maintenance controls and refreshed diagnostics.

begin;

create or replace function public.parking_public_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_community uuid;
  v_name text := 'Parking Comunidad';
  v_logo text := '';
  v_enabled boolean := false;
  v_message text := 'Sistema temporalmente en mantenimiento. Volveremos a estar disponibles en breve.';
  v_value jsonb;
begin
  select c.id, c.name into v_community, v_name
    from public.communities c
   where c.state = 'Activo'
   order by c.created_at
   limit 1;

  if v_community is null then
    return jsonb_build_object(
      'maintenance', jsonb_build_object('enabled', false, 'message', v_message),
      'settings', jsonb_build_object('NombreOficial', v_name, 'LogoUrl', v_logo)
    );
  end if;

  select cs.value into v_value
    from public.community_settings cs
   where cs.community_id = v_community and cs.key = 'MaintenanceMode';
  if v_value is not null then
    begin
      v_enabled := coalesce((v_value #>> '{}')::boolean, false);
    exception when others then
      v_enabled := false;
    end;
  end if;

  select coalesce(cs.value #>> '{}', v_message) into v_message
    from public.community_settings cs
   where cs.community_id = v_community and cs.key = 'MaintenanceMessage';
  v_message := coalesce(nullif(trim(v_message), ''), 'Sistema temporalmente en mantenimiento. Volveremos a estar disponibles en breve.');

  select coalesce(cs.value #>> '{}', v_name) into v_name
    from public.community_settings cs
   where cs.community_id = v_community and cs.key = 'NombreOficial';

  select coalesce(cs.value #>> '{}', '') into v_logo
    from public.community_settings cs
   where cs.community_id = v_community and cs.key = 'LogoUrl';

  return jsonb_build_object(
    'maintenance', jsonb_build_object('enabled', v_enabled, 'message', v_message),
    'settings', jsonb_build_object('NombreOficial', coalesce(v_name, 'Parking Comunidad'), 'LogoUrl', coalesce(v_logo, ''))
  );
end;
$$;

revoke all on function public.parking_public_state() from public;
grant execute on function public.parking_public_state() to anon, authenticated, service_role;

create or replace function public.parking_set_maintenance(
  p_enabled boolean,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
  v_message text;
  v_actor_email text := '';
  v_root record;
begin
  if not private.is_root() then raise exception 'Acceso exclusivo ROOT.'; end if;

  select c.id into v_community
    from public.communities c
   where c.state = 'Activo'
   order by c.created_at
   limit 1;
  if v_community is null then raise exception 'No se pudo determinar la comunidad activa.'; end if;

  v_message := coalesce(nullif(trim(p_message), ''), 'Sistema temporalmente en mantenimiento. Volveremos a estar disponibles en breve.');

  insert into public.community_settings (community_id, key, value)
  values (v_community, 'MaintenanceMode', to_jsonb(coalesce(p_enabled, false)))
  on conflict (community_id, key) do update set value = excluded.value, updated_at = now();

  insert into public.community_settings (community_id, key, value)
  values (v_community, 'MaintenanceMessage', to_jsonb(v_message))
  on conflict (community_id, key) do update set value = excluded.value, updated_at = now();

  select * into v_root from public.technical_root_identity((select auth.uid())) limit 1;
  v_actor_email := coalesce(v_root.login_email, (select p.email from public.profiles p where p.user_id = (select auth.uid())), '');

  insert into public.audit_log (
    community_id, occurred_at, user_id, actor_user_id, actor_email,
    action, entity, entity_id, observations, metadata, source
  ) values (
    v_community, now(), (select auth.uid()), (select auth.uid()), v_actor_email,
    case when p_enabled then 'SYSTEM_MAINTENANCE_ON' else 'SYSTEM_MAINTENANCE_OFF' end,
    'SYSTEM', v_community,
    case when p_enabled then 'Modo mantenimiento activado por ROOT.' else 'Modo mantenimiento desactivado por ROOT.' end,
    jsonb_build_object('enabled', coalesce(p_enabled, false), 'message', v_message),
    'APPLICATION'
  );

  return jsonb_build_object(
    'maintenance', jsonb_build_object('enabled', coalesce(p_enabled, false), 'message', v_message)
  );
end;
$$;

revoke all on function public.parking_set_maintenance(boolean, text) from public, anon;
grant execute on function public.parking_set_maintenance(boolean, text) to authenticated, service_role;

create or replace function public.parking_system_ping()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_root() then raise exception 'Acceso exclusivo ROOT.'; end if;
  return jsonb_build_object('ok', true, 'checkedAt', now());
end;
$$;

revoke all on function public.parking_system_ping() from public, anon;
grant execute on function public.parking_system_ping() to authenticated, service_role;

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
    'backendVersion', 'Supabase migration 128',
    'schemaVersion', '20261029012800',
    'environment', 'PREPRODUCCIÓN',
    'communities', (select count(*) from public.communities),
    'profiles', (select count(*) from public.profiles where not is_root),
    'rootProfiles', (select count(*) from public.profiles where is_root),
    'members', (select count(*) from public.community_members),
    'dwellings', (select count(*) from public.dwellings),
    'vehicles', (select count(*) from public.vehicles),
    'openIncidents', (select count(*) from public.incidents where state='Abierta'),
    'openRequests', (select count(*) from public.requests where state='Abierta'),
    'legacyAuditRows', (select count(*) from public.audit_log where source='LEGACY'),
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
    'schemaVersion', '20261029012800',
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
