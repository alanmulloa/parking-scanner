begin;

-- CONTROL needs the same owner identity visibility used by the stable access
-- screen, while ROOT remains invisible to non-root users.
create or replace function private.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.session_is_current() and (
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
          join public.community_members target on target.community_id = me.community_id
         where me.user_id = (select auth.uid())
           and me.state = 'Activo'
           and me.roles && array['ADMIN','CONTROL']::text[]
           and target.user_id = target_user
      )
    )
  );
$$;

revoke all on function private.can_view_profile(uuid) from public;
grant execute on function private.can_view_profile(uuid) to authenticated, service_role;

-- Public community assets (logos). The object path always starts with the
-- community UUID so RLS can validate ADMIN/ROOT ownership.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'parking-public',
  'parking-public',
  true,
  3145728,
  array['image/png','image/jpeg','image/webp','image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists parking_public_insert_admin on storage.objects;
drop policy if exists parking_public_update_admin on storage.objects;
drop policy if exists parking_public_delete_admin on storage.objects;

create policy parking_public_insert_admin on storage.objects
for insert to authenticated
with check (
  bucket_id = 'parking-public'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and private.has_community_role(((storage.foldername(name))[1])::uuid, array['ADMIN']::text[])
);

create policy parking_public_update_admin on storage.objects
for update to authenticated
using (
  bucket_id = 'parking-public'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and private.has_community_role(((storage.foldername(name))[1])::uuid, array['ADMIN']::text[])
)
with check (
  bucket_id = 'parking-public'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and private.has_community_role(((storage.foldername(name))[1])::uuid, array['ADMIN']::text[])
);

create policy parking_public_delete_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'parking-public'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and private.has_community_role(((storage.foldername(name))[1])::uuid, array['ADMIN']::text[])
);

-- Branding is safe to expose before login; keep the public surface restricted
-- to the fields used by the login/header UI.
create or replace function public.parking_public_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with active_community as (
    select c.id from public.communities c where c.state = 'Activo' order by c.created_at limit 1
  )
  select coalesce(jsonb_object_agg(cs.key, cs.value), '{}'::jsonb)
    from public.community_settings cs
    join active_community ac on ac.id = cs.community_id
   where cs.key in ('NombreOficial','NombreCorto','Descripcion','Direccion','EmailContacto','LogoUrl','ColorPrincipal','ColorSecundario','ColorAcento');
$$;

revoke all on function public.parking_public_settings() from public;
grant execute on function public.parking_public_settings() to anon, authenticated;

-- Assisted consistency review from the stable application. Constraints still
-- remain the primary protection; this report is an administrative diagnostic.
create or replace function public.parking_consistency_report()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
  v_items jsonb := '[]'::jsonb;
  r record;
begin
  select cm.community_id into v_community
    from public.community_members cm
   where cm.user_id = (select auth.uid())
     and cm.state = 'Activo'
     and cm.roles && array['ADMIN']::text[]
   order by cm.created_at limit 1;

  if v_community is null and private.is_root() then
    select c.id into v_community from public.communities c
     where c.state = 'Activo' order by c.created_at limit 1;
  end if;
  if v_community is null then raise exception 'Acceso exclusivo de administración.'; end if;

  for r in
    select v.id, v.dwelling_id, v.habitual_plate
      from public.vehicles v
     where v.community_id = v_community
       and v.type = 'Moto' and v.slot is not null
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'severity','Error','code','MOTO_CON_SLOT','label','Moto con slot asignado',
      'detail',r.habitual_plate,'vehicleId',r.id,'housingId',r.dwelling_id,'view','vehicles'));
  end loop;

  for r in
    select v.id, v.dwelling_id, v.habitual_plate
      from public.vehicles v
     where v.community_id = v_community
       and v.type = 'Moto' and (v.qr_token is not null or v.qr_state is not null)
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'severity','Error','code','MOTO_QR_ACTIVO','label','Moto con QR asociado',
      'detail',r.habitual_plate,'vehicleId',r.id,'housingId',r.dwelling_id,'view','vehicles'));
  end loop;

  for r in
    select v.id, v.dwelling_id, v.habitual_plate, v.state
      from public.vehicles v
     where v.community_id = v_community
       and v.state in ('Desasignado','Suspendido','Baja')
       and (v.slot is not null or v.qr_token is not null or v.qr_state is not null)
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'severity','Error','code','NO_ACTIVO_CON_ACCESO','label','Vehículo no activo con slot/QR asociado',
      'detail',r.habitual_plate || ' · ' || r.state,'vehicleId',r.id,'housingId',r.dwelling_id,'view','vehicles'));
  end loop;

  for r in
    select v.id, v.dwelling_id, v.habitual_plate
      from public.vehicles v
      join public.dwellings d on d.id = v.dwelling_id
     where v.community_id = v_community
       and v.state = 'Activo' and d.state <> 'Activo'
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'severity','Error','code','VIVIENDA_INACTIVA','label','Vehículo activo en vivienda inactiva',
      'detail',r.habitual_plate,'vehicleId',r.id,'housingId',r.dwelling_id,'view','vehicles'));
  end loop;

  for r in
    select v.id, v.dwelling_id, v.habitual_plate
      from public.vehicles v
     where v.community_id = v_community
       and v.state = 'Activo' and v.type <> 'Moto' and v.slot is not null
       and (v.qr_token is null or v.qr_state not in ('Activo','Revocado'))
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'severity','Error','code','SLOT_SIN_QR','label','Vehículo con slot sin QR válido',
      'detail',r.habitual_plate,'vehicleId',r.id,'housingId',r.dwelling_id,'view','vehicles'));
  end loop;

  for r in
    select v.id, v.dwelling_id, v.habitual_plate
      from public.vehicles v
     where v.community_id = v_community
       and v.state = 'Activo' and v.type <> 'Moto' and v.slot is null
       and (v.qr_token is not null or v.qr_state is not null)
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'severity','Error','code','QR_SIN_SLOT','label','Vehículo sin slot con QR asociado',
      'detail',r.habitual_plate,'vehicleId',r.id,'housingId',r.dwelling_id,'view','vehicles'));
  end loop;

  for r in
    select v.id, v.dwelling_id, v.habitual_plate, p.temporary_plate
      from public.temporary_periods p
      join public.vehicles v on v.id = p.vehicle_id
     where p.community_id = v_community
       and p.state <> 'Anulado'
       and current_date between p.starts_at and p.ends_at
       and v.state <> 'Activo'
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'severity','Error','code','TEMPORAL_NO_ACTIVO','label','Temporal vigente en vehículo no activo',
      'detail',r.temporary_plate || ' · ' || r.habitual_plate,'vehicleId',r.id,'housingId',r.dwelling_id,'view','vehicles'));
  end loop;

  for r in
    select p1.vehicle_id, v.dwelling_id, p1.temporary_plate,
           p1.starts_at a_from, p1.ends_at a_to, p2.starts_at b_from, p2.ends_at b_to
      from public.temporary_periods p1
      join public.temporary_periods p2
        on p2.community_id = p1.community_id
       and p2.id > p1.id
       and p2.normalized_temporary_plate = p1.normalized_temporary_plate
       and p2.state <> 'Anulado' and p1.state <> 'Anulado'
       and p2.starts_at <= p1.ends_at and p1.starts_at <= p2.ends_at
      join public.vehicles v on v.id = p1.vehicle_id
     where p1.community_id = v_community
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'severity','Error','code','TEMPORAL_SOLAPADO','label','Períodos temporales solapados · ' || r.temporary_plate,
      'detail',r.a_from || '–' || r.a_to || ' / ' || r.b_from || '–' || r.b_to,
      'vehicleId',r.vehicle_id,'housingId',r.dwelling_id,'view','vehicles'));
  end loop;

  for r in
    select q.id request_id, v.id vehicle_id, v.dwelling_id, v.habitual_plate, q.type, v.state, v.type vehicle_type
      from public.requests q
      join public.vehicles v on v.id = q.vehicle_id
     where q.community_id = v_community and q.state = 'Abierta'
       and ((q.type = 'REACTIVACION_VEHICULO' and v.state = 'Activo')
         or (q.type = 'RENOVACION_QR' and (v.state <> 'Activo' or v.type = 'Moto')))
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'severity','Aviso','code','SOLICITUD_INCOMPATIBLE','label','Solicitud abierta incompatible con el estado actual',
      'detail',r.habitual_plate || ' · ' || r.type,'vehicleId',r.vehicle_id,'housingId',r.dwelling_id,'view','requests'));
  end loop;

  return jsonb_build_object(
    'generatedAt', now(),
    'errors', (select count(*) from jsonb_array_elements(v_items) x where x->>'severity' = 'Error'),
    'warnings', (select count(*) from jsonb_array_elements(v_items) x where x->>'severity' = 'Aviso'),
    'items', v_items,
    'note', 'Duplicados de matrícula habitual y de slot están protegidos por índices UNIQUE en Supabase.'
  );
end;
$$;

revoke all on function public.parking_consistency_report() from public, anon;
grant execute on function public.parking_consistency_report() to authenticated;

create or replace function public.parking_consistency_fix(p_code text, p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_count integer := 0;
begin
  select v.* into v_vehicle from public.vehicles v where v.id = p_vehicle_id;
  if not found then raise exception 'Vehículo no encontrado.'; end if;
  if not private.has_community_role(v_vehicle.community_id, array['ADMIN']::text[]) then
    raise exception 'Acceso exclusivo de administración.';
  end if;

  if p_code = 'MOTO_CON_SLOT' then
    if v_vehicle.type <> 'Moto' then raise exception 'El vehículo ya no es una moto.'; end if;
    update public.vehicles set slot = null where id = p_vehicle_id;
    return jsonb_build_object('message','Slot eliminado de la moto.');
  elsif p_code = 'MOTO_QR_ACTIVO' then
    if v_vehicle.type <> 'Moto' then raise exception 'El vehículo ya no es una moto.'; end if;
    update public.vehicles set qr_token = null, qr_state = null where id = p_vehicle_id;
    return jsonb_build_object('message','Asociación QR eliminada de la moto.');
  elsif p_code = 'TEMPORAL_NO_ACTIVO' then
    if v_vehicle.state = 'Activo' then raise exception 'El vehículo ya está activo.'; end if;
    update public.temporary_periods
       set state = 'Anulado', observations = concat_ws(' | ', nullif(observations,''), 'Anulado por corrección asistida.')
     where vehicle_id = p_vehicle_id and state <> 'Anulado'
       and current_date between starts_at and ends_at;
    get diagnostics v_count = row_count;
    return jsonb_build_object('message', case when v_count > 0 then 'Temporal vigente anulado.' else 'No había un temporal vigente para anular.' end);
  elsif p_code = 'MATRICULA_DUPLICADA' then
    raise exception 'Supabase impide duplicados de matrícula habitual mediante un índice UNIQUE; no existe una consolidación automática pendiente.';
  end if;
  raise exception 'Esta inconsistencia requiere revisión manual.';
end;
$$;

revoke all on function public.parking_consistency_fix(text,uuid) from public, anon;
grant execute on function public.parking_consistency_fix(text,uuid) to authenticated;

commit;
