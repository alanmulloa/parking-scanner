begin;

-- --------------------------------------------------------------------------
-- Technical ROOT login compatibility.
--
-- The stable Apps Script allows the technical account to use the same visible
-- email as a normal functional user, distinguished by password. Supabase Auth
-- cannot have two users with the same email, so ROOT uses an internal Auth
-- email while this private mapping preserves the visible technical login.
-- Supabase Auth remains the password store. A private PBKDF2 verifier is also
-- retained only to distinguish the technical password from the normal password
-- before making an Auth request, avoiding artificial failed ROOT sign-ins.
-- --------------------------------------------------------------------------

create table if not exists private.technical_root_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  login_email text not null,
  display_name text not null default 'Administrador',
  password_algorithm text not null default 'PBKDF2-SHA256' check (password_algorithm = 'PBKDF2-SHA256'),
  password_salt text not null,
  password_hash text not null,
  password_iterations integer not null default 210000 check (password_iterations between 100000 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists technical_root_accounts_login_email_ci
  on private.technical_root_accounts(lower(login_email));

create or replace function public.technical_root_login_target(target_login_email text)
returns table (
  auth_user_id uuid,
  auth_email text,
  login_email text,
  display_name text,
  password_algorithm text,
  password_salt text,
  password_hash text,
  password_iterations integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.auth_user_id, u.email::text, t.login_email, t.display_name,
         t.password_algorithm, t.password_salt, t.password_hash, t.password_iterations
    from private.technical_root_accounts t
    join auth.users u on u.id = t.auth_user_id
    join public.profiles p on p.user_id = t.auth_user_id
   where lower(t.login_email) = lower(btrim(coalesce(target_login_email, '')))
     and p.is_root
     and p.state = 'Activo'
   limit 1;
$$;

revoke all on function public.technical_root_login_target(text) from public, anon, authenticated;
grant execute on function public.technical_root_login_target(text) to service_role;

create or replace function public.upsert_technical_root_account(
  target_user_id uuid,
  target_login_email text,
  target_display_name text,
  target_password_salt text,
  target_password_hash text,
  target_password_iterations integer default 210000
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Operación exclusiva de backend.';
  end if;
  if btrim(coalesce(target_login_email, '')) = '' or position('@' in target_login_email) = 0 then
    raise exception 'Email técnico no válido.';
  end if;
  if target_password_salt !~ '^[0-9a-fA-F]{32,}$' or target_password_hash !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'Verificador ROOT no válido.';
  end if;
  if target_password_iterations < 100000 or target_password_iterations > 1000000 then
    raise exception 'Iteraciones ROOT no válidas.';
  end if;
  if not exists (
    select 1 from public.profiles p
     where p.user_id = target_user_id and p.is_root and p.state = 'Activo'
  ) then
    raise exception 'El usuario indicado no es un ROOT activo.';
  end if;

  insert into private.technical_root_accounts(
    auth_user_id, login_email, display_name, password_algorithm, password_salt, password_hash, password_iterations
  )
  values (
    target_user_id,
    lower(btrim(target_login_email)),
    coalesce(nullif(btrim(target_display_name), ''), 'Administrador'),
    'PBKDF2-SHA256',
    lower(target_password_salt),
    lower(target_password_hash),
    target_password_iterations
  )
  on conflict (auth_user_id) do update
    set login_email = excluded.login_email,
        display_name = excluded.display_name,
        password_algorithm = excluded.password_algorithm,
        password_salt = excluded.password_salt,
        password_hash = excluded.password_hash,
        password_iterations = excluded.password_iterations,
        updated_at = now();
  return true;
end;
$$;

revoke all on function public.upsert_technical_root_account(uuid,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.upsert_technical_root_account(uuid,text,text,text,text,integer) to service_role;

-- Backend-only lookup by ROOT auth user id for audit/integration code.
create or replace function public.technical_root_identity(target_user_id uuid)
returns table (login_email text, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.login_email, t.display_name
    from private.technical_root_accounts t
   where t.auth_user_id = target_user_id
   limit 1;
$$;

revoke all on function public.technical_root_identity(uuid) from public, anon, authenticated;
grant execute on function public.technical_root_identity(uuid) to service_role;

-- ROOT session audit must expose the technical visible email, never the
-- synthetic internal Auth address.
create or replace function public.record_root_session_event(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
  v_email text;
begin
  if not private.is_root() then raise exception 'Acceso exclusivo ROOT.'; end if;
  if upper(coalesce(p_action, '')) not in ('LOGIN','REFRESH','LOGOUT','RECOVERY') then
    raise exception 'Evento ROOT no válido.';
  end if;
  select id into v_community from public.communities where state = 'Activo' order by created_at limit 1;
  select t.login_email into v_email
    from private.technical_root_accounts t
   where t.auth_user_id = (select auth.uid());
  if v_email is null then raise exception 'ROOT técnico sin identidad visible configurada.'; end if;

  insert into public.audit_log (
    community_id, occurred_at, user_id, actor_user_id, actor_email,
    action, entity, entity_id, observations, metadata, source
  ) values (
    v_community, now(), (select auth.uid()), (select auth.uid()), v_email,
    'ROOT_' || upper(p_action), 'SYSTEM', (select auth.uid()),
    'Evento de sesión técnica.', '{}'::jsonb, 'APPLICATION'
  );
  return true;
end;
$$;

revoke all on function public.record_root_session_event(text) from public, anon;
grant execute on function public.record_root_session_event(text) to authenticated;

-- Bootstrap exposes the technical visible email/name for ROOT, never the
-- internal Supabase Auth address.
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
  v_root_login_email text;
  v_root_display_name text;
  v_root_functional_roles text[] := array[]::text[];
begin
  if not private.session_is_current() then raise exception 'Tu sesión ha caducado. Vuelve a entrar.'; end if;
  select * into v_profile from public.profiles where user_id = (select auth.uid());
  if not found or v_profile.state <> 'Activo' then raise exception 'Sesión sin perfil activo.'; end if;

  if v_profile.is_root then
    select t.login_email, t.display_name
      into v_root_login_email, v_root_display_name
      from private.technical_root_accounts t
     where t.auth_user_id = v_profile.user_id;
    select id into v_community from public.communities where state = 'Activo' order by created_at limit 1;

    -- Stable Apps Script grants ROOT ADMIN plus any non-ADMIN functional roles
    -- owned by a normal active user with the same visible email. Keep that
    -- presentation behaviour without ever adding ROOT to community_members.
    select coalesce(array_agg(distinct role_name) filter (where role_name <> 'ADMIN'), array[]::text[])
      into v_root_functional_roles
      from public.profiles fp
      join public.community_members fcm
        on fcm.user_id = fp.user_id
       and fcm.state = 'Activo'
      cross join lateral unnest(fcm.roles) as functional_role(role_name)
     where lower(fp.email) = lower(coalesce(v_root_login_email, ''))
       and fp.user_id <> v_profile.user_id
       and fp.state = 'Activo'
       and not fp.is_root;

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
    'profile', jsonb_build_object(
      'user_id', v_profile.user_id,
      'email', case when v_profile.is_root then coalesce(v_root_login_email, v_profile.email) else v_profile.email end,
      'name', case when v_profile.is_root then coalesce(v_root_display_name, v_profile.name) else v_profile.name end,
      'state', v_profile.state,
      'is_root', v_profile.is_root
    ),
    'memberships', v_memberships,
    'technical_functional_roles', case when v_profile.is_root then to_jsonb(v_root_functional_roles) else '[]'::jsonb end,
    'community_id', v_community,
    'dwellings', v_dwellings,
    'dwelling', case when jsonb_array_length(v_dwellings) > 0 then v_dwellings -> 0 else null end,
    'settings', coalesce(v_settings, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.app_bootstrap() from public, anon;
grant execute on function public.app_bootstrap() to authenticated;

commit;
