-- --------------------------------------------------------------------------
-- Save housing / dwelling.
--
-- Replaces the remaining client-side saveHousing implementation from the
-- transitional Supabase POC adapter.
--
-- Only ADMIN users may create or modify dwellings.
-- The responsible owner, when present, must be a member of the same community.
-- --------------------------------------------------------------------------

create or replace function public.save_parking_housing(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_id uuid := nullif(p_payload ->> 'ID_Vivienda', '')::uuid;
  v_dwelling public.dwellings%rowtype;
  v_community_id uuid;
  v_admin_community_count integer := 0;

  v_responsible_user_id uuid := null;
  v_responsible_email text;

  v_block text;
  v_floor text;
  v_apartment text;
  v_display_name text;
  v_state text;
  v_observations text;
begin
  if (select auth.uid()) is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  -- ------------------------------------------------------------------------
  -- Existing dwelling: community is immutable and comes from the row.
  -- ------------------------------------------------------------------------
  if v_id is not null then
    select *
      into v_dwelling
      from public.dwellings
     where id = v_id
     for update;

    if not found then
      raise exception 'Vivienda no encontrada.';
    end if;

    v_community_id := v_dwelling.community_id;

    if not private.has_community_role(
      v_community_id,
      array['ADMIN']::text[]
    ) then
      raise exception 'No tienes permisos para modificar esta vivienda.';
    end if;

  -- ------------------------------------------------------------------------
  -- New dwelling.
  -- Prefer an explicit CommunityId if supplied. With a single ADMIN
  -- membership we can safely infer it. Multiple communities require an
  -- explicit selection instead of choosing one arbitrarily.
  -- ------------------------------------------------------------------------
  else
    v_community_id := nullif(p_payload ->> 'CommunityId', '')::uuid;

    if v_community_id is not null then
      if not private.has_community_role(
        v_community_id,
        array['ADMIN']::text[]
      ) then
        raise exception 'No tienes permisos para registrar viviendas en esta comunidad.';
      end if;
    else
      select
        count(*),
        (array_agg(cm.community_id order by cm.community_id))[1]
        into v_admin_community_count, v_community_id
        from public.community_members cm
       where cm.user_id = (select auth.uid())
         and 'ADMIN' = any(cm.roles);

      if v_admin_community_count = 0 or v_community_id is null then
        raise exception 'No se pudo determinar una comunidad administrada por el usuario.';
      end if;

      if v_admin_community_count > 1 then
        raise exception 'Debes seleccionar la comunidad de la vivienda.';
      end if;
    end if;
  end if;

  -- ------------------------------------------------------------------------
  -- Required dwelling fields.
  -- ------------------------------------------------------------------------
  v_block := btrim(coalesce(p_payload ->> 'Bloque', ''));
  v_floor := btrim(coalesce(p_payload ->> 'Planta', ''));
  v_apartment := btrim(coalesce(p_payload ->> 'Apartamento', ''));

  if v_block = '' or v_floor = '' or v_apartment = '' then
    raise exception 'Bloque, planta y apartamento son obligatorios.';
  end if;

  v_display_name :=
    'Bloque ' || v_block || ', ' || v_floor || ' ' || v_apartment;

  v_state := case
    when coalesce(p_payload ->> 'Estado', '') in ('Inactiva', 'Inactivo')
      then 'Inactivo'
    else 'Activo'
  end;

  v_observations := btrim(coalesce(p_payload ->> 'Observaciones', ''));

  -- ------------------------------------------------------------------------
  -- Responsible owner.
  --
  -- The frontend currently sends the selected owner email. Resolve it only
  -- when that profile is also a member of this same community.
  -- ------------------------------------------------------------------------
  v_responsible_email :=
    lower(btrim(coalesce(p_payload ->> 'Responsable', '')));

  if v_responsible_email <> '' then
    select p.user_id
      into v_responsible_user_id
      from public.profiles p
      join public.community_members cm
        on cm.user_id = p.user_id
       and cm.community_id = v_community_id
     where lower(p.email) = v_responsible_email
     limit 1;

    if v_responsible_user_id is null then
      raise exception 'No se encontró el propietario seleccionado en esta comunidad.';
    end if;
  end if;

  -- ------------------------------------------------------------------------
  -- Update.
  -- ------------------------------------------------------------------------
  if v_id is not null then
    update public.dwellings
       set block = v_block,
           floor = v_floor,
           apartment = v_apartment,
           display_name = v_display_name,
           responsible_user_id = v_responsible_user_id,
           state = v_state,
           observations = v_observations
     where id = v_id
     returning * into v_dwelling;

    return to_jsonb(v_dwelling);
  end if;

  -- ------------------------------------------------------------------------
  -- Insert.
  -- ------------------------------------------------------------------------
  insert into public.dwellings (
    community_id,
    block,
    floor,
    apartment,
    display_name,
    responsible_user_id,
    state,
    observations
  )
  values (
    v_community_id,
    v_block,
    v_floor,
    v_apartment,
    v_display_name,
    v_responsible_user_id,
    v_state,
    v_observations
  )
  returning * into v_dwelling;

  return to_jsonb(v_dwelling);
end;
$$;

revoke all on function public.save_parking_housing(jsonb)
  from public, anon;

grant execute on function public.save_parking_housing(jsonb)
  to authenticated;
