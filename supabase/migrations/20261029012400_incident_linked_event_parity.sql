begin;

-- FIX PREPROD: parity with the stable linked-incident model.
-- A single evidence object can legitimately support several linked incidents/followups.
alter table public.file_objects
  drop constraint if exists file_objects_bucket_id_object_path_key;

create index if not exists file_objects_object_path_idx
  on public.file_objects(bucket_id, object_path);

create unique index if not exists file_objects_incident_object_unique
  on public.file_objects(bucket_id, object_path, incident_id)
  where incident_id is not null;

create unique index if not exists file_objects_followup_object_unique
  on public.file_objects(bucket_id, object_path, followup_id)
  where followup_id is not null;

-- FIX11.5 parity: one follow-up per incident/day is too strict for linked QR cases.
-- The same QR owner can have A+B and A+C on the same day; only A+B repeated twice
-- on that same day must be blocked.
alter table public.incident_followups
  add column if not exists relation_key text not null default '';

drop index if exists public.incident_followups_one_per_incident_day;

create or replace function private.parking_incident_fingerprint(
  p_type text,
  p_situation text,
  p_vehicle_id uuid,
  p_infraction_plate text,
  p_observed_plate text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_type,'') = 'Otro' then ''
    when coalesce(p_type,'') in ('Estacionamiento o ubicación indebida','Uso indebido') then
      (case when p_vehicle_id is not null then 'V:' || p_vehicle_id::text else 'P:' || coalesce(public.normalize_plate(coalesce(p_infraction_plate,p_observed_plate)),'') end)
      || '|' || coalesce(p_type,'') || '|' || coalesce(p_situation,'')
    when coalesce(p_type,'') = 'QR no corresponde con matrícula' then
      (case when p_vehicle_id is not null then 'V:' || p_vehicle_id::text else 'P:' || coalesce(public.normalize_plate(coalesce(p_infraction_plate,p_observed_plate)),'') end)
      || '|' || coalesce(p_type,'')
    else
      (case when p_vehicle_id is not null then 'V:' || p_vehicle_id::text else 'P:' || coalesce(public.normalize_plate(coalesce(p_infraction_plate,p_observed_plate)),'') end)
      || '|' || coalesce(p_type,'')
  end;
$$;

create or replace function private.parking_followup_fingerprint(
  p_type text,
  p_situation text,
  p_cause text,
  p_vehicle_id uuid,
  p_infraction_plate text,
  p_observed_plate text,
  p_control_origin text,
  p_related_vehicle_id uuid,
  p_related_plate text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_type,'') = 'Otro' then ''
    when coalesce(p_type,'') = 'Uso indebido' and coalesce(p_situation,'') in ('Cesión de QR','Uso de QR ajeno') then
      (case when p_vehicle_id is not null then 'V:' || p_vehicle_id::text else 'P:' || coalesce(public.normalize_plate(coalesce(p_infraction_plate,p_observed_plate)),'') end)
      || '|' || p_type || '|' || p_situation
    when coalesce(p_type,'') = 'QR no corresponde con matrícula' then
      (case when p_vehicle_id is not null then 'V:' || p_vehicle_id::text else 'P:' || coalesce(public.normalize_plate(coalesce(p_infraction_plate,p_observed_plate)),'') end)
      || '|' || p_type || '|QR:' || coalesce(p_related_vehicle_id::text, public.normalize_plate(p_related_plate), '')
    when coalesce(p_type,'') = 'Matrícula no registrada' and coalesce(p_control_origin,'') = 'QR' then
      (case when p_vehicle_id is not null then 'V:' || p_vehicle_id::text else 'P:' || coalesce(public.normalize_plate(coalesce(p_infraction_plate,p_observed_plate)),'') end)
      || '|' || p_type
    when coalesce(p_type,'') in ('Acceso no autorizado','Estacionamiento o ubicación indebida','Vehículo inmovilizado / posible abandono','Fuga / pérdida de líquidos') then
      (case when p_vehicle_id is not null then 'V:' || p_vehicle_id::text else 'P:' || coalesce(public.normalize_plate(coalesce(p_infraction_plate,p_observed_plate)),'') end)
      || '|' || coalesce(p_type,'') || '|' || coalesce(p_situation,'') || '|' || coalesce(p_cause,'')
    else
      (case when p_vehicle_id is not null then 'V:' || p_vehicle_id::text else 'P:' || coalesce(public.normalize_plate(coalesce(p_infraction_plate,p_observed_plate)),'') end)
      || '|' || coalesce(p_type,'')
  end;
$$;

create or replace function private.parking_linked_relation_key(
  p_type text,
  p_situation text,
  p_control_origin text,
  p_related_vehicle_id uuid,
  p_related_plate text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_control_origin,'') <> 'QR' then ''
    when coalesce(p_related_vehicle_id::text, public.normalize_plate(p_related_plate), '') = '' then ''
    when coalesce(p_type,'') = 'Uso indebido' and coalesce(p_situation,'') in ('Cesión de QR','Uso de QR ajeno') then
      p_type || '|' || p_situation || '|' || coalesce(p_related_vehicle_id::text, public.normalize_plate(p_related_plate), '')
    when coalesce(p_type,'') = 'Matrícula no registrada' then
      p_type || '|' || coalesce(p_related_vehicle_id::text, public.normalize_plate(p_related_plate), '')
    else ''
  end;
$$;

-- Reconstruct relation keys for imported/existing follow-ups using their parent incident.
update public.incident_followups f
   set relation_key = private.parking_linked_relation_key(
     i.type,
     coalesce(nullif(f.situation,''), i.situation),
     coalesce(nullif(f.control_origin,''), i.control_origin),
     f.related_vehicle_id,
     f.related_plate
   )
  from public.incidents i
 where i.id=f.incident_id;

create unique index if not exists incident_followups_one_relation_per_incident_day
  on public.incident_followups(incident_id, occurred_date, relation_key);

create or replace function private.insert_parking_incident_candidate(
  p_community_id uuid,
  p_candidate jsonb
)
returns public.incidents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.incidents%rowtype;
  v_vehicle uuid := nullif(p_candidate->>'vehicle_id','')::uuid;
  v_dwelling uuid := nullif(p_candidate->>'dwelling_id','')::uuid;
  v_related_vehicle uuid := nullif(p_candidate->>'related_vehicle_id','')::uuid;
  v_related_dwelling uuid := nullif(p_candidate->>'related_dwelling_id','')::uuid;
begin
  if btrim(coalesce(p_candidate->>'description','')) = '' then raise exception 'Completa la observación / descripción.'; end if;
  if btrim(coalesce(p_candidate->>'photo_url','')) = '' then raise exception 'Debes adjuntar una fotografía antes de registrar la incidencia.'; end if;

  if v_vehicle is not null and not exists(select 1 from public.vehicles v where v.id=v_vehicle and v.community_id=p_community_id) then
    raise exception 'El vehículo de la incidencia no pertenece a la comunidad.';
  end if;
  if v_dwelling is not null and not exists(select 1 from public.dwellings d where d.id=v_dwelling and d.community_id=p_community_id) then
    raise exception 'La vivienda de la incidencia no pertenece a la comunidad.';
  end if;
  if v_related_vehicle is not null and not exists(select 1 from public.vehicles v where v.id=v_related_vehicle and v.community_id=p_community_id) then
    raise exception 'El vehículo relacionado no pertenece a la comunidad.';
  end if;
  if v_related_dwelling is not null and not exists(select 1 from public.dwellings d where d.id=v_related_dwelling and d.community_id=p_community_id) then
    raise exception 'La vivienda relacionada no pertenece a la comunidad.';
  end if;

  insert into public.incidents(
    community_id,created_by,observed_plate,infraction_plate,authorized_plate,
    dwelling_id,vehicle_id,type,description,photo_url,state,control_origin,origin_state,
    origin_vehicle_state,origin_qr_state,origin_vehicle_type,origin_slot,origin_habitual_plate,
    expired_itv,event_id,situation,cause,related_dwelling_id,related_vehicle_id,related_plate,
    attempts,priority,fluid_leak
  ) values (
    p_community_id,(select auth.uid()),
    public.normalize_plate(p_candidate->>'observed_plate'),
    public.normalize_plate(p_candidate->>'infraction_plate'),
    public.normalize_plate(p_candidate->>'authorized_plate'),
    v_dwelling,v_vehicle,p_candidate->>'type',p_candidate->>'description',p_candidate->>'photo_url','Abierta',
    coalesce(nullif(p_candidate->>'control_origin',''),'Manual'),coalesce(p_candidate->>'origin_state',''),
    nullif(p_candidate->>'origin_vehicle_state',''),nullif(p_candidate->>'origin_qr_state',''),nullif(p_candidate->>'origin_vehicle_type',''),
    nullif(p_candidate->>'origin_slot','')::smallint,public.normalize_plate(p_candidate->>'origin_habitual_plate'),
    coalesce((p_candidate->>'expired_itv')::boolean,false),coalesce(nullif(p_candidate->>'event_id',''),gen_random_uuid()::text),
    nullif(p_candidate->>'situation',''),nullif(p_candidate->>'cause',''),v_related_dwelling,v_related_vehicle,
    public.normalize_plate(p_candidate->>'related_plate'),1,'Normal',coalesce((p_candidate->>'fluid_leak')::boolean,false)
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.save_parking_incident_candidates(
  p_community_id uuid,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate jsonb;
  v_existing public.incidents%rowtype;
  v_inserted public.incidents%rowtype;
  v_fp text;
  v_relation text;
  v_existing_relation text;
  v_touched boolean;
  v_matched jsonb := '[]'::jsonb;
  v_eligible jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_created jsonb := '[]'::jsonb;
  v_reused jsonb := '[]'::jsonb;
  v_mode text;
begin
  if not private.has_community_role(p_community_id,array['ADMIN','CONTROL']::text[]) then raise exception 'No tienes permisos.'; end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates)=0 then raise exception 'No hay incidencias para guardar.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_community_id::text, 0));

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    v_fp := private.parking_incident_fingerprint(
      v_candidate->>'type',v_candidate->>'situation',nullif(v_candidate->>'vehicle_id','')::uuid,
      v_candidate->>'infraction_plate',v_candidate->>'observed_plate'
    );
    v_existing := null;
    if v_fp <> '' then
      select i.* into v_existing
        from public.incidents i
       where i.community_id=p_community_id and i.state='Abierta'
         and private.parking_incident_fingerprint(i.type,i.situation,i.vehicle_id,i.infraction_plate,i.observed_plate)=v_fp
       order by i.occurred_at asc limit 1;
    end if;

    if v_existing.id is null then
      v_missing := v_missing || jsonb_build_array(v_candidate);
      continue;
    end if;

    v_relation := private.parking_linked_relation_key(
      v_candidate->>'type',v_candidate->>'situation',v_candidate->>'control_origin',
      nullif(v_candidate->>'related_vehicle_id','')::uuid,v_candidate->>'related_plate'
    );
    v_existing_relation := private.parking_linked_relation_key(
      v_existing.type,v_existing.situation,v_existing.control_origin,v_existing.related_vehicle_id,v_existing.related_plate
    );

    if v_relation <> '' then
      v_touched := ((v_existing.occurred_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date and v_existing_relation=v_relation)
        or exists(select 1 from public.incident_followups f where f.incident_id=v_existing.id and f.occurred_date=(now() at time zone 'Europe/Madrid')::date and f.relation_key=v_relation);
    else
      v_touched := ((v_existing.occurred_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date)
        or exists(select 1 from public.incident_followups f where f.incident_id=v_existing.id and f.occurred_date=(now() at time zone 'Europe/Madrid')::date);
    end if;

    v_matched := v_matched || jsonb_build_array(to_jsonb(v_existing));
    if v_touched then v_blocked := v_blocked || jsonb_build_array(to_jsonb(v_existing));
    else v_eligible := v_eligible || jsonb_build_array(to_jsonb(v_existing)); end if;
  end loop;

  if jsonb_array_length(v_matched)=0 then
    for v_candidate in select value from jsonb_array_elements(v_missing)
    loop
      v_inserted := private.insert_parking_incident_candidate(p_community_id,v_candidate);
      v_created := v_created || jsonb_build_array(to_jsonb(v_inserted));
    end loop;
    return jsonb_build_object('mode','CREATED','created',v_created,'reused','[]'::jsonb);
  end if;

  v_mode := case when jsonb_array_length(v_eligible)>0 then 'FOLLOWUP_REQUIRED' else 'BLOCKED' end;

  -- Stable parity: if every existing leg is blocked today but this event contains a genuinely
  -- new leg, create only that missing leg and reuse the existing ones.
  if v_mode='BLOCKED' and jsonb_array_length(v_missing)>0 then
    for v_candidate in select value from jsonb_array_elements(v_missing)
    loop
      v_inserted := private.insert_parking_incident_candidate(p_community_id,v_candidate);
      v_created := v_created || jsonb_build_array(to_jsonb(v_inserted));
    end loop;
    select coalesce(jsonb_agg(x->>'id'),'[]'::jsonb) into v_reused from jsonb_array_elements(v_matched) x;
    return jsonb_build_object('mode','CREATED','created',v_created,'reused',v_reused,'message','Se registraron las incidencias nuevas del evento y se reutilizaron las incidencias abiertas ya existentes.');
  end if;

  return jsonb_build_object(
    'mode',v_mode,
    'existing',case when v_mode='FOLLOWUP_REQUIRED' then v_eligible else v_matched end,
    'blocked',v_blocked,
    'message',case when v_mode='BLOCKED' then 'Ya existe una incidencia equivalente registrada o seguida hoy para la misma relación. No se puede registrar otro intento igual el mismo día.' else 'Ya existe una incidencia equivalente abierta. Puedes registrar el seguimiento de esta relación.' end
  );
end;
$$;

create or replace function public.preview_parking_incident_followup(
  p_anchor_id uuid,
  p_candidates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anchor public.incidents%rowtype;
  v_candidate jsonb;
  v_existing public.incidents%rowtype;
  v_resolved public.incidents%rowtype;
  v_key text;
  v_relation text;
  v_existing_relation text;
  v_touched boolean;
  v_ops jsonb := '[]'::jsonb;
  v_event_rows jsonb := '[]'::jsonb;
  v_followups integer := 0;
  v_created integer := 0;
  v_skip_today integer := 0;
  v_skip_resolved integer := 0;
  v_occurrence text := gen_random_uuid()::text;
  v_row public.incidents%rowtype;
begin
  select * into v_anchor from public.incidents where id=p_anchor_id;
  if not found then raise exception 'Incidencia no encontrada.'; end if;
  if v_anchor.state <> 'Abierta' then raise exception 'La incidencia ya no está abierta.'; end if;
  if not private.has_community_role(v_anchor.community_id,array['ADMIN','CONTROL']::text[]) then raise exception 'No tienes permisos.'; end if;

  if v_anchor.event_id is null or v_anchor.event_id='' then
    v_event_rows := jsonb_build_array(to_jsonb(v_anchor));
  else
    select coalesce(jsonb_agg(to_jsonb(i) order by i.occurred_at),'[]'::jsonb) into v_event_rows
      from public.incidents i where i.community_id=v_anchor.community_id and i.event_id=v_anchor.event_id;
  end if;

  if jsonb_typeof(p_candidates)='array' and jsonb_array_length(p_candidates)>0 then
    for v_candidate in select value from jsonb_array_elements(p_candidates)
    loop
      v_key := private.parking_followup_fingerprint(
        v_candidate->>'type',v_candidate->>'situation',v_candidate->>'cause',nullif(v_candidate->>'vehicle_id','')::uuid,
        v_candidate->>'infraction_plate',v_candidate->>'observed_plate',v_candidate->>'control_origin',
        nullif(v_candidate->>'related_vehicle_id','')::uuid,v_candidate->>'related_plate'
      );
      v_existing := null;
      if v_key <> '' then
        select i.* into v_existing from public.incidents i
         where i.community_id=v_anchor.community_id and i.state='Abierta'
           and private.parking_followup_fingerprint(i.type,i.situation,i.cause,i.vehicle_id,i.infraction_plate,i.observed_plate,i.control_origin,i.related_vehicle_id,i.related_plate)=v_key
         order by i.occurred_at asc limit 1;
      end if;

      if v_existing.id is not null then
        v_relation := private.parking_linked_relation_key(
          v_candidate->>'type',v_candidate->>'situation',v_candidate->>'control_origin',nullif(v_candidate->>'related_vehicle_id','')::uuid,v_candidate->>'related_plate'
        );
        v_existing_relation := private.parking_linked_relation_key(v_existing.type,v_existing.situation,v_existing.control_origin,v_existing.related_vehicle_id,v_existing.related_plate);
        if v_relation <> '' then
          v_touched := ((v_existing.occurred_at at time zone 'Europe/Madrid')::date=(now() at time zone 'Europe/Madrid')::date and v_existing_relation=v_relation)
            or exists(select 1 from public.incident_followups f where f.incident_id=v_existing.id and f.occurred_date=(now() at time zone 'Europe/Madrid')::date and f.relation_key=v_relation);
        else
          v_touched := ((v_existing.occurred_at at time zone 'Europe/Madrid')::date=(now() at time zone 'Europe/Madrid')::date)
            or exists(select 1 from public.incident_followups f where f.incident_id=v_existing.id and f.occurred_date=(now() at time zone 'Europe/Madrid')::date);
        end if;
        if v_touched then
          v_skip_today := v_skip_today+1;
          v_ops := v_ops || jsonb_build_array(jsonb_build_object('action','SKIP_TODAY','reason','Misma relación ya registrada o seguida hoy','existing',to_jsonb(v_existing),'candidate',v_candidate));
        else
          v_followups := v_followups+1;
          v_ops := v_ops || jsonb_build_array(jsonb_build_object('action','FOLLOWUP','existing',to_jsonb(v_existing),'candidate',v_candidate,'event_id',coalesce(nullif(v_candidate->>'event_id',''),v_occurrence)));
        end if;
        continue;
      end if;

      v_resolved := null;
      if v_key <> '' then
        select i.* into v_resolved from public.incidents i
         where i.community_id=v_anchor.community_id and i.state<>'Abierta'
           and (v_anchor.event_id is not null and i.event_id=v_anchor.event_id)
           and private.parking_followup_fingerprint(i.type,i.situation,i.cause,i.vehicle_id,i.infraction_plate,i.observed_plate,i.control_origin,i.related_vehicle_id,i.related_plate)=v_key
         order by i.occurred_at desc limit 1;
      end if;
      if v_resolved.id is not null then
        v_skip_resolved := v_skip_resolved+1;
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('action','SKIP_RESOLVED','reason','La incidencia vinculada original ya está resuelta','existing',to_jsonb(v_resolved),'candidate',v_candidate));
      else
        v_created := v_created+1;
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('action','CREATE','candidate',v_candidate,'event_id',coalesce(nullif(v_candidate->>'event_id',''),v_occurrence)));
      end if;
    end loop;
  else
    for v_row in select * from public.incidents i
      where i.community_id=v_anchor.community_id and i.state='Abierta'
        and (i.id=v_anchor.id or (v_anchor.event_id is not null and i.event_id=v_anchor.event_id))
    loop
      v_touched := ((v_row.occurred_at at time zone 'Europe/Madrid')::date=(now() at time zone 'Europe/Madrid')::date)
        or exists(select 1 from public.incident_followups f where f.incident_id=v_row.id and f.occurred_date=(now() at time zone 'Europe/Madrid')::date);
      if v_touched then
        v_skip_today:=v_skip_today+1;
        v_ops:=v_ops||jsonb_build_array(jsonb_build_object('action','SKIP_TODAY','reason','Misma relación ya registrada o seguida hoy','existing',to_jsonb(v_row)));
      else
        v_followups:=v_followups+1;
        v_ops:=v_ops||jsonb_build_array(jsonb_build_object('action','FOLLOWUP','existing',to_jsonb(v_row),'candidate',to_jsonb(v_row),'event_id',v_occurrence));
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'anchor',to_jsonb(v_anchor),'linkedOriginal',v_event_rows,'occurrenceEventId',v_occurrence,'operations',v_ops,
    'summary',jsonb_build_object('followups',v_followups,'created',v_created,'skippedToday',v_skip_today,'skippedResolved',v_skip_resolved),
    'canSave',(v_followups+v_created)>0
  );
end;
$$;

create or replace function public.save_parking_incident_followup(
  p_anchor_id uuid,
  p_candidates jsonb,
  p_observation text,
  p_photo_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_op jsonb;
  v_existing public.incidents%rowtype;
  v_candidate jsonb;
  v_follow public.incident_followups%rowtype;
  v_created_row public.incidents%rowtype;
  v_attempt integer;
  v_relation text;
  v_updated jsonb := '[]'::jsonb;
  v_created jsonb := '[]'::jsonb;
  v_followup_ids jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if btrim(coalesce(p_observation,''))='' then raise exception 'La observación del seguimiento es obligatoria.'; end if;
  if btrim(coalesce(p_photo_url,''))='' then raise exception 'La fotografía del seguimiento es obligatoria.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_anchor_id::text, 0));
  v_plan := public.preview_parking_incident_followup(p_anchor_id,coalesce(p_candidates,'[]'::jsonb));
  if not coalesce((v_plan->>'canSave')::boolean,false) then
    if coalesce((v_plan->'summary'->>'skippedToday')::integer,0)>0 then raise exception 'Las incidencias vinculadas ya fueron registradas o seguidas hoy.'; end if;
    raise exception 'No hay incidencias abiertas disponibles para registrar seguimiento.';
  end if;

  for v_op in select value from jsonb_array_elements(v_plan->'operations')
  loop
    if v_op->>'action'='FOLLOWUP' then
      select * into v_existing from public.incidents where id=(v_op->'existing'->>'id')::uuid for update;
      if not found or v_existing.state<>'Abierta' then raise exception 'La incidencia ya no está abierta.'; end if;
      v_candidate := coalesce(v_op->'candidate','{}'::jsonb);
      v_attempt := greatest(1,coalesce(v_existing.attempts,1))+1;
      v_relation := private.parking_linked_relation_key(
        coalesce(nullif(v_candidate->>'type',''),v_existing.type),coalesce(nullif(v_candidate->>'situation',''),v_existing.situation),
        coalesce(nullif(v_candidate->>'control_origin',''),v_existing.control_origin),
        coalesce(nullif(v_candidate->>'related_vehicle_id','')::uuid,v_existing.related_vehicle_id),
        coalesce(nullif(v_candidate->>'related_plate',''),v_existing.related_plate)
      );
      insert into public.incident_followups(
        community_id,incident_id,event_id,followup_event_id,created_by,attempt_number,
        observed_plate,authorized_plate,control_origin,origin_state,situation,
        related_dwelling_id,related_vehicle_id,related_plate,observation,photo_url,relation_key
      ) values (
        v_existing.community_id,v_existing.id,v_existing.event_id,coalesce(nullif(v_op->>'event_id',''),v_plan->>'occurrenceEventId'),(select auth.uid()),v_attempt,
        public.normalize_plate(coalesce(nullif(v_candidate->>'observed_plate',''),v_existing.observed_plate)),
        public.normalize_plate(coalesce(nullif(v_candidate->>'authorized_plate',''),v_existing.authorized_plate)),
        coalesce(nullif(v_candidate->>'control_origin',''),v_existing.control_origin),
        coalesce(nullif(v_candidate->>'origin_state',''),v_existing.origin_state),
        coalesce(nullif(v_candidate->>'situation',''),v_existing.situation),
        coalesce(nullif(v_candidate->>'related_dwelling_id','')::uuid,v_existing.related_dwelling_id),
        coalesce(nullif(v_candidate->>'related_vehicle_id','')::uuid,v_existing.related_vehicle_id),
        public.normalize_plate(coalesce(nullif(v_candidate->>'related_plate',''),v_existing.related_plate)),
        p_observation,p_photo_url,v_relation
      ) returning * into v_follow;
      update public.incidents set attempts=v_attempt,
        priority=case when v_attempt>=7 then 'Crítica' when v_attempt>=5 then 'Alta' when v_attempt>=3 then 'Atención' else 'Normal' end,
        last_followup_at=v_follow.occurred_at
       where id=v_existing.id;
      v_updated := v_updated || jsonb_build_array(v_existing.id::text);
      v_followup_ids := v_followup_ids || jsonb_build_array(v_follow.id::text);
    elsif v_op->>'action'='CREATE' then
      v_candidate := v_op->'candidate';
      v_candidate := jsonb_set(v_candidate,'{description}',to_jsonb(p_observation),true);
      v_candidate := jsonb_set(v_candidate,'{photo_url}',to_jsonb(p_photo_url),true);
      v_candidate := jsonb_set(v_candidate,'{event_id}',to_jsonb(coalesce(nullif(v_op->>'event_id',''),v_plan->>'occurrenceEventId')),true);
      v_created_row := private.insert_parking_incident_candidate((v_plan->'anchor'->>'community_id')::uuid,v_candidate);
      v_created := v_created || jsonb_build_array(to_jsonb(v_created_row));
    else
      v_skipped := v_skipped || jsonb_build_array(v_op);
    end if;
  end loop;

  return jsonb_build_object('ok',true,'updated',v_updated,'created',v_created,'followupIds',v_followup_ids,'skipped',v_skipped,'plan',v_plan);
end;
$$;

-- Stable close semantics: actions are constrained by incident type/current vehicle state,
-- and QR-mismatch revocation targets the vehicle that actually owns the presented QR.
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
  v_qr_vehicle public.vehicles%rowtype;
  v_allowed text[] := array['Sin actuación','Aviso al propietario']::text[];
  v_state text;
  v_moto boolean := false;
begin
  select * into v_incident from public.incidents where id=p_incident_id for update;
  if not found then raise exception 'Incidencia no encontrada.'; end if;
  if not private.has_community_role(v_incident.community_id,array['ADMIN']::text[]) then raise exception 'No tienes permisos.'; end if;
  if v_incident.state='Cerrada' then raise exception 'La incidencia ya fue cerrada por otro usuario o proceso.'; end if;
  if btrim(coalesce(p_comment,''))='' then raise exception 'El comentario de cierre es obligatorio.'; end if;

  if v_incident.vehicle_id is not null then
    select * into v_vehicle from public.vehicles where id=v_incident.vehicle_id for update;
    v_state := v_vehicle.state;
    v_moto := v_vehicle.type='Moto';
  end if;

  if v_incident.type='Uso indebido' then
    if v_incident.situation='Cesión de QR' then
      if v_vehicle.id is not null and v_state='Activo' then
        if not v_moto and coalesce(v_vehicle.qr_state,'')<>'Revocado' then v_allowed:=array_append(v_allowed,'Revocar QR'); end if;
        v_allowed:=array_append(v_allowed,'Suspender vehículo');
      elsif v_vehicle.id is not null and v_state='Suspendido' then
        v_allowed:=array_append(v_allowed,'Mantener suspensión');
      end if;
      v_allowed:=array_append(v_allowed,'Otra');
    elsif v_incident.situation='Uso de QR ajeno' then
      if v_vehicle.id is not null and v_state='Activo' then v_allowed:=array_append(v_allowed,'Suspender vehículo');
      elsif v_vehicle.id is not null and v_state='Suspendido' then v_allowed:=array_append(v_allowed,'Mantener suspensión'); end if;
      v_allowed:=array_append(v_allowed,'Otra');
    else
      if v_vehicle.id is not null and v_state='Activo' then v_allowed:=array_append(v_allowed,'Suspender vehículo');
      elsif v_vehicle.id is not null and v_state='Suspendido' then v_allowed:=array_append(v_allowed,'Mantener suspensión'); end if;
      v_allowed:=array_append(v_allowed,'Otra');
    end if;
  elsif v_incident.type='QR no corresponde con matrícula' then
    if v_incident.related_vehicle_id is not null then
      select * into v_qr_vehicle from public.vehicles where id=v_incident.related_vehicle_id for update;
    else
      select * into v_qr_vehicle from public.vehicles
       where community_id=v_incident.community_id
         and normalized_habitual_plate=public.normalize_plate(coalesce(v_incident.authorized_plate,v_incident.related_plate))
       limit 1 for update;
    end if;
    if v_qr_vehicle.id is not null and v_qr_vehicle.type<>'Moto' and v_qr_vehicle.state='Activo' and coalesce(v_qr_vehicle.qr_state,'')<>'Revocado' then
      v_allowed:=array_append(v_allowed,'Revocar QR');
    end if;
    if v_vehicle.id is not null and v_state='Activo' then v_allowed:=array_append(v_allowed,'Suspender vehículo');
    elsif v_vehicle.id is not null and v_state='Suspendido' then v_allowed:=array_append(v_allowed,'Mantener suspensión'); end if;
    v_allowed:=array_append(v_allowed,'Otra');
  elsif v_incident.type='Acceso no autorizado' then
    if v_vehicle.id is not null and v_state='Suspendido' then v_allowed:=array_append(v_allowed,'Mantener suspensión'); end if;
    if v_vehicle.id is not null and v_state='Activo' and not v_moto and (v_incident.situation='QR revocado' or v_vehicle.qr_state='Revocado') then
      v_allowed:=array_append(v_allowed,'Renovar QR');
    end if;
    v_allowed:=array_append(v_allowed,'Datos corregidos');
    v_allowed:=array_append(v_allowed,'Otra');
  elsif v_incident.type='QR no presentado' then
    v_allowed:=array_append(v_allowed,'Otra');
  elsif v_incident.type='Matrícula no registrada' then
    v_allowed:=array_append(v_allowed,'Datos corregidos');
    v_allowed:=array_append(v_allowed,'Otra');
  else
    v_allowed:=array_append(v_allowed,'Datos corregidos');
    v_allowed:=array_append(v_allowed,'Otra');
  end if;

  if not (p_action=any(v_allowed)) then
    raise exception 'La acción seleccionada no corresponde al tipo de incidencia ni al estado actual del vehículo.';
  end if;

  if p_action='Revocar QR' then
    if v_incident.type='QR no corresponde con matrícula' then
      if v_qr_vehicle.id is null then raise exception 'No se pudo identificar el vehículo propietario del QR presentado.'; end if;
      perform public.revoke_vehicle_qr(v_qr_vehicle.id);
    else
      if v_vehicle.id is null then raise exception 'Esta incidencia no está vinculada a un vehículo del sistema.'; end if;
      perform public.revoke_vehicle_qr(v_vehicle.id);
    end if;
  elsif p_action='Renovar QR' then
    if v_vehicle.id is null then raise exception 'Esta incidencia no está vinculada a un vehículo del sistema.'; end if;
    perform public.renew_vehicle_qr(v_vehicle.id);
  elsif p_action='Suspender vehículo' then
    if v_vehicle.id is null then raise exception 'Esta incidencia no está vinculada a un vehículo del sistema.'; end if;
    if v_vehicle.state<>'Activo' then raise exception 'Solo se puede suspender un vehículo activo.'; end if;
    update public.vehicles set state='Suspendido' where id=v_vehicle.id;
    update public.requests set
      state='Rechazada',resolved_at=now(),resolved_by=(select auth.uid()),
      resolution_notes='El vehículo fue suspendido al resolver una incidencia.'
     where vehicle_id=v_vehicle.id and type='RENOVACION_QR' and state='Abierta';
  end if;

  update public.incidents set
    state='Cerrada',closed_at=now(),closed_by=(select auth.uid()),
    close_action=p_action,close_comment=p_comment
   where id=p_incident_id returning * into v_incident;
  return to_jsonb(v_incident);
end;
$$;

revoke all on function public.save_parking_incident_candidates(uuid,jsonb) from public, anon;
revoke all on function public.preview_parking_incident_followup(uuid,jsonb) from public, anon;
revoke all on function public.save_parking_incident_followup(uuid,jsonb,text,text) from public, anon;
grant execute on function public.save_parking_incident_candidates(uuid,jsonb) to authenticated;
grant execute on function public.preview_parking_incident_followup(uuid,jsonb) to authenticated;
grant execute on function public.save_parking_incident_followup(uuid,jsonb,text,text) to authenticated;

commit;
