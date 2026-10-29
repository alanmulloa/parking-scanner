begin;

-- Direct QR renewal in the stable app also resolves any open renewal request.
create or replace function public.renew_parking_qr(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_result jsonb;
begin
  v_result := public.renew_vehicle_qr(p_vehicle_id);

  update public.requests
     set state = 'Aprobada',
         resolved_at = now(),
         resolved_by = (select auth.uid()),
         resolution_notes = 'QR renovado por administración.'
   where vehicle_id = p_vehicle_id
     and type = 'RENOVACION_QR'
     and state = 'Abierta';

  return v_result;
end;
$$;

revoke all on function public.renew_parking_qr(uuid) from public, anon;
grant execute on function public.renew_parking_qr(uuid) to authenticated;

-- Replacement keeps the existing atomic vehicle operation and adds the stable
-- request lifecycle: old vehicle requests become incompatible/rejected.
create or replace function public.replace_parking_vehicle(
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
  v_result jsonb;
begin
  v_result := public.replace_vehicle(
    p_vehicle_id,
    p_habitual_plate,
    p_type,
    p_make,
    p_model,
    p_observations
  );

  update public.requests
     set state = 'Rechazada',
         resolved_at = now(),
         resolved_by = (select auth.uid()),
         resolution_notes = 'Vehículo reemplazado.'
   where vehicle_id = p_vehicle_id
     and type in ('RENOVACION_QR','REACTIVACION_VEHICULO')
     and state = 'Abierta';

  return v_result;
end;
$$;

revoke all on function public.replace_parking_vehicle(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.replace_parking_vehicle(uuid,text,text,text,text,text) to authenticated;

commit;
