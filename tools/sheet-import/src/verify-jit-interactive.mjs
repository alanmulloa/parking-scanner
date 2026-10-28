#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { constantTimeHexEqual, legacyPasswordHash } from '../../../supabase/functions/_shared/legacy-password.ts';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey || /replace-with/i.test(anonKey)) throw new Error('Completa las credenciales de .env');

const rl = createInterface({ input: stdin, output: stdout });
const email = (await rl.question('Email de la cuenta de prueba: ')).trim().toLowerCase();
rl.close();

stdout.write('Contraseña actual (no se mostrará ni guardará): ');
stdin.setRawMode(true);
stdin.resume();
let password = '';
await new Promise((resolve, reject) => {
  const onData = (buffer) => {
    const value = buffer.toString('utf8');
    if (value === '\u0003') { stdin.off('data', onData); stdin.setRawMode(false); reject(new Error('Cancelado')); return; }
    if (value === '\r' || value === '\n') { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); resolve(); return; }
    if (value === '\u007f') password = password.slice(0, -1);
    else password += value;
  };
  stdin.on('data', onData);
});
if (!email || !password) throw new Error('Email o contraseña vacíos');

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const credentialResult = await admin.rpc('legacy_auth_get_for_migration', { target_email: email });
if (credentialResult.error) throw new Error('No se pudo comprobar la credencial legacy');
const credential = credentialResult.data?.[0];
if (!credential) throw new Error('La cuenta no tiene una credencial JIT pendiente o está temporalmente bloqueada');
const calculated = await legacyPasswordHash(password, credential.password_salt, credential.iterations);
if (!constantTimeHexEqual(calculated, credential.password_hash)) {
  password = '';
  throw new Error('La contraseña introducida no coincide con el hash legacy guardado en la Sheet. Comprueba la contraseña en la aplicación anterior antes de repetir.');
}

async function invoke() {
  const response = await fetch(`${url}/functions/v1/legacy-auth-migrate`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json();
  if (!response.ok || !body.session?.access_token) throw new Error(`Login falló con HTTP ${response.status}`);
  return body;
}

const first = await invoke();
const firstUserId = first.session.user.id;
const sessionClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const setSession = await sessionClient.auth.setSession({ access_token: first.session.access_token, refresh_token: first.session.refresh_token });
if (setSession.error) throw setSession.error;
const logout = await sessionClient.auth.signOut({ scope: 'local' });
if (logout.error) throw logout.error;
const second = await invoke();
if (first.migrated !== true || second.migrated !== false || second.session.user.id !== firstUserId) throw new Error('La secuencia primer login JIT + segundo login nativo no coincide');

const marked = await admin.rpc('legacy_auth_mark_validated', { target_user_id: firstUserId });
if (marked.error) throw marked.error;
const status = await admin.rpc('legacy_auth_credential_status', { target_user_id: firstUserId });
if (status.error) throw status.error;
const state = status.data?.[0];
if (!state?.migrated || !state?.validated || !state?.credentials_retained || state?.purged) throw new Error('El estado final de retención no es el esperado');

password = '';
console.log(JSON.stringify({ first_login: 'JIT_OK', logout: 'OK', second_login: 'SUPABASE_NATIVE_OK', same_password: true, legacy_hash_and_salt: 'RETAINED', secret_logged: false }, null, 2));
