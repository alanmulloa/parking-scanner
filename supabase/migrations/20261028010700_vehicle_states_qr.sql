
-- ============================================================
-- ESTADOS DE VEHICULO + QR
-- Parking Comunidad / Supabase POC
-- ============================================================

-- ------------------------------------------------------------
-- 1. Bloquear reactivaciones manuales
--
-- Produccion:
--   Suspendido -> solo mediante solicitud aprobada
--   Baja       -> solo mediante solicitud aprobada
--
-- Suspendido -> Baja SI esta permitido.
-- ------------------------------------------------------------

create or replace function public.guard_vehicle_state_reactivation()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  v_allowed text;
begin
  v_allowed :=
    coalesce(
      current_setting(
        'app.allow_vehicle_reactivation',
        true
      ),
      ''
    );

  if old.state = 'Baja'
     and new.state <> 'Baja'
     and v_allowed <> '1' then
    raise exception
      'Para volver a habilitar un vehículo de baja, debe aprobarse una solicitud de activación.';
  end if;

  if old.state = 'Suspendido'
     and new.state in ('Activo', 'Desasignado')
     and v_allowed <> '1' then
    raise exception
      'Para volver a habilitar un vehículo suspendido, debe aprobarse una solicitud de activación.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_00_guard_vehicle_state_reactivation
  on public.vehicles;

create trigger trg_00_guard_vehicle_state_reactivation
before update of state
on public.vehicles
for each row
execute function public.guard_vehicle_state_reactivation();


-- ------------------------------------------------------------
-- 2. Reactivacion
--
-- Coche:
--   Suspendido/Baja -> Desasignado
--   sin slot
--   sin QR
--
-- Moto:
--   Suspendido/Baja -> Activo
--   sin slot
--   sin QR
--
-- Esta RPC se conectara despues a la aprobacion de solicitudes.
-- ------------------------------------------------------------

create or replace function public.reactivate_vehicle(
  p_vehicle_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_vehicle public.vehicles%rowtype;
begin
  select *
    into v_vehicle
    from public.vehicles
   where id = p_vehicle_id
   for update;

  if not found then
    raise exception 'Vehículo no encontrado.';
  end if;

  if not private.has_community_role(
    v_vehicle.community_id,
    array['ADMIN']::text[]
  ) then
    raise exception
      'No tienes permisos para reactivar este vehículo.';
  end if;

  if v_vehicle.state not in ('Suspendido', 'Baja') then
    raise exception
      'El vehículo ya no está en un estado compatible con la activación.';
  end if;

  perform set_config(
    'app.allow_vehicle_reactivation',
    '1',
    true
  );

  update public.vehicles
     set state =
       case
         when v_vehicle.type = 'Moto'
           then 'Activo'
         else 'Desasignado'
       end,
       slot = null,
       qr_token = null,
       qr_state = null
   where id = p_vehicle_id
   returning * into v_vehicle;

  return jsonb_build_object(
    'ok', true,
    'vehicle', to_jsonb(v_vehicle),
    'message',
      case
        when v_vehicle.type = 'Moto'
          then 'Activación aprobada. La moto queda activa y se controla por matrícula.'
        else
          'Activación aprobada. El vehículo queda Desasignado hasta que se le asigne un slot.'
      end
  );
end;
$$;


-- ------------------------------------------------------------
-- 3. Revocar QR
--
-- Revocar:
--   conserva token
--   cambia QR a Revocado
--
-- Así el token anterior queda reconocido como revocado.
-- ------------------------------------------------------------

create or replace function public.revoke_vehicle_qr(
  p_vehicle_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_vehicle public.vehicles%rowtype;
begin
  select *
    into v_vehicle
    from public.vehicles
   where id = p_vehicle_id
   for update;

  if not found then
    raise exception 'Vehículo no encontrado.';
  end if;

  if not private.has_community_role(
    v_vehicle.community_id,
    array['ADMIN']::text[]
  ) then
    raise exception
      'No tienes permisos para revocar este QR.';
  end if;

  if v_vehicle.type = 'Moto' then
    raise exception
      'Las motos se controlan por matrícula y no utilizan QR.';
  end if;

  if v_vehicle.state <> 'Activo' then
    raise exception
      'Solo se puede revocar el QR de un vehículo activo.';
  end if;

  if v_vehicle.slot not in (1, 2) then
    raise exception
      'El vehículo no tiene slot asignado.';
  end if;

  if v_vehicle.qr_token is null then
    raise exception
      'Este vehículo no tiene QR generado.';
  end if;

  if v_vehicle.qr_state = 'Revocado' then
    return jsonb_build_object(
      'ok', true,
      'vehicle', to_jsonb(v_vehicle),
      'message', 'El QR ya estaba revocado.'
    );
  end if;

  update public.vehicles
     set qr_state = 'Revocado'
   where id = p_vehicle_id
   returning * into v_vehicle;

  return jsonb_build_object(
    'ok', true,
    'vehicle', to_jsonb(v_vehicle),
    'message', 'QR revocado.'
  );
end;
$$;


-- ------------------------------------------------------------
-- 4. Renovar QR
--
-- Produccion:
--   solo Activo
--   solo coche
--   requiere Slot 1/2
--   QR actual debe estar Revocado
--   vivienda debe estar Activa
--
-- Genera token NUEVO.
-- ------------------------------------------------------------

create or replace function public.renew_vehicle_qr(
  p_vehicle_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_dwelling public.dwellings%rowtype;
begin
  select *
    into v_vehicle
    from public.vehicles
   where id = p_vehicle_id
   for update;

  if not found then
    raise exception 'Vehículo no encontrado.';
  end if;

  if not private.has_community_role(
    v_vehicle.community_id,
    array['ADMIN']::text[]
  ) then
    raise exception
      'No tienes permisos para renovar este QR.';
  end if;

  if v_vehicle.type = 'Moto' then
    raise exception
      'Las motos se controlan por matrícula y no utilizan QR.';
  end if;

  if v_vehicle.state <> 'Activo' then
    raise exception
      'Solo se puede renovar el QR de un vehículo activo.';
  end if;

  if v_vehicle.slot not in (1, 2) then
    raise exception
      'Asigna un slot al vehículo antes de renovar el QR.';
  end if;

  if v_vehicle.qr_state <> 'Revocado' then
    raise exception
      'Solo se puede renovar un QR revocado.';
  end if;

  select *
    into v_dwelling
    from public.dwellings
   where id = v_vehicle.dwelling_id;

  if not found or v_dwelling.state <> 'Activo' then
    raise exception
      'La vivienda debe estar activa para renovar el QR.';
  end if;

  update public.vehicles
     set qr_token = gen_random_uuid()::text,
         qr_state = 'Activo'
   where id = p_vehicle_id
   returning * into v_vehicle;

  return jsonb_build_object(
    'ok', true,
    'vehicle', to_jsonb(v_vehicle),
    'message', 'QR renovado.'
  );
end;
$$;


-- ------------------------------------------------------------
-- 5. Permisos RPC
-- ------------------------------------------------------------

revoke all on function public.reactivate_vehicle(uuid)
  from public;

revoke all on function public.revoke_vehicle_qr(uuid)
  from public;

revoke all on function public.renew_vehicle_qr(uuid)
  from public;

grant execute on function public.reactivate_vehicle(uuid)
  to authenticated;

grant execute on function public.revoke_vehicle_qr(uuid)
  to authenticated;

grant execute on function public.renew_vehicle_qr(uuid)
  to authenticated;
