begin;
select plan(16);

select has_table('public', 'migration_runs');
select has_table('public', 'migration_run_items');
select has_table('public', 'file_objects');
select has_table('private', 'legacy_auth_credentials');
select has_column('public', 'communities', 'legacy_id');
select has_column('public', 'profiles', 'last_access_at');
select has_column('public', 'audit_log', 'legacy_entity_id');
select has_column('public', 'audit_log', 'entity_id');
select has_column('public', 'qr_controls', 'vehicle_id');
select has_column('public', 'plate_controls', 'vehicle_id');
select has_function('public', 'legacy_auth_get_for_migration', array['text']);
select ok(not has_function_privilege('anon', 'public.legacy_auth_get_for_migration(text)', 'EXECUTE'), 'anon cannot read legacy credentials');
select ok(not has_function_privilege('authenticated', 'public.legacy_auth_get_for_migration(text)', 'EXECUTE'), 'authenticated cannot read legacy credentials');
select ok(has_function_privilege('service_role', 'public.legacy_auth_get_for_migration(text)', 'EXECUTE'), 'service role can run JIT lookup');
select ok(not has_table_privilege('anon', 'private.legacy_auth_credentials', 'SELECT'), 'anon cannot select credential vault');
select ok(not has_table_privilege('authenticated', 'private.legacy_auth_credentials', 'SELECT'), 'authenticated cannot select credential vault');

select * from finish();
rollback;
