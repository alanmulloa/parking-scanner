import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const loginEmail = String(process.env.ROOT_LOGIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ROOT_PASSWORD || '');
const displayName = String(process.env.ROOT_DISPLAY_NAME || 'Administrador').trim() || 'Administrador';
const verifierIterations = 210000;
const verifierSalt = randomBytes(16).toString('hex');
const verifierHash = pbkdf2Sync(password, Buffer.from(verifierSalt, 'hex'), verifierIterations, 32, 'sha256').toString('hex');

if (!url || !serviceKey) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
if (!loginEmail || !/^\S+@\S+\.\S+$/.test(loginEmail)) throw new Error('ROOT_LOGIN_EMAIL no es válido.');
if (password.length < 6 || !/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password) || !/\d/.test(password)) {
  throw new Error('ROOT_PASSWORD debe tener al menos 6 caracteres, una letra y un número.');
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const existingTarget = await service.rpc('technical_root_login_target', { target_login_email: loginEmail });
if (existingTarget.error) throw existingTarget.error;
const existing = Array.isArray(existingTarget.data) ? existingTarget.data[0] : null;

let userId;
let internalEmail;
let created = false;

if (existing?.auth_user_id) {
  userId = existing.auth_user_id;
  internalEmail = existing.auth_email;
  const update = await service.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
    user_metadata: { technical_root: true }
  });
  if (update.error) throw update.error;
} else {
  internalEmail = `parking-root-${randomUUID()}@root.invalid`;
  const createdUser = await service.auth.admin.createUser({
    email: internalEmail,
    password,
    email_confirm: true,
    user_metadata: { technical_root: true }
  });
  if (createdUser.error || !createdUser.data.user) throw createdUser.error || new Error('No se pudo crear ROOT en Auth.');
  userId = createdUser.data.user.id;
  created = true;

  const profile = await service.from('profiles').upsert({
    user_id: userId,
    email: internalEmail,
    name: displayName,
    state: 'Activo',
    is_root: true
  }, { onConflict: 'user_id' });
  if (profile.error) {
    await service.auth.admin.deleteUser(userId);
    throw profile.error;
  }
}

try {
  const profileUpdate = await service.from('profiles').update({
    name: displayName,
    state: 'Activo',
    is_root: true
  }).eq('user_id', userId);
  if (profileUpdate.error) throw profileUpdate.error;

  const mapping = await service.rpc('upsert_technical_root_account', {
    target_user_id: userId,
    target_login_email: loginEmail,
    target_display_name: displayName,
    target_password_salt: verifierSalt,
    target_password_hash: verifierHash,
    target_password_iterations: verifierIterations
  });
  if (mapping.error) throw mapping.error;

  // ROOT must never have a normal community membership.
  const cleanup = await service.from('community_members').delete().eq('user_id', userId);
  if (cleanup.error) throw cleanup.error;
} catch (error) {
  if (created) await service.auth.admin.deleteUser(userId);
  throw error;
}

console.log(JSON.stringify({
  ok: true,
  created,
  rootUserId: userId,
  loginEmail,
  internalAuthEmailHidden: true
}, null, 2));
