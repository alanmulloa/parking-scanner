-- Remove the Sheet-era temporary-plate denormalization from vehicles without data loss.

create table if not exists private.legacy_vehicle_temporary_quarantine (
  vehicle_id uuid primary key,
  community_id uuid not null,
  legacy_id text,
  temporary_plate text,
  temporary_from timestamptz,
  temporary_until timestamptz,
  reason text not null,
  captured_at timestamptz not null default now()
);
revoke all on private.legacy_vehicle_temporary_quarantine from public, anon, authenticated;
grant select on private.legacy_vehicle_temporary_quarantine to service_role;

-- Complete, valid legacy values become normalized periods unless already represented.
insert into public.temporary_periods (
  community_id, vehicle_id, legacy_id, temporary_plate, starts_at, ends_at,
  state, observations, created_at
)
select
  v.community_id,
  v.id,
  'VEHICLE_TEMPORARY:' || v.id::text,
  v.temporary_plate,
  v.temporary_from::date,
  v.temporary_until::date,
  'Activo',
  'Normalizado desde columnas legacy de vehicles',
  v.created_at
from public.vehicles v
where nullif(btrim(v.temporary_plate), '') is not null
  and v.temporary_from is not null
  and v.temporary_until is not null
  and v.temporary_until::date > v.temporary_from::date
  and v.state = 'Activo'
  and public.normalize_plate(v.temporary_plate) is distinct from v.normalized_habitual_plate
  and not exists (
    select 1 from public.temporary_periods tp
     where tp.vehicle_id = v.id
       and tp.normalized_temporary_plate = public.normalize_plate(v.temporary_plate)
       and tp.starts_at = v.temporary_from::date
       and tp.ends_at = v.temporary_until::date
  )
  and not exists (
    select 1 from public.temporary_periods tp
     where tp.vehicle_id = v.id
       and tp.state <> 'Anulado'
       and daterange(tp.starts_at, tp.ends_at, '[]')
           && daterange(v.temporary_from::date, v.temporary_until::date, '[]')
  )
  and not exists (
    select 1 from public.vehicles other
     where other.community_id = v.community_id
       and other.id <> v.id
       and other.state = 'Activo'
       and other.normalized_habitual_plate = public.normalize_plate(v.temporary_plate)
  )
  and not exists (
    select 1 from public.temporary_periods tp
     where tp.community_id = v.community_id
       and tp.state <> 'Anulado'
       and tp.normalized_temporary_plate = public.normalize_plate(v.temporary_plate)
       and daterange(tp.starts_at, tp.ends_at, '[]')
           && daterange(v.temporary_from::date, v.temporary_until::date, '[]')
  )
on conflict (community_id, legacy_id) do nothing;

-- Incomplete legacy values are retained privately for manual resolution before columns are dropped.
insert into private.legacy_vehicle_temporary_quarantine (
  vehicle_id, community_id, legacy_id, temporary_plate, temporary_from, temporary_until, reason
)
select
  v.id,
  v.community_id,
  v.legacy_id,
  v.temporary_plate,
  v.temporary_from,
  v.temporary_until,
  'NOT_NORMALIZED_AUTOMATICALLY'
from public.vehicles v
where (
  nullif(btrim(v.temporary_plate), '') is not null
  or v.temporary_from is not null
  or v.temporary_until is not null
)
and not exists (
  select 1 from public.temporary_periods tp
   where tp.vehicle_id = v.id
     and tp.normalized_temporary_plate = public.normalize_plate(v.temporary_plate)
     and tp.starts_at = v.temporary_from::date
     and tp.ends_at = v.temporary_until::date
)
on conflict (vehicle_id) do update set
  temporary_plate = excluded.temporary_plate,
  temporary_from = excluded.temporary_from,
  temporary_until = excluded.temporary_until,
  reason = excluded.reason,
  captured_at = now();

alter table public.vehicles
  drop column temporary_plate,
  drop column temporary_from,
  drop column temporary_until;
