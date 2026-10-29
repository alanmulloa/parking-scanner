import { createClient } from 'npm:@supabase/supabase-js@2';
import { constantTimeHexEqual, legacyPasswordHash } from '../_shared/legacy-password.ts';
import { isAllowedOrigin, jsonResponse, optionsResponse } from '../_shared/http.ts';

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    return optionsResponse(origin);
  }
  if (request.method !== 'POST' || !isAllowedOrigin(origin)) return jsonResponse(405, { error: 'Solicitud no válida' }, origin);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return jsonResponse(503, { error: 'Servicio no disponible' }, origin);

  let payload: { email?: unknown; password?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Solicitud no válida' }, origin);
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (!email || !password || email.length > 320 || password.length > 1024) return jsonResponse(401, { error: 'Credenciales no válidas' }, origin);

  const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ordinary = await publicClient.auth.signInWithPassword({ email, password });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (!ordinary.error && ordinary.data.session) {
    const userId = ordinary.data.user?.id;

    if (userId) {
      const statusResult = await admin.rpc('legacy_auth_credential_status', {
        target_user_id: userId
      });

      const status = Array.isArray(statusResult.data)
        ? statusResult.data[0]
        : null;

      if (
        !statusResult.error &&
        status?.exists_in_vault &&
        status.migrated &&
        !status.validated &&
        !status.purged
      ) {
        const validatedResult = await admin.rpc(
          'legacy_auth_mark_validated',
          { target_user_id: userId }
        );

        if (validatedResult.error) {
          console.error('No se pudo marcar la credencial legacy como validada');
        }
      }
    }

    return jsonResponse(
      200,
      { session: ordinary.data.session, migrated: false },
      origin
    );
  }


  const credentialResult = await admin.rpc('legacy_auth_get_for_migration', { target_email: email });
  const credential = Array.isArray(credentialResult.data) ? credentialResult.data[0] : null;
  if (credentialResult.error || !credential?.user_id || !credential.password_hash || !credential.password_salt) {
    return jsonResponse(401, { error: 'Credenciales no válidas' }, origin);
  }

  let verified = false;
  try {
    const calculated = await legacyPasswordHash(password, credential.password_salt, credential.iterations);
    verified = constantTimeHexEqual(calculated, credential.password_hash);
  } catch {
    verified = false;
  }
  if (!verified) {
    await admin.rpc('legacy_auth_record_attempt', { target_user_id: credential.user_id, was_successful: false });
    return jsonResponse(401, { error: 'Credenciales no válidas' }, origin);
  }

  const updated = await admin.auth.admin.updateUserById(credential.user_id, {
    password,
    user_metadata: { migration_pending: false, legacy_password_migrated_at: new Date().toISOString() }
  });
  if (updated.error) return jsonResponse(503, { error: 'No se pudo completar el acceso' }, origin);

  const converted = await publicClient.auth.signInWithPassword({ email, password });
  if (converted.error || !converted.data.session) return jsonResponse(503, { error: 'No se pudo completar el acceso' }, origin);

  await admin.rpc('legacy_auth_record_attempt', { target_user_id: credential.user_id, was_successful: true });
  return jsonResponse(200, { session: converted.data.session, migrated: true }, origin);
});
