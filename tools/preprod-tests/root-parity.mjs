import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const authFn = read('../../supabase/functions/legacy-auth-migrate/index.ts');
const migration = read('../../supabase/migrations/20261029012700_technical_root_login.sql');
const adapter = read('../../assets/js/supabase-final-adapter.js');
const provision = read('../sheet-import/root-provision.mjs');

const checks = [
  ['ROOT se busca antes del login ordinario', authFn.indexOf("technical_root_login_target") > -1 && authFn.indexOf("technical_root_login_target") < authFn.indexOf("const ordinary = await publicClient.auth.signInWithPassword")],
  ['ROOT verifica PBKDF2 antes de Auth', authFn.includes('technicalRootPasswordMatches(password, rootTarget)') && authFn.indexOf('technicalRootPasswordMatches(password, rootTarget)') < authFn.indexOf('email: rootTarget.auth_email')],
  ['ROOT autentica con email Auth interno solo tras verificador', authFn.includes('email: rootTarget.auth_email')],
  ['fallo ROOT continua al usuario normal', authFn.includes('continue with the ordinary account')],
  ['no se devuelve email Auth interno', !authFn.includes('internalAuthEmail') && !authFn.includes('rootTarget.auth_email, migrated')],
  ['mapping ROOT privado existe', migration.includes('private.technical_root_accounts')],
  ['lookup ROOT solo service_role', migration.includes('grant execute on function public.technical_root_login_target(text) to service_role') && migration.includes('revoke all on function public.technical_root_login_target(text) from public, anon, authenticated')],
  ['verificador ROOT es PBKDF2 privado', migration.includes("password_algorithm text not null default 'PBKDF2-SHA256'") && migration.includes('password_iterations integer not null default 210000')],
  ['ROOT no usa community_members', migration.includes("v_memberships := '[]'::jsonb")],
  ['ROOT hereda solo roles funcionales no ADMIN', migration.includes("role_name <> 'ADMIN'") && migration.includes('technical_functional_roles')],
  ['frontend compone ROOT + ADMIN + roles funcionales', adapter.includes("['ROOT', 'ADMIN', ...(data.technical_functional_roles || [])")],
  ['ROOT no puede cambiar password desde perfil normal', adapter.includes('La contraseña técnica ROOT se gestiona mediante el procedimiento seguro de administración.')],
  ['provision usa Auth backend y no password literal', provision.includes('ROOT_PASSWORD') && provision.includes('createUser') && !/ROOT_PASSWORD\s*=\s*['\"][^'\"]+/.test(provision)],
  ['provision deriva PBKDF2 sin persistir password plano', provision.includes('pbkdf2Sync') && provision.includes('verifierHash') && provision.includes('verifierSalt')],
  ['provision elimina memberships accidentales', provision.includes("from('community_members').delete().eq('user_id', userId)")]
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log('ROOT parity static tests: OK');
