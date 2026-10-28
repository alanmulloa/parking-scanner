#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import {
  constantTimeHexEqual,
  legacyPasswordHash
} from '../../../supabase/functions/_shared/legacy-password.ts';

const execFileAsync = promisify(execFile);
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = String(
  process.argv[2] || process.env.JIT_TEST_EMAIL || ''
).trim().toLowerCase();

if (!url || !anonKey || !serviceKey || !email) {
  throw new Error('Faltan las credenciales de entorno o el email TEST');
}

const appleScript = `
tell application "System Events"
  activate
  set dialogResult to display dialog "Introduce la contraseña actual de la cuenta original. Se usará solo en memoria para validar la migración JIT y no se guardará ni mostrará." default answer "" with hidden answer buttons {"Cancelar", "Validar"} default button "Validar" cancel button "Cancelar" with title "Validación segura de Parking Comunidad"
  return text returned of dialogResult
end tell
`;

const promptResult = await execFileAsync(
  '/usr/bin/osascript',
  ['-e', appleScript],
  { maxBuffer: 16 * 1024 }
);

let password = promptResult.stdout.replace(/[\r\n]+$/, '');
if (!password) throw new Error('La contraseña está vacía');

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const lookup = await admin.rpc('legacy_auth_get_for_migration', {
  target_email: email
});
if (lookup.error) throw new Error('No se pudo consultar la credencial legacy');

const credential = Array.isArray(lookup.data) ? lookup.data[0] : null;
if (!credential) throw new Error('La cuenta no tiene una credencial JIT pendiente');

const calculated = await legacyPasswordHash(
  password,
  credential.password_salt,
  credential.iterations
);
const legacyPasswordMatches = constantTimeHexEqual(
  calculated,
  credential.password_hash
);

if (!legacyPasswordMatches) {
  password = '';
  throw new Error('La contraseña no coincide con la credencial legacy importada');
}

async function invoke() {
  const response = await fetch(`${url}/functions/v1/legacy-auth-migrate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: anonKey
    },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json();
  if (!response.ok || !body.session?.access_token) {
    throw new Error(`El login JIT devolvió HTTP ${response.status}`);
  }
  return body;
}

const first = await invoke();
const userId = first.session.user.id;
const sessionClient = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const setSession = await sessionClient.auth.setSession({
  access_token: first.session.access_token,
  refresh_token: first.session.refresh_token
});
if (setSession.error) throw new Error('No se pudo establecer la sesión local');

const logout = await sessionClient.auth.signOut({ scope: 'local' });
if (logout.error) throw new Error('No se pudo cerrar la sesión local');

const second = await invoke();
const statusResult = await admin.rpc('legacy_auth_credential_status', {
  target_user_id: userId
});
if (statusResult.error) throw new Error('No se pudo leer el estado JIT final');
const state = Array.isArray(statusResult.data) ? statusResult.data[0] : null;

const result = {
  account: email,
  legacy_password_matches: legacyPasswordMatches,
  first_login_jit: first.migrated === true,
  local_logout: true,
  second_login_supabase_native:
    second.migrated === false && second.session.user.id === userId,
  same_password: true,
  migrated: Boolean(state?.migrated),
  validated: Boolean(state?.validated),
  credentials_retained: Boolean(state?.credentials_retained),
  purged: Boolean(state?.purged),
  failed_attempts: state?.failed_attempts ?? null,
  locked_until: state?.locked_until ?? null,
  secret_logged: false
};

password = '';

if (
  !result.first_login_jit ||
  !result.second_login_supabase_native ||
  !result.migrated ||
  !result.validated ||
  !result.credentials_retained ||
  result.purged ||
  result.failed_attempts !== 0 ||
  result.locked_until !== null
) {
  throw new Error('La secuencia JIT no alcanzó el estado final esperado');
}

console.log(JSON.stringify(result, null, 2));
