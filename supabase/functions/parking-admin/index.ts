import { createClient } from 'npm:@supabase/supabase-js@2';
import { isAllowedOrigin, jsonResponse, optionsResponse } from '../_shared/http.ts';

const allowedRoles = new Set(['ADMIN', 'CONTROL', 'PROPIETARIO']);

function passwordValue() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const value = btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, 'A').slice(0, 18);
  return `${value}a1`;
}

function normalizedRoles(value: unknown): string[] {
  const roles = String(value || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
  if (!roles.length || roles.length > 2 || roles.some((role) => !allowedRoles.has(role))) throw new Error('Perfiles no válidos.');
  if (roles.includes('ADMIN') && roles.includes('CONTROL')) throw new Error('ADMIN + CONTROL no es una combinación permitida.');
  return [...new Set(roles)];
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return optionsResponse(origin);
  if (request.method !== 'POST' || !isAllowedOrigin(origin)) return jsonResponse(405, { error: 'Solicitud no válida' }, origin);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!url || !anonKey || !serviceKey || !bearer) return jsonResponse(401, { error: 'Sesión no válida' }, origin);

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const actorResult = await authClient.auth.getUser(bearer);
  const actorId = actorResult.data.user?.id;
  if (actorResult.error || !actorId) return jsonResponse(401, { error: 'Sesión no válida' }, origin);

  const actorProfile = await service.from('profiles').select('user_id,email,is_root,state').eq('user_id', actorId).single();
  if (actorProfile.error || actorProfile.data.state !== 'Activo') return jsonResponse(403, { error: 'Perfil sin acceso' }, origin);
  const membership = await service.from('community_members').select('community_id,roles,state').eq('user_id', actorId).eq('state', 'Activo').limit(1).maybeSingle();
  const isAdmin = actorProfile.data.is_root || Boolean(membership.data?.roles?.includes('ADMIN'));
  if (!isAdmin) return jsonResponse(403, { error: 'Acceso exclusivo de administración' }, origin);

  let input: { action?: string; payload?: Record<string, unknown> };
  try { input = await request.json(); } catch { return jsonResponse(400, { error: 'Solicitud no válida' }, origin); }
  const action = String(input.action || '');
  const payload = input.payload || {};

  try {
    if (action === 'saveUser') {
      const email = String(payload.Email || '').trim().toLowerCase();
      const name = String(payload.Nombre || '').trim();
      const state = String(payload.Estado || 'Activo') === 'Inactivo' ? 'Inactivo' : 'Activo';
      const roles = normalizedRoles(payload.Rol);
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Email no válido.');
      if (!name) throw new Error('El nombre es obligatorio.');

      let userId = String(payload.ID_Usuario || '');
      let created = false;
      if (userId) {
        const target = await service.from('profiles').select('user_id,is_root').eq('user_id', userId).single();
        if (target.error) throw target.error;
        if (target.data.is_root) throw new Error('ROOT no puede modificarse desde Administración.');
        const authUpdate = await service.auth.admin.updateUserById(userId, { email, email_confirm: true });
        if (authUpdate.error) throw authUpdate.error;
      } else {
        const initialPassword = passwordValue();
        const authCreate = await service.auth.admin.createUser({ email, password: initialPassword, email_confirm: true, user_metadata: { migration_pending: false, created_from: 'PARKING_STAGING' } });
        if (authCreate.error || !authCreate.data.user) throw authCreate.error || new Error('No se pudo crear el usuario.');
        userId = authCreate.data.user.id;
        created = true;
      }

      const profile = await service.from('profiles').upsert({ user_id: userId, email, name, state, is_root: false }, { onConflict: 'user_id' });
      if (profile.error) {
        if (created) await service.auth.admin.deleteUser(userId);
        throw profile.error;
      }
      const communityId = membership.data?.community_id;
      if (!communityId) throw new Error('No se pudo determinar la comunidad.');
      const member = await service.from('community_members').upsert({ community_id: communityId, user_id: userId, roles, state }, { onConflict: 'community_id,user_id' });
      if (member.error) throw member.error;
      await service.from('audit_log').insert({ community_id: communityId, actor_user_id: actorId, user_id: actorId, actor_email: actorProfile.data.email, action: created ? 'ALTA' : 'MODIFICACION', entity: 'USUARIOS', entity_id: userId, observations: 'Gestión de usuario desde preproducción Supabase.', source: 'APPLICATION' });
      return jsonResponse(200, { ok: true, user_id: userId, created, welcomeEmailQueued: false }, origin);
    }

    const targetId = String(payload.id || payload.ID_Usuario || '');
    if (!targetId) throw new Error('Usuario no indicado.');
    const target = await service.from('profiles').select('user_id,email,is_root').eq('user_id', targetId).single();
    if (target.error) throw target.error;
    if (target.data.is_root && !actorProfile.data.is_root) throw new Error('ADMIN no puede gestionar ROOT.');

    if (action === 'setPassword' || action === 'generatePassword') {
      const password = action === 'generatePassword' ? passwordValue() : String(payload.password || '');
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error('La contraseña debe tener al menos 8 caracteres, una letra y un número.');
      const updated = await service.auth.admin.updateUserById(targetId, { password });
      if (updated.error) throw updated.error;
      await service.from('audit_log').insert({ community_id: membership.data?.community_id || null, actor_user_id: actorId, user_id: actorId, actor_email: actorProfile.data.email, action: 'PASSWORD_RESET', entity: 'USUARIOS', entity_id: targetId, observations: 'Contraseña actualizada por Administración en Supabase Auth. No se registró la contraseña.', source: 'APPLICATION' });
      return jsonResponse(200, { ok: true, emailQueued: false }, origin);
    }

    if (action === 'closeSessions') {
      const invalidated = await service.from('profiles').update({ auth_invalid_before: new Date(Date.now() - 1000).toISOString() }).eq('user_id', targetId);
      if (invalidated.error) throw invalidated.error;
      await service.from('audit_log').insert({ community_id: membership.data?.community_id || null, actor_user_id: actorId, user_id: actorId, actor_email: actorProfile.data.email, action: 'CLOSE_SESSIONS_REQUESTED', entity: 'USUARIOS', entity_id: targetId, observations: 'Se marcó la cuenta para reautenticación global.', source: 'APPLICATION' });
      return jsonResponse(200, { ok: true }, origin);
    }
    throw new Error('Acción no soportada.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo completar la operación.';
    return jsonResponse(400, { error: message }, origin);
  }
});
