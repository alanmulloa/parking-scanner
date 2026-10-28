
-- ============================================================
-- Temporales + slots alineados con Parking Comunidad estable
-- ============================================================

-- ------------------------------------------------------------
-- 1. Un período puede durar un solo día
-- ------------------------------------------------------------

alter table public.temporary_periods
  drop constraint if exists temporary_periods_check;

alter table public.temporary_periods
  add constraint temporary_periods_check
  check (ends_at >= starts_at);


-- ------------------------------------------------------------
-- 2. Reglas operativas del vehículo
--
-- Moto:
--   nunca slot / QR
--
-- Desasignado, Suspendido, Baja:
--   nunca slot / QR
--
-- Activo coche:
--   requiere Slot 1/2 y QR
-- ------------------------------------------------------------

create or replace function public.apply_vehicle_authorization_rules()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  -- Las motos nunca utilizan slot ni QR.
  if new.type = 'Moto' then
    new.slot := null;
    new.qr_token := null;
    new.qr_state := null;
    return new;
  end if;

  -- Un vehículo no activo no puede conservar autorización.
  if new.state <> 'Activo' then
    new.slot := null;
    new.qr_token := null;
    new.qr_state := null;
    return new;
  end if;

  -- Coche activo sin slot -> Desasignado.
  if new.slot is null or new.slot not in (1, 2) then
    new.state := 'Desasignado';
    new.slot := null;
    new.qr_token := null;
    new.qr_state := null;
    return new;
  end if;

  -- Activo + slot: debe disponer de credencial.
  if new.qr_token is null or btrim(new.qr_token) = '' then
    new.qr_token := gen_random_uuid()::text;
  end if;

  if new.qr_state is null or btrim(new.qr_state) = '' then
    new.qr_state := 'Activo';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vehicle_authorization_rules
  on public.vehicles;

create trigger trg_vehicle_authorization_rules
before insert or update of type, state, slot, qr_token, qr_state
on public.vehicles
for each row
execute function public.apply_vehicle_authorization_rules();


-- ------------------------------------------------------------
-- 3. Baja:
--    anular temporales vigentes y futuros.
--
-- Suspensión:
--    NO toca temporary_periods.
--    Se conserva el temporal, pero deja de ser operativo porque
--    el vehículo ya no está Activo.
-- ------------------------------------------------------------

create or replace function public.annul_temporaries_on_vehicle_low()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if old.state is distinct from new.state
     and new.state = 'Baja' then

    update public.temporary_periods
       set state = 'Anulado',
           observations =
             case
               when coalesce(observations, '') = ''
                 then 'Anulado automáticamente al dar de baja el vehículo.'
               else observations ||
                    ' | Anulado automáticamente al dar de baja el vehículo.'
             end
     where vehicle_id = new.id
       and state = 'Activo'
       and ends_at >= current_date;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_annul_temporaries_on_vehicle_low
  on public.vehicles;

create trigger trg_annul_temporaries_on_vehicle_low
after update of state
on public.vehicles
for each row
execute function public.annul_temporaries_on_vehicle_low();


-- ------------------------------------------------------------
-- 4. Validación completa de matrícula temporal
-- ------------------------------------------------------------

create or replace function public.validate_temporary_period()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  v_vehicle public.vehicles%rowtype;
begin
  if tg_op = 'UPDATE'
     and old.vehicle_id is distinct from new.vehicle_id then
    raise exception 'Período no válido.';
  end if;

  -- Un período anulado puede actualizarse para su anulación
  -- aunque el vehículo ya no esté activo.
  if new.state = 'Anulado' then
    return new;
  end if;

  select *
    into v_vehicle
    from public.vehicles
   where id = new.vehicle_id;

  if not found then
    raise exception 'Vehículo no encontrado.';
  end if;

  new.community_id := v_vehicle.community_id;

  new.temporary_plate := upper(btrim(coalesce(new.temporary_plate, '')));

  new.normalized_temporary_plate :=
    regexp_replace(
      upper(coalesce(new.temporary_plate, '')),
      '[^A-Z0-9]',
      '',
      'g'
    );

  if new.normalized_temporary_plate = '' then
    raise exception 'Completa la matrícula temporal.';
  end if;

  if new.starts_at is null or new.ends_at is null then
    raise exception 'Completa matrícula temporal, desde y hasta.';
  end if;

  if new.ends_at < new.starts_at then
    raise exception 'La fecha hasta no puede ser anterior a la fecha desde.';
  end if;

  -- Crear / editar / prorrogar únicamente con vehículo activo.
  if v_vehicle.state <> 'Activo' then
    raise exception
      'Solo se pueden crear o modificar períodos mientras el vehículo está activo.';
  end if;

  -- Temporal distinta a la habitual del propio vehículo.
  if new.normalized_temporary_plate =
     v_vehicle.normalized_habitual_plate then
    raise exception
      'La matrícula temporal debe ser distinta de la habitual.';
  end if;

  -- No solapar períodos del mismo vehículo.
  if exists (
    select 1
      from public.temporary_periods tp
     where tp.id <> coalesce(new.id, gen_random_uuid())
       and tp.vehicle_id = new.vehicle_id
       and tp.state <> 'Anulado'
       and daterange(tp.starts_at, tp.ends_at, '[]')
           && daterange(new.starts_at, new.ends_at, '[]')
  ) then
    raise exception
      'Este período se solapa con otro período temporal del mismo vehículo.';
  end if;

  -- La temporal no puede ser la habitual de otro vehículo activo.
  if exists (
    select 1
      from public.vehicles v
     where v.community_id = new.community_id
       and v.id <> new.vehicle_id
       and v.state = 'Activo'
       and v.normalized_habitual_plate =
           new.normalized_temporary_plate
  ) then
    raise exception
      'La matrícula temporal coincide con la matrícula habitual de otro vehículo activo.';
  end if;

  -- Una misma matrícula temporal no puede estar simultáneamente
  -- asignada a dos períodos coincidentes.
  if exists (
    select 1
      from public.temporary_periods tp
     where tp.id <> coalesce(new.id, gen_random_uuid())
       and tp.community_id = new.community_id
       and tp.state <> 'Anulado'
       and tp.normalized_temporary_plate =
           new.normalized_temporary_plate
       and daterange(tp.starts_at, tp.ends_at, '[]')
           && daterange(new.starts_at, new.ends_at, '[]')
  ) then
    raise exception
      'La matrícula temporal ya está asignada en un período coincidente.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_temporary_period
  on public.temporary_periods;

create trigger trg_validate_temporary_period
before insert or update of
  vehicle_id,
  temporary_plate,
  starts_at,
  ends_at,
  state
on public.temporary_periods
for each row
execute function public.validate_temporary_period();


-- ------------------------------------------------------------
-- 5. RPC: asignar / cambiar / reasignar slot
--
-- Operación transaccional:
-- el vehículo que ocupaba el slot queda Desasignado
-- y pierde su QR antes de asignarlo al nuevo.
-- ------------------------------------------------------------

create or replace function public.assign_vehicle_slot(
  p_vehicle_id uuid,
  p_slot integer,
  p_confirm_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_target public.vehicles%rowtype;
  v_occupied public.vehicles%rowtype;
  v_has_occupied boolean := false;
  v_was_unassigned boolean := false;
  v_message text;
begin
  select *
    into v_target
    from public.vehicles
   where id = p_vehicle_id
   for update;

  if not found then
    raise exception 'Vehículo no encontrado.';
  end if;

  if not (
    private.has_community_role(
      v_target.community_id,
      array['ADMIN']::text[]
    )
    or private.owns_vehicle(v_target.id)
  ) then
    raise exception 'No tienes permisos para modificar este vehículo.';
  end if;

  if v_target.state not in ('Activo', 'Desasignado') then
    raise exception
      'Solo se puede asignar slot a un vehículo activo o desasignado.';
  end if;

  if v_target.type = 'Moto' then
    raise exception 'Las motos no ocupan slot.';
  end if;

  if p_slot not in (1, 2) then
    raise exception 'Selecciona Slot 1 o Slot 2.';
  end if;

  if not exists (
    select 1
      from public.dwellings d
     where d.id = v_target.dwelling_id
       and d.state = 'Activo'
  ) then
    raise exception
      'La vivienda debe estar activa para asignar un slot.';
  end if;

  if v_target.slot = p_slot
     and v_target.state = 'Activo' then
    return jsonb_build_object(
      'vehicle', to_jsonb(v_target),
      'released', null,
      'message',
      'El vehículo ya tiene asignado el Slot ' || p_slot || '.'
    );
  end if;

  select *
    into v_occupied
    from public.vehicles
   where community_id = v_target.community_id
     and dwelling_id = v_target.dwelling_id
     and id <> v_target.id
     and state = 'Activo'
     and type <> 'Moto'
     and slot = p_slot
   limit 1
   for update;

  v_has_occupied := found;

  if v_has_occupied and not p_confirm_replace then
    raise exception
      'El Slot % está asignado a %. Confirma la liberación para continuar.',
      p_slot,
      v_occupied.habitual_plate;
  end if;

  v_was_unassigned :=
    v_target.state = 'Desasignado'
    or v_target.slot is null;

  if v_has_occupied then
    update public.vehicles
       set state = 'Desasignado',
           slot = null,
           qr_token = null,
           qr_state = null
     where id = v_occupied.id
     returning * into v_occupied;
  end if;

  update public.vehicles
     set state = 'Activo',
         slot = p_slot,
         qr_token =
           case
             when v_was_unassigned
               then gen_random_uuid()::text
             else coalesce(
               nullif(qr_token, ''),
               gen_random_uuid()::text
             )
           end,
         qr_state =
           case
             when v_was_unassigned
               then 'Activo'
             else coalesce(nullif(qr_state, ''), 'Activo')
           end
   where id = v_target.id
   returning * into v_target;

  if v_has_occupied then
    v_message :=
      'Slot ' || p_slot ||
      ' reasignado desde ' ||
      v_occupied.habitual_plate ||
      ' a ' ||
      v_target.habitual_plate ||
      '.';

    if v_was_unassigned then
      v_message := v_message ||
        ' Se generó un QR nuevo para el vehículo asignado.';
    else
      v_message := v_message ||
        ' Se conserva el QR propio del vehículo asignado.';
    end if;
  else
    v_message :=
      'Slot ' || p_slot ||
      ' asignado a ' ||
      v_target.habitual_plate ||
      '.';

    if v_was_unassigned then
      v_message := v_message ||
        ' Se generó un QR nuevo.';
    end if;
  end if;

  return jsonb_build_object(
    'vehicle', to_jsonb(v_target),
    'released',
      case
        when v_has_occupied then to_jsonb(v_occupied)
        else null
      end,
    'message', v_message
  );
end;
$$;


-- ------------------------------------------------------------
-- 6. RPC: liberar slot
-- ------------------------------------------------------------

create or replace function public.release_vehicle_slot(
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

  if not (
    private.has_community_role(
      v_vehicle.community_id,
      array['ADMIN']::text[]
    )
    or private.owns_vehicle(v_vehicle.id)
  ) then
    raise exception 'No tienes permisos para modificar este vehículo.';
  end if;

  if v_vehicle.type = 'Moto'
     or v_vehicle.slot is null then
    return jsonb_build_object(
      'vehicle', to_jsonb(v_vehicle),
      'message', 'El vehículo no tiene slot asignado.'
    );
  end if;

  update public.vehicles
     set state = 'Desasignado',
         slot = null,
         qr_token = null,
         qr_state = null
   where id = p_vehicle_id
   returning * into v_vehicle;

  return jsonb_build_object(
    'vehicle', to_jsonb(v_vehicle),
    'message', 'Slot liberado.'
  );
end;
$$;


revoke all on function public.assign_vehicle_slot(uuid, integer, boolean)
  from public;

revoke all on function public.release_vehicle_slot(uuid)
  from public;

grant execute on function public.assign_vehicle_slot(uuid, integer, boolean)
  to authenticated;

grant execute on function public.release_vehicle_slot(uuid)
  to authenticated;
