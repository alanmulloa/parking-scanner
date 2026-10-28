-- Parking Comunidad - Supabase migration v1
-- Phase 1: schema only. The production frontend is NOT connected to these tables yet.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

create or replace function public.normalize_plate(value text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(regexp_replace(upper(coalesce(value, '')), '[^A-Z0-9]', '', 'g'), '');
$$;

revoke all on function public.normalize_plate(text) from public;
grant execute on function public.normalize_plate(text) to authenticated, service_role;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_description text,
  contact_email text,
  address text,
  state text not null default 'Activo' check (state in ('Activo', 'Inactivo')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  legacy_id text unique,
  email text not null,
  name text not null default '',
  phone text not null default '',
  state text not null default 'Activo' check (state in ('Activo', 'Inactivo')),
  is_root boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_unique_ci on public.profiles (lower(email));

create table public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  roles text[] not null default array['PROPIETARIO']::text[],
  state text not null default 'Activo' check (state in ('Activo', 'Inactivo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (community_id, user_id),
  check (
    cardinality(roles) > 0
    and roles <@ array['ADMIN', 'CONTROL', 'PROPIETARIO']::text[]
  )
);

create table public.dwellings (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  legacy_id text,
  block text not null default '',
  floor text not null default '',
  apartment text not null default '',
  display_name text not null,
  responsible_user_id uuid references public.profiles(user_id) on delete set null,
  state text not null default 'Activo' check (state in ('Activo', 'Inactivo')),
  observations text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, legacy_id),
  unique (id, community_id)
);
create index dwellings_community_idx on public.dwellings(community_id);
create index dwellings_responsible_idx on public.dwellings(responsible_user_id);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  dwelling_id uuid not null,
  legacy_id text,
  slot smallint check (slot in (1, 2)),
  habitual_plate text not null,
  normalized_habitual_plate text generated always as (public.normalize_plate(habitual_plate)) stored,
  temporary_plate text,
  temporary_from timestamptz,
  temporary_until timestamptz,
  make text not null default '',
  model text not null default '',
  type text not null default 'Particular' check (type in ('Particular', 'Empresa', 'Alquiler', 'Moto', 'Otro')),
  state text not null default 'Activo' check (state in ('Activo', 'Desasignado', 'Suspendido', 'Baja')),
  qr_token text,
  qr_state text check (qr_state is null or qr_state in ('Activo', 'Revocado')),
  observations text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, legacy_id),
  unique (id, community_id),
  constraint vehicles_dwelling_community_fk
    foreign key (dwelling_id, community_id)
    references public.dwellings(id, community_id)
    on delete restrict
);
create unique index vehicles_plate_unique_per_community
  on public.vehicles(community_id, normalized_habitual_plate)
  where normalized_habitual_plate is not null;
create unique index vehicles_slot_unique
  on public.vehicles(dwelling_id, slot)
  where slot is not null;
create unique index vehicles_qr_unique_per_community
  on public.vehicles(community_id, qr_token)
  where qr_token is not null and qr_token <> '';
create index vehicles_dwelling_idx on public.vehicles(dwelling_id);
create index vehicles_state_idx on public.vehicles(community_id, state);

create table public.temporary_periods (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  vehicle_id uuid not null,
  legacy_id text,
  temporary_plate text not null,
  normalized_temporary_plate text generated always as (public.normalize_plate(temporary_plate)) stored,
  starts_at date not null,
  ends_at date not null,
  state text not null default 'Activo' check (state in ('Activo', 'Anulado')),
  created_by uuid references public.profiles(user_id) on delete set null,
  observations text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, legacy_id),
  check (ends_at > starts_at),
  constraint temporary_vehicle_community_fk
    foreign key (vehicle_id, community_id)
    references public.vehicles(id, community_id)
    on delete cascade
);
create index temporary_periods_vehicle_idx on public.temporary_periods(vehicle_id, starts_at desc);
create index temporary_periods_plate_idx on public.temporary_periods(community_id, normalized_temporary_plate);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  legacy_id text,
  requested_at timestamptz not null default now(),
  requested_by uuid references public.profiles(user_id) on delete set null,
  dwelling_id uuid not null references public.dwellings(id) on delete restrict,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  type text not null check (type in ('REACTIVACION_VEHICULO', 'RENOVACION_QR', 'PERMANENCIA_PROLONGADA')),
  state text not null default 'Abierta' check (state in ('Abierta', 'Aprobada', 'Rechazada')),
  reason text not null default '',
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(user_id) on delete set null,
  resolution_notes text not null default '',
  origin_vehicle_state text,
  origin_qr_state text,
  origin_vehicle_type text,
  origin_slot smallint,
  origin_plate text,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, legacy_id)
);
create index requests_community_state_idx on public.requests(community_id, state, requested_at desc);
create index requests_dwelling_idx on public.requests(dwelling_id, requested_at desc);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  legacy_id text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  observed_plate text,
  infraction_plate text,
  authorized_plate text,
  dwelling_id uuid references public.dwellings(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  type text not null check (type in (
    'Matrícula no registrada',
    'Acceso no autorizado',
    'QR no presentado',
    'QR no corresponde con matrícula',
    'Uso indebido',
    'Vehículo inmovilizado / posible abandono',
    'Estacionamiento o ubicación indebida',
    'Fuga / pérdida de líquidos',
    'Otro'
  )),
  description text not null default '',
  photo_url text,
  state text not null default 'Abierta' check (state in ('Abierta', 'Cerrada')),
  closed_at timestamptz,
  closed_by uuid references public.profiles(user_id) on delete set null,
  control_origin text,
  origin_state text,
  close_action text,
  close_comment text,
  origin_vehicle_state text,
  origin_qr_state text,
  origin_vehicle_type text,
  origin_slot smallint,
  origin_habitual_plate text,
  expired_itv boolean not null default false,
  event_id text,
  situation text,
  cause text,
  related_dwelling_id uuid references public.dwellings(id) on delete set null,
  related_vehicle_id uuid references public.vehicles(id) on delete set null,
  related_plate text,
  attempts integer not null default 1 check (attempts >= 1),
  priority text not null default 'Normal' check (priority in ('Normal', 'Atención', 'Alta', 'Crítica')),
  last_followup_at timestamptz,
  fluid_leak boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, legacy_id)
);
create index incidents_community_state_idx on public.incidents(community_id, state, occurred_at desc);
create index incidents_dwelling_idx on public.incidents(dwelling_id, occurred_at desc);
create index incidents_vehicle_idx on public.incidents(vehicle_id, occurred_at desc);
create index incidents_event_idx on public.incidents(community_id, event_id) where event_id is not null;

create table public.incident_followups (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  legacy_id text,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  event_id text,
  followup_event_id text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  attempt_number integer not null check (attempt_number >= 1),
  observed_plate text,
  authorized_plate text,
  control_origin text,
  origin_state text,
  situation text,
  related_dwelling_id uuid references public.dwellings(id) on delete set null,
  related_vehicle_id uuid references public.vehicles(id) on delete set null,
  related_plate text,
  observation text not null default '',
  photo_url text,
  created_at timestamptz not null default now(),
  unique (community_id, legacy_id)
);
create index incident_followups_incident_idx on public.incident_followups(incident_id, occurred_at);
create index incident_followups_event_idx on public.incident_followups(community_id, followup_event_id) where followup_event_id is not null;

create table public.qr_controls (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  legacy_id text,
  user_id uuid references public.profiles(user_id) on delete set null,
  occurred_at timestamptz not null default now(),
  scanned_code text not null,
  created_at timestamptz not null default now(),
  unique (community_id, legacy_id)
);
create index qr_controls_community_time_idx on public.qr_controls(community_id, occurred_at desc);

create table public.plate_controls (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  legacy_id text,
  user_id uuid references public.profiles(user_id) on delete set null,
  occurred_at timestamptz not null default now(),
  searched_plate text not null,
  normalized_searched_plate text generated always as (public.normalize_plate(searched_plate)) stored,
  created_at timestamptz not null default now(),
  unique (community_id, legacy_id)
);
create index plate_controls_community_time_idx on public.plate_controls(community_id, occurred_at desc);
create index plate_controls_plate_idx on public.plate_controls(community_id, normalized_searched_plate);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete cascade,
  legacy_id text,
  occurred_at timestamptz not null default now(),
  user_id uuid references public.profiles(user_id) on delete set null,
  actor_email text,
  action text not null,
  entity text not null,
  entity_id text,
  field text,
  previous_value text,
  new_value text,
  observations text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (community_id, legacy_id)
);
create index audit_log_community_time_idx on public.audit_log(community_id, occurred_at desc);
create index audit_log_entity_idx on public.audit_log(community_id, entity, entity_id);

create table public.community_settings (
  community_id uuid not null references public.communities(id) on delete cascade,
  key text not null,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (community_id, key)
);

create trigger communities_set_updated_at before update on public.communities
for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger community_members_set_updated_at before update on public.community_members
for each row execute function private.set_updated_at();
create trigger dwellings_set_updated_at before update on public.dwellings
for each row execute function private.set_updated_at();
create trigger vehicles_set_updated_at before update on public.vehicles
for each row execute function private.set_updated_at();
create trigger temporary_periods_set_updated_at before update on public.temporary_periods
for each row execute function private.set_updated_at();
create trigger requests_set_updated_at before update on public.requests
for each row execute function private.set_updated_at();
create trigger incidents_set_updated_at before update on public.incidents
for each row execute function private.set_updated_at();
