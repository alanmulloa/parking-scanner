begin;

-- Final application backend. Applied migrations 100-119 remain immutable.

-- --------------------------------------------------------------------------
-- Request and incident vocabularies used by the stable application.
-- --------------------------------------------------------------------------

alter table public.requests drop constraint if exists requests_type_check;
alter table public.requests add constraint requests_type_check check (type in (
  'ALTA_ACTIVACION',
  'BAJA',
  'REACTIVACION_VEHICULO',
  'RENOVACION_QR',
  'PERMANENCIA_PROLONGADA'
));

alter table public.incidents drop constraint if exists incidents_type_check;
alter table public.incidents add constraint incidents_type_check check (type in (
  'Matrícula no registrada',
  'Acceso no autorizado',
  'QR no presentado',
  'QR no corresponde con matrícula',
  'Uso indebido',
  'Vehículo inmovilizado / posible abandono',
  'Estacionamiento o ubicación indebida',
  'Mal estacionado / bloqueo',
  'Zonas comunes',
  'Fuga / pérdida de líquidos',
  'Otro'
));

alter table public.incident_followups
  add column if not exists occurred_date date
  generated always as ((occurred_at at time zone 'Europe/Madrid')::date) stored;

create unique index if not exists incident_followups_one_per_incident_day
  on public.incident_followups(incident_id, occurred_date);

-- --------------------------------------------------------------------------
-- ROOT invariants: global profile, no membership, not editable by ADMIN.
-- --------------------------------------------------------------------------

create or replace function private.protect_root_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'profiles' then
    if tg_op = 'DELETE' and old.is_root and not private.is_root()
       and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'La identidad ROOT no puede eliminarse.';
    end if;
    if tg_op = 'UPDATE' and old.is_root and not private.is_root()
       and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'La identidad ROOT no puede modificarse.';
    end if;
    if tg_op = 'UPDATE' and new.is_root is distinct from old.is_root and not private.is_root()
       and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Solo ROOT puede modificar el indicador ROOT.';
    end if;
    if tg_op = 'INSERT' and new.is_root and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'ROOT solo puede aprovisionarse desde backend seguro.';
    end if;
  elsif tg_table_name = 'community_members' then
    if exists (select 1 from public.profiles p where p.user_id = new.user_id and p.is_root) then
      raise exception 'ROOT no puede pertenecer a community_members.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_root on public.profiles;
create trigger profiles_protect_root
before insert or update or delete on public.profiles
for each row execute function private.protect_root_identity();

drop trigger if exists memberships_protect_root on public.community_members;
create trigger memberships_protect_root
before insert or update on public.community_members
for each row execute function private.protect_root_identity();

-- ADMIN may never see ROOT because ROOT deliberately has no membership.
create or replace function private.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_user = (select auth.uid())
    or private.is_root()
    or (
      not exists (
        select 1 from public.profiles root_profile
         where root_profile.user_id = target_user and root_profile.is_root
      )
      and exists (
        select 1
          from public.community_members me
          join public.community_members target
            on target.community_id = me.community_id
         where me.user_id = (select auth.uid())
           and me.state = 'Activo'
           and me.roles && array['ADMIN']::text[]
           and target.user_id = target_user
      )
    );
$$;

-- --------------------------------------------------------------------------
-- Functional RLS parity with the stable owner workflows.
-- --------------------------------------------------------------------------

drop policy if exists vehicles_insert_admin on public.vehicles;
create policy vehicles_insert_admin_or_owner on public.vehicles
for insert to authenticated
with check (
  private.has_community_role(community_id, array['ADMIN']::text[])
  or private.owns_dwelling(dwelling_id)
);

drop policy if exists vehicles_update_admin on public.vehicles;
create policy vehicles_update_admin_or_owner on public.vehicles
for update to authenticated
using (
  private.has_community_role(community_id, array['ADMIN']::text[])
  or private.owns_vehicle(id)
)
with check (
  private.has_community_role(community_id, array['ADMIN']::text[])
  or private.owns_dwelling(dwelling_id)
);

drop policy if exists temporary_periods_write_admin on public.temporary_periods;
create policy temporary_periods_write_staff_or_owner on public.temporary_periods
for all to authenticated
using (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  or private.owns_vehicle(vehicle_id)
)
with check (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  or private.owns_vehicle(vehicle_id)
);

grant update(name) on public.profiles to authenticated;
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (user_id = (select auth.uid()) and not is_root)
with check (user_id = (select auth.uid()) and not is_root);

-- --------------------------------------------------------------------------
-- Application audit. Historical LEGACY_SHEET rows are never modified.
-- --------------------------------------------------------------------------

create or replace function private.audit_application_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_community uuid;
  v_entity_id uuid;
  v_legacy_id text;
  v_actor_email text;
  v_entity text;
begin
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row := coalesce(v_new, v_old);
  v_community := nullif(v_row ->> 'community_id', '')::uuid;
  if coalesce(v_row ->> 'id', '') ~* '^[0-9a-f-]{36}$' then
    v_entity_id := (v_row ->> 'id')::uuid;
  elsif coalesce(v_row ->> 'user_id', '') ~* '^[0-9a-f-]{36}$' then
    v_entity_id := (v_row ->> 'user_id')::uuid;
  end if;
  v_legacy_id := nullif(v_row ->> 'legacy_id', '');
  select p.email into v_actor_email
    from public.profiles p where p.user_id = (select auth.uid());
  v_entity := upper(tg_table_name);

  insert into public.audit_log (
    community_id, occurred_at, user_id, actor_user_id, actor_email,
    action, entity, entity_id, legacy_entity_id, observations, metadata, source
  ) values (
    v_community, now(), (select auth.uid()), (select auth.uid()), v_actor_email,
    tg_op, v_entity, v_entity_id, v_legacy_id,
    'Cambio registrado automáticamente por la aplicación Supabase.',
    jsonb_build_object('old', v_old, 'new', v_new), 'APPLICATION'
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'dwellings','vehicles','temporary_periods','requests','incidents',
    'incident_followups','community_settings'
  ] loop
    execute format('drop trigger if exists %I_audit_application on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_audit_application after insert or update or delete on public.%I for each row execute function private.audit_application_change()',
      table_name, table_name
    );
  end loop;
end;
$$;

-- --------------------------------------------------------------------------
-- Session/bootstrap helpers.
-- --------------------------------------------------------------------------

create or replace function public.app_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_memberships jsonb;
  v_community uuid;
  v_settings jsonb;
  v_dwelling jsonb;
begin
  select * into v_profile from public.profiles where user_id = (select auth.uid());
  if not found or v_profile.state <> 'Activo' then
    raise exception 'Sesión sin perfil activo.';
  end if;

  if v_profile.is_root then
    select id into v_community from public.communities where state = 'Activo' order by created_at limit 1;
    v_memberships := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'community_id', cm.community_id, 'roles', cm.roles, 'state', cm.state
    ) order by cm.created_at), '[]'::jsonb)
      into v_memberships
      from public.community_members cm
     where cm.user_id = v_profile.user_id and cm.state = 'Activo';
    select cm.community_id into v_community
      from public.community_members cm
     where cm.user_id = v_profile.user_id and cm.state = 'Activo'
     order by cm.created_at limit 1;
    if v_community is null then raise exception 'Tu usuario no tiene una comunidad activa.'; end if;
  end if;

  select coalesce(jsonb_object_agg(cs.key, cs.value), '{}'::jsonb)
    into v_settings from public.community_settings cs where cs.community_id = v_community;

  select to_jsonb(d) into v_dwelling
    from public.dwellings d
   where d.community_id = v_community and d.responsible_user_id = v_profile.user_id
   order by d.created_at limit 1;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'user_id', v_profile.user_id, 'email', v_profile.email,
      'name', v_profile.name, 'state', v_profile.state, 'is_root', v_profile.is_root
    ),
    'memberships', v_memberships,
    'community_id', v_community,
    'dwelling', v_dwelling,
    'settings', coalesce(v_settings, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.app_bootstrap() from public, anon;
grant execute on function public.app_bootstrap() to authenticated;

create or replace function public.record_root_session_event(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
  v_email text;
begin
  if not private.is_root() then raise exception 'Acceso exclusivo ROOT.'; end if;
  if upper(coalesce(p_action, '')) not in ('LOGIN','REFRESH','LOGOUT','RECOVERY') then
    raise exception 'Evento ROOT no válido.';
  end if;
  select id into v_community from public.communities where state = 'Activo' order by created_at limit 1;
  select email into v_email from public.profiles where user_id = (select auth.uid());
  insert into public.audit_log (
    community_id, occurred_at, user_id, actor_user_id, actor_email,
    action, entity, entity_id, observations, metadata, source
  ) values (
    v_community, now(), (select auth.uid()), (select auth.uid()), v_email,
    'ROOT_' || upper(p_action), 'SYSTEM', (select auth.uid()),
    'Evento de sesión técnica.', '{}'::jsonb, 'APPLICATION'
  );
  return true;
end;
$$;

revoke all on function public.record_root_session_event(text) from public, anon;
grant execute on function public.record_root_session_event(text) to authenticated;

-- --------------------------------------------------------------------------
-- Scanner/control: atomic lookup plus immutable control registration.
-- --------------------------------------------------------------------------

create or replace function public.resolve_parking_control(p_kind text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := upper(btrim(coalesce(p_kind, '')));
  v_value text := btrim(coalesce(p_value, ''));
  v_plate text := public.normalize_plate(p_value);
  v_community uuid;
  v_vehicle public.vehicles%rowtype;
  v_dwelling public.dwellings%rowtype;
  v_period public.temporary_periods%rowtype;
  v_matched_period public.temporary_periods%rowtype;
  v_status text;
  v_is_temporary boolean := false;
  v_current_plate text;
  v_control_id uuid;
  v_open_incidents jsonb;
  v_long_stay jsonb;
begin
  if v_kind not in ('QR','MATRICULA') then raise exception 'Tipo de control no válido.'; end if;
  if v_value = '' then raise exception 'Introduce un QR o matrícula.'; end if;

  select cm.community_id into v_community
    from public.community_members cm
   where cm.user_id = (select auth.uid()) and cm.state = 'Activo'
     and cm.roles && array['ADMIN','CONTROL']::text[]
   order by cm.created_at limit 1;
  if v_community is null and private.is_root() then
    select id into v_community from public.communities where state = 'Activo' order by created_at limit 1;
  end if;
  if v_community is null then raise exception 'No tienes permisos de control.'; end if;

  if v_kind = 'QR' then
    select * into v_vehicle from public.vehicles
     where community_id = v_community and qr_token = v_value limit 1;
  else
    select * into v_vehicle from public.vehicles
     where community_id = v_community and normalized_habitual_plate = v_plate limit 1;
    if not found then
      select tp.* into v_matched_period
        from public.temporary_periods tp
       where tp.community_id = v_community
         and tp.normalized_temporary_plate = v_plate
         and tp.state <> 'Anulado'
       order by (current_date between tp.starts_at and tp.ends_at) desc, tp.starts_at desc
       limit 1;
      if found then
        v_is_temporary := true;
        select * into v_vehicle from public.vehicles where id = v_matched_period.vehicle_id;
      end if;
    end if;
  end if;

  if not found then
    v_status := case when v_kind = 'QR' then 'QR NO ENCONTRADO' else 'MATRICULA NO REGISTRADA' end;
  else
    select * into v_dwelling from public.dwellings where id = v_vehicle.dwelling_id;
    select * into v_period from public.temporary_periods tp
     where tp.vehicle_id = v_vehicle.id and tp.state <> 'Anulado'
       and current_date between tp.starts_at and tp.ends_at
     order by tp.starts_at desc limit 1;
    v_current_plate := coalesce(v_period.temporary_plate, v_vehicle.habitual_plate);

    if v_kind = 'QR' and v_vehicle.type = 'Moto' then v_status := 'MOTO - USAR MATRÍCULA';
    elsif v_vehicle.state = 'Desasignado' then v_status := 'VEHICULO DESASIGNADO';
    elsif v_vehicle.state = 'Suspendido' then v_status := 'VEHICULO SUSPENDIDO';
    elsif v_vehicle.state = 'Baja' then v_status := 'VEHICULO DE BAJA';
    elsif v_dwelling.id is null or v_dwelling.state <> 'Activo' then v_status := 'NO AUTORIZADO';
    elsif v_kind = 'MATRICULA' and v_is_temporary
          and not (current_date between v_matched_period.starts_at and v_matched_period.ends_at) then v_status := 'MATRICULA TEMPORAL NO VIGENTE';
    elsif v_kind = 'MATRICULA' and v_plate = v_vehicle.normalized_habitual_plate
          and v_period.id is not null and public.normalize_plate(v_current_plate) <> v_plate then v_status := 'MATRICULA HABITUAL NO VIGENTE';
    elsif v_vehicle.type <> 'Moto' and v_vehicle.qr_state = 'Revocado' then v_status := 'QR REVOCADO';
    elsif v_vehicle.type <> 'Moto' and v_vehicle.slot not in (1,2) then v_status := 'NO AUTORIZADO';
    else v_status := 'AUTORIZADO';
    end if;
  end if;

  if v_kind = 'QR' then
    insert into public.qr_controls(community_id,user_id,occurred_at,scanned_code,vehicle_id,result,metadata)
    values(v_community,case when private.is_root() then null else (select auth.uid()) end,now(),v_value,v_vehicle.id,v_status,jsonb_build_object('source','SUPABASE'))
    returning id into v_control_id;
  else
    insert into public.plate_controls(community_id,user_id,occurred_at,searched_plate,vehicle_id,result,metadata)
    values(v_community,case when private.is_root() then null else (select auth.uid()) end,now(),coalesce(v_plate,v_value),v_vehicle.id,v_status,jsonb_build_object('source','SUPABASE'))
    returning id into v_control_id;
  end if;

  if v_vehicle.id is not null then
    select coalesce(jsonb_agg(to_jsonb(i) order by i.occurred_at desc), '[]'::jsonb)
      into v_open_incidents from public.incidents i
     where i.community_id = v_community and i.state = 'Abierta'
       and (i.vehicle_id = v_vehicle.id or public.normalize_plate(i.observed_plate) = public.normalize_plate(v_current_plate));
    select to_jsonb(r) into v_long_stay from public.requests r
     where r.vehicle_id = v_vehicle.id and r.type = 'PERMANENCIA_PROLONGADA'
       and r.state = 'Aprobada' and current_date between r.start_date and r.end_date
     order by r.requested_at desc limit 1;
  else
    select coalesce(jsonb_agg(to_jsonb(i) order by i.occurred_at desc), '[]'::jsonb)
      into v_open_incidents from public.incidents i
     where i.community_id = v_community and i.state = 'Abierta'
       and public.normalize_plate(i.observed_plate) = v_plate;
  end if;

  return jsonb_build_object(
    'status', v_status, 'source', v_kind, 'query', case when v_kind='MATRICULA' then v_plate else null end,
    'control_id', v_control_id, 'vehicle', case when v_vehicle.id is null then null else to_jsonb(v_vehicle) end,
    'housing', case when v_dwelling.id is null then null else to_jsonb(v_dwelling) end,
    'currentPlate', v_current_plate, 'isTemporary', v_is_temporary or v_period.id is not null,
    'temporaryPeriod', case
      when v_is_temporary then to_jsonb(v_matched_period)
      when v_period.id is not null then to_jsonb(v_period)
      else null
    end,
    'longStay', v_long_stay, 'openIncidents', coalesce(v_open_incidents, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.resolve_parking_control(text,text) from public, anon;
grant execute on function public.resolve_parking_control(text,text) to authenticated;

-- --------------------------------------------------------------------------
-- Request resolution and incident closing are atomic business operations.
-- --------------------------------------------------------------------------

create or replace function public.resolve_parking_request(
  p_request_id uuid, p_decision text, p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.requests%rowtype;
  v_vehicle public.vehicles%rowtype;
begin
  select * into v_request from public.requests where id = p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if not private.has_community_role(v_request.community_id, array['ADMIN']::text[]) then raise exception 'No tienes permisos.'; end if;
  if v_request.state <> 'Abierta' then raise exception 'La solicitud ya fue resuelta.'; end if;
  if p_decision not in ('Aprobada','Rechazada') then raise exception 'Resolución no válida.'; end if;

  if p_decision = 'Aprobada' and v_request.vehicle_id is not null then
    select * into v_vehicle from public.vehicles where id = v_request.vehicle_id for update;
    if v_request.type in ('REACTIVACION_VEHICULO','ALTA_ACTIVACION') then
      perform public.reactivate_vehicle(v_vehicle.id);
    elsif v_request.type = 'RENOVACION_QR' then
      perform public.renew_vehicle_qr(v_vehicle.id);
    elsif v_request.type = 'BAJA' then
      update public.vehicles set state='Baja',slot=null,qr_token=null,qr_state=null where id=v_vehicle.id;
    end if;
  end if;

  update public.requests set
    state = p_decision, resolved_at = now(), resolved_by = (select auth.uid()),
    resolution_notes = coalesce(p_notes, '')
  where id = p_request_id returning * into v_request;
  return to_jsonb(v_request);
end;
$$;

revoke all on function public.resolve_parking_request(uuid,text,text) from public, anon;
grant execute on function public.resolve_parking_request(uuid,text,text) to authenticated;

create or replace function public.close_parking_incident(
  p_incident_id uuid, p_action text, p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents%rowtype;
  v_vehicle public.vehicles%rowtype;
begin
  select * into v_incident from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'Incidencia no encontrada.'; end if;
  if not private.has_community_role(v_incident.community_id, array['ADMIN']::text[]) then raise exception 'No tienes permisos.'; end if;
  if v_incident.state = 'Cerrada' then raise exception 'La incidencia ya está cerrada.'; end if;
  if btrim(coalesce(p_comment,'')) = '' then raise exception 'El comentario de cierre es obligatorio.'; end if;

  if v_incident.vehicle_id is not null then
    select * into v_vehicle from public.vehicles where id = v_incident.vehicle_id for update;
    if p_action = 'Revocar QR' then perform public.revoke_vehicle_qr(v_vehicle.id);
    elsif p_action = 'Renovar QR' then perform public.renew_vehicle_qr(v_vehicle.id);
    elsif p_action = 'Suspender vehículo' then update public.vehicles set state='Suspendido',slot=null,qr_token=null,qr_state=null where id=v_vehicle.id;
    elsif p_action = 'Dar de baja' then update public.vehicles set state='Baja',slot=null,qr_token=null,qr_state=null where id=v_vehicle.id;
    end if;
  end if;

  update public.incidents set
    state='Cerrada', closed_at=now(), closed_by=(select auth.uid()),
    close_action=coalesce(p_action,'Sin actuación'), close_comment=p_comment
  where id=p_incident_id returning * into v_incident;
  return to_jsonb(v_incident);
end;
$$;

revoke all on function public.close_parking_incident(uuid,text,text) from public, anon;
grant execute on function public.close_parking_incident(uuid,text,text) to authenticated;

-- --------------------------------------------------------------------------
-- Lightweight dashboard and ROOT diagnostics.
-- --------------------------------------------------------------------------

create or replace function public.app_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_community uuid;
begin
  select cm.community_id into v_community
    from public.community_members cm
   where cm.user_id=(select auth.uid()) and cm.state='Activo'
     and cm.roles && array['ADMIN']::text[]
   order by cm.created_at limit 1;
  if v_community is null and private.is_root() then
    select id into v_community from public.communities where state='Activo' order by created_at limit 1;
  end if;
  if v_community is null then raise exception 'No tienes permisos de administración.'; end if;

  return jsonb_build_object(
    'users', (select count(*) from public.community_members cm where cm.community_id=v_community),
    'housing', (select count(*) from public.dwellings d where d.community_id=v_community),
    'vehicles', (select count(*) from public.vehicles v where v.community_id=v_community),
    'activeVehicles', (select count(*) from public.vehicles v where v.community_id=v_community and v.state='Activo'),
    'openIncidents', (select count(*) from public.incidents i where i.community_id=v_community and i.state='Abierta'),
    'openRequests', (select count(*) from public.requests r where r.community_id=v_community and r.state='Abierta')
  );
end;
$$;

revoke all on function public.app_dashboard() from public, anon;
grant execute on function public.app_dashboard() to authenticated;

create or replace function public.root_system_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_root() then raise exception 'Acceso exclusivo ROOT.'; end if;
  return jsonb_build_object(
    'checkedAt', now(), 'database', 'OK',
    'communities', (select count(*) from public.communities),
    'profiles', (select count(*) from public.profiles where not is_root),
    'rootProfiles', (select count(*) from public.profiles where is_root),
    'dwellings', (select count(*) from public.dwellings),
    'vehicles', (select count(*) from public.vehicles),
    'openIncidents', (select count(*) from public.incidents where state='Abierta'),
    'openRequests', (select count(*) from public.requests where state='Abierta'),
    'auditRows', (select count(*) from public.audit_log)
  );
end;
$$;

revoke all on function public.root_system_status() from public, anon;
grant execute on function public.root_system_status() to authenticated;

commit;
