begin;
select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-owner-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-owner-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.communities (id, slug, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rls-test-a', 'RLS Test A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'rls-test-b', 'RLS Test B');

update public.profiles set name = 'Owner A', state = 'Activo' where user_id = '11111111-1111-4111-8111-111111111111';
update public.profiles set name = 'Owner B', state = 'Activo' where user_id = '22222222-2222-4222-8222-222222222222';

insert into public.community_members (community_id, user_id, roles) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', array['PROPIETARIO']),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', array['PROPIETARIO']);

insert into public.dwellings (id, community_id, legacy_id, display_name, responsible_user_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'RLS-DW-A', 'A', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'RLS-DW-B', 'B', '22222222-2222-4222-8222-222222222222');

insert into public.vehicles (id, community_id, dwelling_id, legacy_id, habitual_plate) values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000001', 'RLS-VEH-A', 'TESTA001'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-4000-8000-000000000001', 'RLS-VEH-B', 'TESTB001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select results_eq(
  $$ select count(*)::bigint from public.dwellings where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  $$ values (1::bigint) $$,
  'owner can read own dwelling'
);
select results_eq(
  $$ select count(*)::bigint from public.dwellings where id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  $$ values (0::bigint) $$,
  'manually supplied foreign dwelling UUID is hidden'
);
select results_eq(
  $$ select count(*)::bigint from public.vehicles where id = 'bbbbbbbb-0000-4000-8000-000000000002' $$,
  $$ values (0::bigint) $$,
  'manually supplied foreign vehicle UUID is hidden'
);
select results_eq(
  $$ update public.dwellings set observations = 'attack' where id = 'aaaaaaaa-0000-4000-8000-000000000001' returning 1 $$,
  $$ select 1 where false $$,
  'owner cannot update even own dwelling directly'
);

select * from finish();
rollback;
