-- Validation-only migration. It changes no data or policy.
-- Every pure PROPIETARIO is impersonated through auth.uid(); the migration aborts
-- if the RLS-visible dwelling set differs from their responsible dwellings.

grant usage on schema public, private to authenticated;
grant select on public.dwellings to authenticated;
grant execute on function private.has_community_role(uuid, text[]) to authenticated;

drop table if exists private._rls_validation_expected;
create table private._rls_validation_expected (
  user_id uuid primary key,
  dwelling_ids uuid[] not null
);
revoke all on private._rls_validation_expected from public, anon;
grant select on private._rls_validation_expected to authenticated;

insert into private._rls_validation_expected (user_id, dwelling_ids)
select
  cm.user_id,
  coalesce(array_agg(d.id order by d.id) filter (where d.id is not null), array[]::uuid[])
from public.community_members cm
join public.communities c on c.id = cm.community_id and c.slug = 'parking-comunidad'
left join public.dwellings d
  on d.community_id = cm.community_id
 and d.responsible_user_id = cm.user_id
where cm.state = 'Activo'
  and cm.roles = array['PROPIETARIO']::text[]
group by cm.user_id;

create or replace function private.validate_import_owner_rls()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner record;
  visible_ids uuid[];
  tested integer := 0;
begin
  for owner in
    select e.user_id, e.dwelling_ids
      from private._rls_validation_expected e
     order by e.user_id
  loop
    perform set_config('request.jwt.claim.sub', owner.user_id::text, true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', owner.user_id::text, 'role', 'authenticated')::text,
      true
    );
    select coalesce(array_agg(d.id order by d.id), array[]::uuid[])
      into visible_ids
      from public.dwellings d;
    if visible_ids is distinct from owner.dwelling_ids then
      raise exception 'Owner RLS mismatch for user %', owner.user_id;
    end if;
    tested := tested + 1;
  end loop;
  if tested <> 68 then raise exception 'Expected 68 pure owners, validated %', tested; end if;
  return tested;
end;
$$;
revoke all on function private.validate_import_owner_rls() from public, anon;
grant execute on function private.validate_import_owner_rls() to authenticated;

set local role authenticated;
select private.validate_import_owner_rls();
reset role;

drop function private.validate_import_owner_rls();
drop table private._rls_validation_expected;
