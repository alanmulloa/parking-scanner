
-- ============================================================
-- FIX reemplazo de vehículo
-- normalized_habitual_plate es una columna GENERATED
-- y no debe incluirse explícitamente en INSERT.
-- ============================================================

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

  /*
   * Solo calculamos la normalizada para validar.
   * NO la escribimos en la tabla porque es GENERATED.
   */
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
   * conserva slot y QR.
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
     * buscar primer slot libre.
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
   * Vehículo anterior -> Baja.
   *
   * Esto libera slot/QR y el trigger de Baja
   * anula temporales activos/futuros.
   */
  update public.vehicles
     set state = 'Baja',
         slot = null,
         qr_token = null,
         qr_state = null
   where id = v_old.id;

  /*
   * Nuevo vehículo.
   *
   * IMPORTANTE:
   * normalized_habitual_plate NO aparece en este INSERT.
   * PostgreSQL la genera automáticamente.
   */
  insert into public.vehicles (
    id,
    community_id,
    dwelling_id,
    slot,
    habitual_plate,
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


revoke all on function public.replace_vehicle(
  uuid, text, text, text, text, text
) from public;

grant execute on function public.replace_vehicle(
  uuid, text, text, text, text, text
) to authenticated;
