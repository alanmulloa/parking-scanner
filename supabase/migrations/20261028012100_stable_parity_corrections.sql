begin;

-- Restore the exact stable vocabularies. Migration 120 was deliberately
-- conservative, but two extra values were not present in FIX11.29.
alter table public.requests drop constraint if exists requests_type_check;
alter table public.requests add constraint requests_type_check check (type in (
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
  'Fuga / pérdida de líquidos',
  'Otro'
));

-- FIX11.29 annuls the currently active temporary registration whenever an
-- active vehicle becomes Desasignado, Suspendido or Baja. Future periods are
-- retained except for Baja, matching the stable Apps Script rules.
create or replace function public.annul_temporaries_on_vehicle_low()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if old.state = 'Activo' and new.state <> 'Activo' then
    update public.temporary_periods
       set state = 'Anulado',
           observations = concat_ws(
             ' | ', nullif(observations, ''),
             'Anulado automáticamente al pasar el vehículo a ' || new.state || '.'
           )
     where vehicle_id = new.id
       and state <> 'Anulado'
       and current_date between starts_at and ends_at;
  end if;

  if old.state is distinct from new.state and new.state = 'Baja' then
    update public.temporary_periods
       set state = 'Anulado',
           observations = concat_ws(
             ' | ', nullif(observations, ''),
             'Anulado automáticamente al dar de baja el vehículo.'
           )
     where vehicle_id = new.id
       and state <> 'Anulado'
       and starts_at > current_date;
  end if;
  return new;
end;
$$;

-- Functional audit must not manufacture rows while the service-role importer
-- is reconciling a snapshot. Sensitive operational tokens are never copied to
-- audit metadata.
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
begin
  if coalesce(auth.role(), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_old := case when tg_op = 'INSERT' then null else
    to_jsonb(old) - array['qr_token','photo_url']::text[] end;
  v_new := case when tg_op = 'DELETE' then null else
    to_jsonb(new) - array['qr_token','photo_url']::text[] end;

  if tg_op = 'UPDATE' and v_old = v_new then return new; end if;
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

  insert into public.audit_log (
    community_id, occurred_at, user_id, actor_user_id, actor_email,
    action, entity, entity_id, legacy_entity_id, observations, metadata, source
  ) values (
    v_community, now(), (select auth.uid()), (select auth.uid()), v_actor_email,
    tg_op, upper(tg_table_name), v_entity_id, v_legacy_id,
    'Cambio registrado automáticamente por la aplicación Supabase.',
    jsonb_build_object('old', v_old, 'new', v_new), 'APPLICATION'
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- A real, root-only diagnostic endpoint replaces frontend placeholders.
create or replace function public.root_system_diagnostics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
begin
  if not private.is_root() then raise exception 'Acceso exclusivo ROOT.'; end if;
  select public.root_system_status() into v_status;
  return v_status || jsonb_build_object(
    'schemaVersion', '20261028012100',
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
grant execute on function public.root_system_diagnostics() to authenticated;

commit;
