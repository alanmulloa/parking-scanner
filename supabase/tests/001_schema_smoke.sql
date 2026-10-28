-- Intended for `supabase test db` once local Supabase is installed.
begin;
select plan(15);

select has_table('public', 'communities');
select has_table('public', 'profiles');
select has_table('public', 'community_members');
select has_table('public', 'dwellings');
select has_table('public', 'vehicles');
select has_table('public', 'temporary_periods');
select has_table('public', 'requests');
select has_table('public', 'incidents');
select has_table('public', 'incident_followups');
select has_table('public', 'qr_controls');
select has_table('public', 'plate_controls');
select has_table('public', 'audit_log');
select has_table('public', 'community_settings');
select has_function('public', 'normalize_plate', array['text']);
select results_eq(
  $$ select public.normalize_plate('6862 ngw') $$,
  $$ values ('6862NGW'::text) $$,
  'normalize_plate removes separators and uppercases'
);

select * from finish();
rollback;
