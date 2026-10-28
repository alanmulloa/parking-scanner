-- Parking Comunidad - RLS baseline.
-- Conservative by design: sensitive writes stay admin/root only until RPCs are added.

create or replace function private.is_root()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.is_root and p.state = 'Activo'
      from public.profiles p
     where p.user_id = (select auth.uid())
  ), false);
$$;

create or replace function private.has_community_role(target_community uuid, wanted_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_root() or exists (
    select 1
      from public.community_members cm
     where cm.community_id = target_community
       and cm.user_id = (select auth.uid())
       and cm.state = 'Activo'
       and cm.roles && wanted_roles
  );
$$;

create or replace function private.is_community_member(target_community uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_root() or exists (
    select 1
      from public.community_members cm
     where cm.community_id = target_community
       and cm.user_id = (select auth.uid())
       and cm.state = 'Activo'
  );
$$;

create or replace function private.owns_dwelling(target_dwelling uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.dwellings d
     where d.id = target_dwelling
       and d.responsible_user_id = (select auth.uid())
       and d.state = 'Activo'
  );
$$;

create or replace function private.owns_vehicle(target_vehicle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.vehicles v
      join public.dwellings d on d.id = v.dwelling_id
     where v.id = target_vehicle
       and d.responsible_user_id = (select auth.uid())
  );
$$;

create or replace function private.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_user = (select auth.uid())
    or private.is_root()
    or exists (
      select 1
        from public.community_members me
        join public.community_members target
          on target.community_id = me.community_id
       where me.user_id = (select auth.uid())
         and me.state = 'Activo'
         and me.roles && array['ADMIN']::text[]
         and target.user_id = target_user
    );
$$;

revoke all on function private.is_root() from public;
revoke all on function private.has_community_role(uuid, text[]) from public;
revoke all on function private.is_community_member(uuid) from public;
revoke all on function private.owns_dwelling(uuid) from public;
revoke all on function private.owns_vehicle(uuid) from public;
revoke all on function private.can_view_profile(uuid) from public;
grant execute on function private.is_root() to authenticated, service_role;
grant execute on function private.has_community_role(uuid, text[]) to authenticated, service_role;
grant execute on function private.is_community_member(uuid) to authenticated, service_role;
grant execute on function private.owns_dwelling(uuid) to authenticated, service_role;
grant execute on function private.owns_vehicle(uuid) to authenticated, service_role;
grant execute on function private.can_view_profile(uuid) to authenticated, service_role;

alter table public.communities enable row level security;
alter table public.profiles enable row level security;
alter table public.community_members enable row level security;
alter table public.dwellings enable row level security;
alter table public.vehicles enable row level security;
alter table public.temporary_periods enable row level security;
alter table public.requests enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_followups enable row level security;
alter table public.qr_controls enable row level security;
alter table public.plate_controls enable row level security;
alter table public.audit_log enable row level security;
alter table public.community_settings enable row level security;

revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on public.communities to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.community_members to authenticated;
grant select, insert, update, delete on public.dwellings to authenticated;
grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.temporary_periods to authenticated;
grant select, insert, update, delete on public.requests to authenticated;
grant select, insert, update, delete on public.incidents to authenticated;
grant select, insert, update, delete on public.incident_followups to authenticated;
grant select, insert, delete on public.qr_controls to authenticated;
grant select, insert, delete on public.plate_controls to authenticated;
grant select on public.audit_log to authenticated;
grant select, insert, update, delete on public.community_settings to authenticated;

create policy communities_select on public.communities
for select to authenticated
using (private.is_community_member(id));
create policy communities_insert_root on public.communities
for insert to authenticated
with check (private.is_root());
create policy communities_update_admin on public.communities
for update to authenticated
using (private.has_community_role(id, array['ADMIN']::text[]))
with check (private.has_community_role(id, array['ADMIN']::text[]));
create policy communities_delete_root on public.communities
for delete to authenticated
using (private.is_root());

create policy profiles_select on public.profiles
for select to authenticated
using (private.can_view_profile(user_id));

create policy community_members_select on public.community_members
for select to authenticated
using (
  user_id = (select auth.uid())
  or private.has_community_role(community_id, array['ADMIN']::text[])
);
create policy community_members_insert_admin on public.community_members
for insert to authenticated
with check (private.has_community_role(community_id, array['ADMIN']::text[]));
create policy community_members_update_admin on public.community_members
for update to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]))
with check (private.has_community_role(community_id, array['ADMIN']::text[]));
create policy community_members_delete_admin on public.community_members
for delete to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]));

create policy dwellings_select on public.dwellings
for select to authenticated
using (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  or responsible_user_id = (select auth.uid())
);
create policy dwellings_insert_admin on public.dwellings
for insert to authenticated
with check (private.has_community_role(community_id, array['ADMIN']::text[]));
create policy dwellings_update_admin on public.dwellings
for update to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]))
with check (private.has_community_role(community_id, array['ADMIN']::text[]));
create policy dwellings_delete_admin on public.dwellings
for delete to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]));

create policy vehicles_select on public.vehicles
for select to authenticated
using (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  or private.owns_dwelling(dwelling_id)
);
create policy vehicles_insert_admin on public.vehicles
for insert to authenticated
with check (private.has_community_role(community_id, array['ADMIN']::text[]));
create policy vehicles_update_admin on public.vehicles
for update to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]))
with check (private.has_community_role(community_id, array['ADMIN']::text[]));
create policy vehicles_delete_admin on public.vehicles
for delete to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]));

create policy temporary_periods_select on public.temporary_periods
for select to authenticated
using (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  or private.owns_vehicle(vehicle_id)
);
create policy temporary_periods_write_admin on public.temporary_periods
for all to authenticated
using (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]))
with check (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]));

create policy requests_select on public.requests
for select to authenticated
using (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  or requested_by = (select auth.uid())
  or private.owns_dwelling(dwelling_id)
);
create policy requests_insert_owner_or_staff on public.requests
for insert to authenticated
with check (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  or (
    requested_by = (select auth.uid())
    and private.owns_dwelling(dwelling_id)
  )
);
create policy requests_update_staff on public.requests
for update to authenticated
using (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]))
with check (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]));
create policy requests_delete_admin on public.requests
for delete to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]));

create policy incidents_select on public.incidents
for select to authenticated
using (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  or (dwelling_id is not null and private.owns_dwelling(dwelling_id))
);
create policy incidents_insert_staff on public.incidents
for insert to authenticated
with check (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]));
create policy incidents_update_staff on public.incidents
for update to authenticated
using (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]))
with check (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]));
create policy incidents_delete_admin on public.incidents
for delete to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]));

create policy incident_followups_select on public.incident_followups
for select to authenticated
using (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  or exists (
    select 1 from public.incidents i
     where i.id = incident_id
       and i.dwelling_id is not null
       and private.owns_dwelling(i.dwelling_id)
  )
);
create policy incident_followups_insert_staff on public.incident_followups
for insert to authenticated
with check (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]));
create policy incident_followups_update_staff on public.incident_followups
for update to authenticated
using (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]))
with check (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]));
create policy incident_followups_delete_admin on public.incident_followups
for delete to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]));

create policy qr_controls_select_staff on public.qr_controls
for select to authenticated
using (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]));
create policy qr_controls_insert_staff on public.qr_controls
for insert to authenticated
with check (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  and (user_id is null or user_id = (select auth.uid()) or private.has_community_role(community_id, array['ADMIN']::text[]))
);
create policy qr_controls_delete_root on public.qr_controls
for delete to authenticated
using (private.is_root());

create policy plate_controls_select_staff on public.plate_controls
for select to authenticated
using (private.has_community_role(community_id, array['ADMIN','CONTROL']::text[]));
create policy plate_controls_insert_staff on public.plate_controls
for insert to authenticated
with check (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  and (user_id is null or user_id = (select auth.uid()) or private.has_community_role(community_id, array['ADMIN']::text[]))
);
create policy plate_controls_delete_root on public.plate_controls
for delete to authenticated
using (private.is_root());

create policy audit_log_select_admin on public.audit_log
for select to authenticated
using (
  private.is_root()
  or (community_id is not null and private.has_community_role(community_id, array['ADMIN']::text[]))
);

create policy community_settings_select on public.community_settings
for select to authenticated
using (private.is_community_member(community_id));
create policy community_settings_insert_admin on public.community_settings
for insert to authenticated
with check (private.has_community_role(community_id, array['ADMIN']::text[]));
create policy community_settings_update_admin on public.community_settings
for update to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]))
with check (private.has_community_role(community_id, array['ADMIN']::text[]));
create policy community_settings_delete_admin on public.community_settings
for delete to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]));
