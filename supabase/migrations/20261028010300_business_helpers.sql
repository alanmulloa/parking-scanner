-- Database-level business helpers. These are not wired to the current frontend yet.

create or replace function private.next_free_vehicle_slot(target_dwelling uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select slot_candidate::smallint
  from generate_series(1, 2) as slot_candidate
  where not exists (
    select 1
    from public.vehicles v
    where v.dwelling_id = target_dwelling
      and v.slot = slot_candidate
  )
  order by slot_candidate
  limit 1;
$$;

revoke all on function private.next_free_vehicle_slot(uuid) from public;
grant execute on function private.next_free_vehicle_slot(uuid) to authenticated, service_role;

-- A hard guard against accidentally keeping a parking slot on a decommissioned vehicle.
create or replace function private.normalize_vehicle_state_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'Moto' then
    new.slot = null;
    new.qr_token = null;
    new.qr_state = null;
  elsif new.state = 'Desasignado' then
    new.slot = null;
    new.qr_token = null;
    new.qr_state = null;
  elsif new.state = 'Baja' then
    new.slot = null;
    new.qr_state = 'Revocado';
  end if;
  return new;
end;
$$;

create trigger vehicles_normalize_state_fields
before insert or update of type, state, slot, qr_token, qr_state
on public.vehicles
for each row execute function private.normalize_vehicle_state_fields();
