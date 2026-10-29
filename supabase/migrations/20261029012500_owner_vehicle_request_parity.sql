begin;

-- --------------------------------------------------------------------------
-- Owner vehicle/request parity with FIX11.29.
-- Owners use business RPCs instead of unrestricted table updates.
-- --------------------------------------------------------------------------

-- Direct writes stay available to ADMIN/ROOT. Owner mutations go through
-- save_parking_vehicle(), which enforces the stable state-transition rules.
drop policy if exists vehicles_insert_admin_or_owner on public.vehicles;
create policy vehicles_insert_admin on public.vehicles
for insert to authenticated
with check (private.has_community_role(community_id, array['ADMIN']::text[]));

drop policy if exists vehicles_update_admin_or_owner on public.vehicles;
create policy vehicles_update_admin on public.vehicles
for update to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]))
with check (private.has_community_role(community_id, array['ADMIN']::text[]));

-- CONTROL does not manage temporary periods in the stable app. ADMIN/ROOT and
-- the dwelling owner do.
drop policy if exists temporary_periods_write_staff_or_owner on public.temporary_periods;
create policy temporary_periods_write_admin_or_owner on public.temporary_periods
for all to authenticated
using (
  private.has_community_role(community_id, array['ADMIN']::text[])
  or private.owns_vehicle(vehicle_id)
)
with check (
  private.has_community_role(community_id, array['ADMIN']::text[])
  or private.owns_vehicle(vehicle_id)
);

-- Requests are created by ADMIN/ROOT or the owner. Resolution is ADMIN/ROOT.
drop policy if exists requests_select on public.requests;
create policy requests_select_admin_or_owner on public.requests
for select to authenticated
using (
  private.has_community_role(community_id, array['ADMIN']::text[])
  or requested_by = (select auth.uid())
  or private.owns_dwelling(dwelling_id)
);

drop policy if exists requests_insert_owner_or_staff on public.requests;
create policy requests_insert_admin_or_owner on public.requests
for insert to authenticated
with check (
  private.has_community_role(community_id, array['ADMIN']::text[])
  or (
    requested_by = (select auth.uid())
    and private.owns_dwelling(dwelling_id)
  )
);

drop policy if exists requests_update_staff on public.requests;
create policy requests_update_admin on public.requests
for update to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]))
with check (private.has_community_role(community_id, array['ADMIN']::text[]));

-- --------------------------------------------------------------------------
-- Save vehicle with the same intended owner/admin rules as the stable app.
-- New cars always auto-assign Slot 1, then Slot 2, otherwise Desasignado.
-- New motorcycles are Activo without slot/QR.
-- --------------------------------------------------------------------------
create or replace function public.save_parking_vehicle(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_id uuid := nullif(p_payload ->> 'ID_Vehiculo', '')::uuid;
  v_vehicle public.vehicles%rowtype;
  v_dwelling public.dwellings%rowtype;
  v_is_admin boolean := false;
  v_is_owner boolean := false;
  v_plate text;
  v_make text;
  v_model text;
  v_type text;
  v_state text;
  v_qr_state text;
  v_slot smallint;
  v_observations text;
  v_old_state text;
  v_new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  if v_id is not null then
    select * into v_vehicle
      from public.vehicles
     where id = v_id
     for update;
    if not found then raise exception 'Vehículo no encontrado.'; end if;
    v_old_state := v_vehicle.state;

    v_is_admin := private.has_community_role(v_vehicle.community_id, array['ADMIN']::text[]);
    v_is_owner := private.owns_vehicle(v_vehicle.id);
    if not (v_is_admin or v_is_owner) then
      raise exception 'No tienes permisos para modificar este vehículo.';
    end if;

    if v_is_owner and not v_is_admin then
      -- Owner editor keeps dwelling, type, slot, QR and observations. It can
      -- edit identity fields and make the same state changes as FIX11.29.
      v_plate := upper(btrim(coalesce(p_payload ->> 'MatriculaHabitual', v_vehicle.habitual_plate)));
      v_make := btrim(coalesce(p_payload ->> 'Marca', v_vehicle.make));
      v_model := btrim(coalesce(p_payload ->> 'Modelo', v_vehicle.model));
      v_state := coalesce(nullif(p_payload ->> 'Estado', ''), v_vehicle.state);

      if v_vehicle.state = 'Suspendido' and v_state <> 'Suspendido' then
        raise exception 'Un vehículo suspendido solo puede volver a habilitarse mediante una solicitud de activación aprobada.';
      end if;
      if v_vehicle.state = 'Baja' and v_state <> 'Baja' then
        raise exception 'Un vehículo dado de baja solo puede volver a habilitarse mediante una solicitud de activación aprobada.';
      end if;
      if v_vehicle.state = 'Activo' and v_state not in ('Activo','Desasignado','Baja') then
        raise exception 'Como propietario solo puedes mantener el vehículo activo, dejarlo desasignado o darlo de baja.';
      end if;
      if v_vehicle.state = 'Desasignado' and v_state not in ('Desasignado','Baja') then
        raise exception 'Un vehículo desasignado se activa al asignarle un slot.';
      end if;

      if v_plate = '' then raise exception 'La matrícula habitual es obligatoria.'; end if;

      update public.vehicles
         set habitual_plate = v_plate,
             make = v_make,
             model = v_model,
             state = v_state
       where id = v_vehicle.id
       returning * into v_vehicle;

      if v_old_state = 'Activo' and v_vehicle.state <> 'Activo' then
        update public.requests
           set state = 'Rechazada',
               resolved_at = now(),
               resolved_by = (select auth.uid()),
               resolution_notes = 'El vehículo dejó de estar activo.'
         where vehicle_id = v_vehicle.id
           and type = 'RENOVACION_QR'
           and state = 'Abierta';
      end if;

      return to_jsonb(v_vehicle);
    end if;

    -- ADMIN/ROOT edit. Missing fields preserve their current value.
    select * into v_dwelling
      from public.dwellings
     where id = coalesce(nullif(p_payload ->> 'ID_Vivienda', '')::uuid, v_vehicle.dwelling_id);
    if not found then raise exception 'Selecciona una vivienda válida.'; end if;
    if v_dwelling.community_id <> v_vehicle.community_id then
      raise exception 'La vivienda no pertenece a la comunidad del vehículo.';
    end if;

    v_plate := upper(btrim(coalesce(p_payload ->> 'MatriculaHabitual', v_vehicle.habitual_plate)));
    v_make := btrim(coalesce(p_payload ->> 'Marca', v_vehicle.make));
    v_model := btrim(coalesce(p_payload ->> 'Modelo', v_vehicle.model));
    v_type := coalesce(nullif(p_payload ->> 'Tipo', ''), v_vehicle.type);
    v_state := coalesce(nullif(p_payload ->> 'Estado', ''), v_vehicle.state);
    v_observations := coalesce(p_payload ->> 'Observaciones', v_vehicle.observations);
    v_qr_state := coalesce(nullif(p_payload ->> 'QR_Estado', ''), v_vehicle.qr_state);
    v_slot := case
      when p_payload ? 'Slot' and nullif(p_payload ->> 'Slot', '') is null then null
      when p_payload ? 'Slot' then (p_payload ->> 'Slot')::smallint
      else v_vehicle.slot
    end;

    if v_plate = '' then raise exception 'La matrícula habitual es obligatoria.'; end if;
    if v_type not in ('Particular','Empresa','Alquiler','Moto','Otro') then
      raise exception 'Tipo de vehículo no válido.';
    end if;
    if v_state not in ('Activo','Desasignado','Suspendido','Baja') then
      raise exception 'Estado de vehículo no válido.';
    end if;
    if v_state = 'Activo' and v_dwelling.state <> 'Activo' then
      raise exception 'La vivienda debe estar activa para tener vehículos activos.';
    end if;

    update public.vehicles
       set dwelling_id = v_dwelling.id,
           habitual_plate = v_plate,
           make = v_make,
           model = v_model,
           type = v_type,
           slot = v_slot,
           state = v_state,
           qr_state = v_qr_state,
           observations = v_observations
     where id = v_vehicle.id
     returning * into v_vehicle;

    if v_old_state = 'Activo' and v_vehicle.state <> 'Activo' then
      update public.requests
         set state = 'Rechazada',
             resolved_at = now(),
             resolved_by = (select auth.uid()),
             resolution_notes = 'El vehículo dejó de estar activo.'
       where vehicle_id = v_vehicle.id
         and type = 'RENOVACION_QR'
         and state = 'Abierta';
    end if;

    return to_jsonb(v_vehicle);
  end if;

  -- New vehicle: dwelling is mandatory and determines community.
  if nullif(p_payload ->> 'ID_Vivienda', '') is null then
    raise exception 'Debes seleccionar una vivienda.';
  end if;
  select * into v_dwelling
    from public.dwellings
   where id = (p_payload ->> 'ID_Vivienda')::uuid;
  if not found then raise exception 'Selecciona una vivienda válida.'; end if;

  v_is_admin := private.has_community_role(v_dwelling.community_id, array['ADMIN']::text[]);
  v_is_owner := private.owns_dwelling(v_dwelling.id);
  if not (v_is_admin or v_is_owner) then
    raise exception 'No tienes permisos para registrar un vehículo en esta vivienda.';
  end if;
  if v_is_owner and not v_is_admin and v_dwelling.state <> 'Activo' then
    raise exception 'Selecciona una vivienda activa asociada a tu usuario.';
  end if;

  v_plate := upper(btrim(coalesce(p_payload ->> 'MatriculaHabitual', '')));
  v_make := btrim(coalesce(p_payload ->> 'Marca', ''));
  v_model := btrim(coalesce(p_payload ->> 'Modelo', ''));
  v_type := coalesce(nullif(p_payload ->> 'Tipo', ''), 'Particular');
  v_observations := btrim(coalesce(p_payload ->> 'Observaciones', ''));
  if v_plate = '' then raise exception 'La matrícula habitual es obligatoria.'; end if;
  if v_type not in ('Particular','Empresa','Alquiler','Moto','Otro') then
    raise exception 'Tipo de vehículo no válido.';
  end if;

  if v_type = 'Moto' then
    v_slot := null;
    v_state := 'Activo';
  else
    v_slot := private.next_free_vehicle_slot(v_dwelling.id);
    v_state := case when v_slot is null then 'Desasignado' else 'Activo' end;
  end if;

  if v_state = 'Activo' and v_dwelling.state <> 'Activo' then
    raise exception 'La vivienda debe estar activa para tener vehículos activos.';
  end if;

  insert into public.vehicles (
    community_id, dwelling_id, habitual_plate, make, model, type,
    slot, state, qr_token, qr_state, observations
  ) values (
    v_dwelling.community_id, v_dwelling.id, v_plate, v_make, v_model, v_type,
    v_slot, v_state,
    case when v_type <> 'Moto' and v_slot is not null then gen_random_uuid()::text else null end,
    case when v_type <> 'Moto' and v_slot is not null then 'Activo' else null end,
    v_observations
  )
  returning * into v_vehicle;

  return to_jsonb(v_vehicle);
end;
$$;

revoke all on function public.save_parking_vehicle(jsonb) from public, anon;
grant execute on function public.save_parking_vehicle(jsonb) to authenticated;

-- --------------------------------------------------------------------------
-- Request creation: server-side parity with Requests.gs.
-- --------------------------------------------------------------------------
create or replace function public.create_parking_request(
  p_vehicle_id uuid,
  p_type text,
  p_reason text default '',
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_request public.requests%rowtype;
  v_is_admin boolean;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_vehicle
    from public.vehicles
   where id = p_vehicle_id;
  if not found then raise exception 'Vehículo no encontrado.'; end if;

  v_is_admin := private.has_community_role(v_vehicle.community_id, array['ADMIN']::text[]);
  if not (v_is_admin or private.owns_vehicle(v_vehicle.id)) then
    raise exception 'No tienes permisos para solicitar acciones sobre este vehículo.';
  end if;

  if p_type not in ('REACTIVACION_VEHICULO','RENOVACION_QR','PERMANENCIA_PROLONGADA') then
    raise exception 'Tipo de solicitud no válido.';
  end if;

  if p_type = 'REACTIVACION_VEHICULO' and v_vehicle.state not in ('Suspendido','Baja') then
    raise exception 'La activación solo puede solicitarse para un vehículo suspendido o dado de baja.';
  end if;

  if p_type = 'RENOVACION_QR' then
    if v_vehicle.type = 'Moto' then raise exception 'Las motos se controlan por matrícula y no utilizan QR.'; end if;
    if v_vehicle.state <> 'Activo' then raise exception 'La renovación de QR solo puede solicitarse para un vehículo activo.'; end if;
    if v_vehicle.slot not in (1,2) then raise exception 'El vehículo debe tener un slot asignado para renovar el QR.'; end if;
    if v_vehicle.qr_state <> 'Revocado' then raise exception 'Solo se puede solicitar la renovación de un QR revocado.'; end if;
  end if;

  if p_type = 'PERMANENCIA_PROLONGADA' then
    if v_vehicle.state <> 'Activo' then raise exception 'La permanencia prolongada solo puede solicitarse para un vehículo activo.'; end if;
    if p_start_date is null or p_end_date is null then raise exception 'Indica fecha de inicio y fecha de fin prevista.'; end if;
    if p_end_date < p_start_date then raise exception 'La fecha fin no puede ser anterior a la fecha inicio.'; end if;
    if not (
      v_reason = 'Viaje prolongado'
      or v_reason like 'Viaje prolongado · %'
      or v_reason = 'Vehículo inmovilizado'
      or v_reason like 'Vehículo inmovilizado · %'
      or v_reason like 'Otro · %'
    ) then
      raise exception 'Selecciona un motivo válido. Para Otro, el detalle es obligatorio.';
    end if;
    if exists (
      select 1 from public.requests r
       where r.vehicle_id = v_vehicle.id
         and r.type = 'PERMANENCIA_PROLONGADA'
         and r.state = 'Aprobada'
         and r.start_date <= p_end_date
         and r.end_date >= p_start_date
    ) then
      raise exception 'Ya existe una permanencia aprobada que se solapa con esas fechas.';
    end if;
  end if;

  if exists (
    select 1 from public.requests r
     where r.vehicle_id = v_vehicle.id
       and r.type = p_type
       and r.state = 'Abierta'
  ) then
    raise exception 'Ya existe una solicitud abierta de este tipo para el vehículo.';
  end if;

  insert into public.requests (
    community_id, requested_by, dwelling_id, vehicle_id, type, state, reason,
    origin_vehicle_state, origin_qr_state, origin_vehicle_type, origin_slot,
    origin_plate, start_date, end_date
  ) values (
    v_vehicle.community_id, (select auth.uid()), v_vehicle.dwelling_id, v_vehicle.id,
    p_type, 'Abierta', v_reason, v_vehicle.state,
    case when v_vehicle.type = 'Moto' then 'No aplica' else v_vehicle.qr_state end,
    v_vehicle.type, case when v_vehicle.type = 'Moto' then null else v_vehicle.slot end,
    v_vehicle.habitual_plate,
    case when p_type = 'PERMANENCIA_PROLONGADA' then p_start_date else null end,
    case when p_type = 'PERMANENCIA_PROLONGADA' then p_end_date else null end
  ) returning * into v_request;

  return to_jsonb(v_request);
end;
$$;

revoke all on function public.create_parking_request(uuid,text,text,date,date) from public, anon;
grant execute on function public.create_parking_request(uuid,text,text,date,date) to authenticated;

-- --------------------------------------------------------------------------
-- Request resolution: complete stable validation, including long-stay overlap.
-- --------------------------------------------------------------------------
create or replace function public.resolve_parking_request(
  p_request_id uuid, p_decision text, p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_request public.requests%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_note text := btrim(coalesce(p_notes, ''));
begin
  select * into v_request from public.requests where id = p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if not private.has_community_role(v_request.community_id, array['ADMIN']::text[]) then
    raise exception 'No tienes permisos.';
  end if;
  if v_request.state <> 'Abierta' then raise exception 'La solicitud ya fue resuelta por otro usuario o proceso.'; end if;
  if p_decision not in ('Aprobada','Rechazada') then raise exception 'Resolución no válida.'; end if;

  if p_decision = 'Aprobada' then
    select * into v_vehicle from public.vehicles where id = v_request.vehicle_id for update;
    if not found then raise exception 'Vehículo no encontrado.'; end if;

    if v_request.type = 'REACTIVACION_VEHICULO' then
      if v_vehicle.state not in ('Suspendido','Baja') then
        raise exception 'El vehículo ya no está en un estado compatible con la activación. Actualiza la solicitud antes de continuar.';
      end if;
      perform public.reactivate_vehicle(v_vehicle.id);
      if v_note = '' then
        v_note := case when v_vehicle.type = 'Moto'
          then 'Activación aprobada. La moto queda activa y se controla por matrícula.'
          else 'Activación aprobada. El vehículo queda Desasignado hasta que se le asigne un slot.' end;
      end if;

    elsif v_request.type = 'RENOVACION_QR' then
      if v_vehicle.type = 'Moto' then raise exception 'Las motos no utilizan QR.'; end if;
      if v_vehicle.state <> 'Activo' then raise exception 'El vehículo ya no está activo. No se puede renovar el QR.'; end if;
      if v_vehicle.slot not in (1,2) then raise exception 'El vehículo ya no tiene slot asignado.'; end if;
      if v_vehicle.qr_state <> 'Revocado' then raise exception 'El QR ya no está revocado.'; end if;
      perform public.renew_vehicle_qr(v_vehicle.id);
      if v_note = '' then v_note := 'QR anterior invalidado y nuevo QR generado.'; end if;

    elsif v_request.type = 'PERMANENCIA_PROLONGADA' then
      if v_vehicle.state <> 'Activo' then raise exception 'El vehículo ya no está activo. No se puede aprobar la permanencia.'; end if;
      if v_request.start_date is null or v_request.end_date is null or v_request.end_date < v_request.start_date then
        raise exception 'Las fechas de la solicitud no son válidas.';
      end if;
      if exists (
        select 1 from public.requests r
         where r.id <> v_request.id
           and r.vehicle_id = v_request.vehicle_id
           and r.type = 'PERMANENCIA_PROLONGADA'
           and r.state = 'Aprobada'
           and r.start_date <= v_request.end_date
           and r.end_date >= v_request.start_date
      ) then
        raise exception 'Ya existe otra permanencia aprobada que se solapa con estas fechas.';
      end if;
      if v_note = '' then v_note := 'Permanencia prolongada autorizada para el período solicitado.'; end if;
    end if;
  end if;

  update public.requests
     set state = p_decision,
         resolved_at = now(),
         resolved_by = (select auth.uid()),
         resolution_notes = v_note
   where id = v_request.id
   returning * into v_request;

  return to_jsonb(v_request);
end;
$$;

revoke all on function public.resolve_parking_request(uuid,text,text) from public, anon;
grant execute on function public.resolve_parking_request(uuid,text,text) to authenticated;

commit;
