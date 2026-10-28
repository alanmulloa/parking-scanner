
-- ============================================================
-- REEMPLAZAR VEHICULO + ACCIONES MASIVAS
-- ============================================================

-- ------------------------------------------------------------
-- 1. Reemplazar vehículo
-- ------------------------------------------------------------

create or replace function public.replace_vehicle(
  p_vehicle_id uuid,
  p_habitual_plate text,
  p_type text,
  p_make text default null,
  p_model text default null,
  p_observations text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_old public.vehicles%rowtype;
  v_new public.vehicles%rowtype;

  v_normalized_plate text;
  v_new_id uuid := gen_random_uuid();

  v_slot integer;
  v_qr_token text;
  v_qr_state text;
  v_state text;

  v_keep_authorization boolean := false;
begin
  select *
    into v_old
    from public.vehicles
   where id = p_vehicle_id
   for update;

  if not found then
    raise exception 'Vehículo a reemplazar no encontrado.';
  end if;

  if not (
    private.has_community_role(
      v_old.community_id,
      array['ADMIN']::text[]
    )
    or private.owns_vehicle(v_old.id)
  ) then
    raise exception
      'No tienes permisos para reemplazar este vehículo.';
  end if;

  if v_old.state <> 'Activo' then
    raise exception
      'Solo se puede reemplazar un vehículo activo.';
  end if;

  if p_type not in (
    'Particular',
    'Empresa',
    'Alquiler',
    'Moto',
    'Otro'
  ) then
    raise exception 'Tipo de vehículo no válido.';
  end if;

  v_normalized_plate :=
    regexp_replace(
      upper(coalesce(p_habitual_plate, '')),
      '[^A-Z0-9]',
      '',
      'g'
    );

  if v_normalized_plate = '' then
    raise exception
      'La matrícula del nuevo vehículo es obligatoria.';
  end if;

  if v_normalized_plate =
     v_old.normalized_habitual_plate then
    raise exception
      'La matrícula nueva coincide con la actual. Si es el mismo vehículo, utiliza Editar en lugar de Reemplazar.';
  end if;

  if exists (
    select 1
      from public.vehicles v
     where v.community_id = v_old.community_id
       and v.id <> v_old.id
       and v.normalized_habitual_plate =
           v_normalized_plate
  ) then
    raise exception
      'La matrícula del nuevo vehículo ya está registrada en otro vehículo. Edita o consolida el registro existente.';
  end if;

  /*
   * Coche -> coche:
   * conserva slot y QR del vehículo anterior.
   */
  v_keep_authorization :=
    p_type <> 'Moto'
    and v_old.type <> 'Moto'
    and v_old.slot in (1, 2);

  if p_type = 'Moto' then

    v_state := 'Activo';
    v_slot := null;
    v_qr_token := null;
    v_qr_state := null;

  elsif v_keep_authorization then

    v_state := 'Activo';
    v_slot := v_old.slot;
    v_qr_token :=
      coalesce(
        nullif(v_old.qr_token, ''),
        gen_random_uuid()::text
      );
    v_qr_state :=
      coalesce(
        nullif(v_old.qr_state, ''),
        'Activo'
      );

  else

    /*
     * Moto -> coche:
     * primer slot libre.
     *
     * Si ambos están ocupados:
     * nuevo vehículo queda Desasignado.
     */
    select candidate.slot
      into v_slot
      from (
        values (1), (2)
      ) as candidate(slot)
     where not exists (
       select 1
         from public.vehicles v
        where v.dwelling_id = v_old.dwelling_id
          and v.id <> v_old.id
          and v.state = 'Activo'
          and v.type <> 'Moto'
          and v.slot = candidate.slot
     )
     order by candidate.slot
     limit 1;

    if v_slot is null then
      v_state := 'Desasignado';
      v_qr_token := null;
      v_qr_state := null;
    else
      v_state := 'Activo';
      v_qr_token := gen_random_uuid()::text;
      v_qr_state := 'Activo';
    end if;

  end if;

  /*
   * Primero damos de baja el anterior.
   *
   * Los triggers ya:
   * - liberan slot
   * - eliminan QR
   * - anulan temporales activos/futuros por Baja
   *
   * Si después falla el INSERT, toda la RPC hace rollback.
   */
  update public.vehicles
     set state = 'Baja',
         slot = null,
         qr_token = null,
         qr_state = null
   where id = v_old.id;

  /*
   * Alta del nuevo.
   */
  insert into public.vehicles (
    id,
    community_id,
    dwelling_id,
    slot,
    habitual_plate,
    normalized_habitual_plate,
    make,
    model,
    type,
    state,
    qr_token,
    qr_state,
    observations
  )
  values (
    v_new_id,
    v_old.community_id,
    v_old.dwelling_id,
    v_slot,
    upper(btrim(p_habitual_plate)),
    v_normalized_plate,
    nullif(btrim(coalesce(p_make, '')), ''),
    nullif(btrim(coalesce(p_model, '')), ''),
    p_type,
    v_state,
    v_qr_token,
    v_qr_state,
    nullif(btrim(coalesce(p_observations, '')), '')
  )
  returning * into v_new;

  return jsonb_build_object(
    'ok', true,
    'oldVehicleId', v_old.id,
    'newVehicleId', v_new.id,
    'keptSlot', v_keep_authorization,
    'newState', v_new.state,
    'newSlot', v_new.slot
  );
end;
$$;


-- ------------------------------------------------------------
-- 2. Preview de acción masiva
-- ------------------------------------------------------------

create or replace function public.bulk_vehicle_preview(
  p_vehicle_ids uuid[],
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_selected integer := 0;
  v_cars integer := 0;
  v_motos integer := 0;

  v_state_changes integer := 0;
  v_slots_released integer := 0;

  v_qr_revoked integer := 0;
  v_qr_removed integer := 0;
  v_qr_skipped_motos integer := 0;

  v_temporals integer := 0;
begin
  if p_action not in (
    'SUSPENDER',
    'BAJA',
    'REVOCAR_QR'
  ) then
    raise exception 'Acción masiva no válida.';
  end if;

  if coalesce(array_length(p_vehicle_ids, 1), 0) = 0 then
    raise exception 'Selecciona al menos un vehículo.';
  end if;

  if array_length(p_vehicle_ids, 1) > 100 then
    raise exception
      'Máximo 100 vehículos por operación.';
  end if;

  if exists (
    select 1
      from public.vehicles v
     where v.id = any(p_vehicle_ids)
       and not private.has_community_role(
         v.community_id,
         array['ADMIN']::text[]
       )
  ) then
    raise exception
      'No tienes permisos para realizar esta operación.';
  end if;

  select
    count(*),
    count(*) filter (where type <> 'Moto'),
    count(*) filter (where type = 'Moto')
  into
    v_selected,
    v_cars,
    v_motos
  from public.vehicles
  where id = any(p_vehicle_ids);

  if p_action = 'SUSPENDER' then

    select
      count(*),
      count(*) filter (
        where type <> 'Moto'
          and slot is not null
      ),
      count(*) filter (
        where type <> 'Moto'
          and (
            qr_token is not null
            or qr_state is not null
          )
      )
    into
      v_state_changes,
      v_slots_released,
      v_qr_removed
    from public.vehicles
    where id = any(p_vehicle_ids)
      and state not in ('Suspendido', 'Baja');

    /*
     * Nuestra regla nueva:
     * suspender conserva los temporales.
     */
    v_temporals := 0;

  elsif p_action = 'BAJA' then

    select
      count(*),
      count(*) filter (
        where type <> 'Moto'
          and slot is not null
      ),
      count(*) filter (
        where type <> 'Moto'
          and (
            qr_token is not null
            or qr_state is not null
          )
      )
    into
      v_state_changes,
      v_slots_released,
      v_qr_removed
    from public.vehicles
    where id = any(p_vehicle_ids)
      and state <> 'Baja';

    select count(*)
      into v_temporals
      from public.temporary_periods tp
     where tp.vehicle_id = any(p_vehicle_ids)
       and tp.state = 'Activo'
       and tp.ends_at >= current_date;

  else

    select count(*)
      into v_qr_revoked
      from public.vehicles
     where id = any(p_vehicle_ids)
       and type <> 'Moto'
       and state = 'Activo'
       and slot in (1, 2)
       and qr_token is not null
       and qr_state is distinct from 'Revocado';

    v_qr_skipped_motos := v_motos;

  end if;

  return jsonb_build_object(
    'selected', v_selected,
    'cars', v_cars,
    'motos', v_motos,
    'stateChanges', v_state_changes,
    'slotsReleased', v_slots_released,
    'qrRevoked', v_qr_revoked,
    'temporalsAnnulled', v_temporals,
    'qrRemoved', v_qr_removed,
    'qrSkippedMotos', v_qr_skipped_motos
  );
end;
$$;


-- ------------------------------------------------------------
-- 3. Ejecutar acción masiva
-- ------------------------------------------------------------

create or replace function public.bulk_vehicle_action(
  p_vehicle_ids uuid[],
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_changed integer := 0;
  v_preview jsonb;
begin
  v_preview :=
    public.bulk_vehicle_preview(
      p_vehicle_ids,
      p_action
    );

  for v_vehicle in
    select *
      from public.vehicles
     where id = any(p_vehicle_ids)
     for update
  loop

    if p_action = 'SUSPENDER' then

      /*
       * Baja no vuelve a Suspendido.
       */
      if v_vehicle.state in ('Suspendido', 'Baja') then
        continue;
      end if;

      update public.vehicles
         set state = 'Suspendido',
             slot = null,
             qr_token = null,
             qr_state = null
       where id = v_vehicle.id;

      /*
       * NO anulamos temporales al suspender.
       */

      v_changed := v_changed + 1;

    elsif p_action = 'BAJA' then

      if v_vehicle.state = 'Baja' then
        continue;
      end if;

      update public.vehicles
         set state = 'Baja',
             slot = null,
             qr_token = null,
             qr_state = null
       where id = v_vehicle.id;

      /*
       * El trigger de Baja anula temporales
       * activos/futuros.
       */

      v_changed := v_changed + 1;

    elsif p_action = 'REVOCAR_QR' then

      if v_vehicle.type = 'Moto'
         or v_vehicle.state <> 'Activo'
         or v_vehicle.slot not in (1, 2)
         or v_vehicle.qr_token is null
         or v_vehicle.qr_state = 'Revocado' then
        continue;
      end if;

      update public.vehicles
         set qr_state = 'Revocado'
       where id = v_vehicle.id;

      v_changed := v_changed + 1;

    end if;

  end loop;

  return jsonb_build_object(
    'ok', true,
    'changed', v_changed,
    'preview', v_preview
  );
end;
$$;


-- ------------------------------------------------------------
-- 4. Permisos
-- ------------------------------------------------------------

revoke all on function public.replace_vehicle(
  uuid, text, text, text, text, text
) from public;

revoke all on function public.bulk_vehicle_preview(
  uuid[], text
) from public;

revoke all on function public.bulk_vehicle_action(
  uuid[], text
) from public;

grant execute on function public.replace_vehicle(
  uuid, text, text, text, text, text
) to authenticated;

grant execute on function public.bulk_vehicle_preview(
  uuid[], text
) to authenticated;

grant execute on function public.bulk_vehicle_action(
  uuid[], text
) to authenticated;
