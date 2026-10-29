begin;

alter table public.profiles
  add column if not exists auth_invalid_before timestamptz not null default '1970-01-01 00:00:00+00';

create or replace function private.session_is_current(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    to_timestamp(nullif((select auth.jwt()) ->> 'iat', '')::double precision)
      >= (select p.auth_invalid_before from public.profiles p where p.user_id = target_user),
    false
  );
$$;

create or replace function private.session_is_current()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.session_is_current((select auth.uid()));
$$;

revoke all on function private.session_is_current(uuid) from public, anon;
revoke all on function private.session_is_current() from public, anon;
grant execute on function private.session_is_current(uuid) to authenticated, service_role;
grant execute on function private.session_is_current() to authenticated, service_role;

create or replace function private.is_root()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.session_is_current() and coalesce((
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
  select private.session_is_current() and (
    private.is_root() or exists (
      select 1 from public.community_members cm
       where cm.community_id = target_community
         and cm.user_id = (select auth.uid())
         and cm.state = 'Activo'
         and cm.roles && wanted_roles
    )
  );
$$;

create or replace function private.is_community_member(target_community uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.session_is_current() and (
    private.is_root() or exists (
      select 1 from public.community_members cm
       where cm.community_id = target_community
         and cm.user_id = (select auth.uid())
         and cm.state = 'Activo'
    )
  );
$$;

create or replace function private.owns_dwelling(target_dwelling uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.session_is_current() and exists (
    select 1 from public.dwellings d
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
  select private.session_is_current() and exists (
    select 1 from public.vehicles v
    join public.dwellings d on d.id = v.dwelling_id
    where v.id = target_vehicle and d.responsible_user_id = (select auth.uid())
  );
$$;

create or replace function public.app_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_memberships jsonb;
  v_community uuid;
  v_settings jsonb;
  v_dwellings jsonb;
begin
  if not private.session_is_current() then raise exception 'Tu sesión ha caducado. Vuelve a entrar.'; end if;
  select * into v_profile from public.profiles where user_id = (select auth.uid());
  if not found or v_profile.state <> 'Activo' then raise exception 'Sesión sin perfil activo.'; end if;

  if v_profile.is_root then
    select id into v_community from public.communities where state = 'Activo' order by created_at limit 1;
    v_memberships := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object('community_id', cm.community_id, 'roles', cm.roles, 'state', cm.state) order by cm.created_at), '[]'::jsonb)
      into v_memberships from public.community_members cm
     where cm.user_id = v_profile.user_id and cm.state = 'Activo';
    select cm.community_id into v_community from public.community_members cm
     where cm.user_id = v_profile.user_id and cm.state = 'Activo' order by cm.created_at limit 1;
    if v_community is null then raise exception 'Tu usuario no tiene una comunidad activa.'; end if;
  end if;

  select coalesce(jsonb_object_agg(cs.key, cs.value), '{}'::jsonb)
    into v_settings from public.community_settings cs where cs.community_id = v_community;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at), '[]'::jsonb)
    into v_dwellings from public.dwellings d
   where d.community_id = v_community and d.responsible_user_id = v_profile.user_id;

  return jsonb_build_object(
    'profile', jsonb_build_object('user_id', v_profile.user_id, 'email', v_profile.email, 'name', v_profile.name, 'state', v_profile.state, 'is_root', v_profile.is_root),
    'memberships', v_memberships, 'community_id', v_community,
    'dwellings', v_dwellings,
    'dwelling', case when jsonb_array_length(v_dwellings) > 0 then v_dwellings -> 0 else null end,
    'settings', coalesce(v_settings, '{}'::jsonb)
  );
end;
$$;

commit;
