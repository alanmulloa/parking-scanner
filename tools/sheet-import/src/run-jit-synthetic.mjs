#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { legacyPasswordHash } from '../../../supabase/functions/_shared/legacy-password.ts';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey || /replace-with/i.test(anonKey)) throw new Error('Faltan credenciales de prueba');

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `jit-validation-${Date.now()}@example.invalid`;
const password = `${randomBytes(32).toString('base64url')}A1`;
const salt = randomBytes(32).toString('hex');
const legacyId = `TEST_JIT_${randomBytes(12).toString('hex')}`;
let userId;
let result = { first_login: false, local_logout: false, second_login: false, legacy_retained_after_conversion: false, synthetic_user_removed: false, secrets_logged: false };

async function invoke() {
  const response = await fetch(`${url}/functions/v1/legacy-auth-migrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json();
  if (!response.ok || !body.session?.access_token) throw new Error(`JIT HTTP ${response.status}: ${body.error || 'sin sesión'}`);
  return body;
}

try {
  const created = await admin.auth.admin.createUser({
    email,
    password: randomBytes(48).toString('base64url'),
    email_confirm: true,
    user_metadata: { synthetic_jit_validation: true }
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const hash = await legacyPasswordHash(password, salt, 1000);
  const imported = await admin.rpc('import_legacy_auth_credential', {
    target_user_id: userId,
    target_legacy_user_id: legacyId,
    target_email: email,
    target_password_hash: hash,
    target_password_salt: salt,
    target_algorithm: 'PC_SHA256_ITERATED_V2',
    target_iterations: 1000,
    target_failed_attempts: 0,
    target_locked_until: null,
    target_password_changed_at: null,
    target_session_version: 1
  });
  if (imported.error) throw imported.error;

  const first = await invoke();
  result.first_login = first.migrated === true;
  const sessionClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const setSession = await sessionClient.auth.setSession({ access_token: first.session.access_token, refresh_token: first.session.refresh_token });
  if (setSession.error) throw setSession.error;
  const signedOut = await sessionClient.auth.signOut({ scope: 'local' });
  if (signedOut.error) throw signedOut.error;
  result.local_logout = true;

  const second = await invoke();
  result.second_login = second.migrated === false;
  const status = await admin.rpc('legacy_auth_credential_status', { target_user_id: userId });
  if (status.error) throw status.error;
  const state = status.data?.[0];
  result.legacy_retained_after_conversion = Boolean(state?.migrated && state?.validated && state?.credentials_retained && !state?.purged);
  if (!result.first_login || !result.local_logout || !result.second_login || !result.legacy_retained_after_conversion) {
    throw new Error(`La secuencia JIT sintética no cumplió todas las condiciones: ${JSON.stringify(result)}`);
  }
} finally {
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    result.synthetic_user_removed = !removed.error;
  }
}

console.log(JSON.stringify(result, null, 2));
