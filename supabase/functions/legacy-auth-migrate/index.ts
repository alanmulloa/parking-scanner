import { createClient } from 'npm:@supabase/supabase-js@2';
import { constantTimeHexEqual, legacyPasswordHash } from '../_shared/legacy-password.ts';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

function response(status: number, body: Record<string, unknown>, origin: string | null, allowedOrigin: string) {
  const headers: Record<string, string> = { ...jsonHeaders, 'cache-control': 'no-store', vary: 'origin' };
  if (origin && origin === allowedOrigin) headers['access-control-allow-origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || '';
  if (request.method === 'OPTIONS') {
    if (!origin || origin !== allowedOrigin) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, apikey',
        'access-control-max-age': '600',
        vary: 'origin'
      }
    });
  }
  if (request.method !== 'POST' || (origin && origin !== allowedOrigin)) return response(405, { error: 'Solicitud no válida' }, origin, allowedOrigin);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return response(503, { error: 'Servicio no disponible' }, origin, allowedOrigin);

  let payload: { email?: unknown; password?: unknown };
  try {
    payload = await request.json();
  } catch {
    return response(400, { error: 'Solicitud no válida' }, origin, allowedOrigin);
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (!email || !password || email.length > 320 || password.length > 1024) return response(401, { error: 'Credenciales no válidas' }, origin, allowedOrigin);

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

    return response(
      200,
      { session: ordinary.data.session, migrated: false },
      origin,
      allowedOrigin
    );
  }


  const credentialResult = await admin.rpc('legacy_auth_get_for_migration', { target_email: email });
  const credential = Array.isArray(credentialResult.data) ? credentialResult.data[0] : null;
  if (credentialResult.error || !credential?.user_id || !credential.password_hash || !credential.password_salt) {
    return response(401, { error: 'Credenciales no válidas' }, origin, allowedOrigin);
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
    return response(401, { error: 'Credenciales no válidas' }, origin, allowedOrigin);
  }

  const updated = await admin.auth.admin.updateUserById(credential.user_id, {
    password,
    user_metadata: { migration_pending: false, legacy_password_migrated_at: new Date().toISOString() }
  });
  if (updated.error) return response(503, { error: 'No se pudo completar el acceso' }, origin, allowedOrigin);

  const converted = await publicClient.auth.signInWithPassword({ email, password });
  if (converted.error || !converted.data.session) return response(503, { error: 'No se pudo completar el acceso' }, origin, allowedOrigin);

  await admin.rpc('legacy_auth_record_attempt', { target_user_id: credential.user_id, was_successful: true });
  return response(200, { session: converted.data.session, migrated: true }, origin, allowedOrigin);
});
