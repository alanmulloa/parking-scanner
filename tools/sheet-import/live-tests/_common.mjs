import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}.`);
  return value;
}

export const SUPABASE_URL = requireEnv('SUPABASE_URL');
export const SERVICE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
export const ANON_KEY = requireEnv('SUPABASE_ANON_KEY');

export const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function assert(condition, message, detail = '') {
  if (!condition) {
    const suffix = detail ? `\n  ${detail}` : '';
    throw new Error(`FAIL  ${message}${suffix}`);
  }
  console.log(`OK    ${message}`);
}

export function section(title) {
  console.log(`\n===== ${title} =====`);
}

export async function countRows(table, configure = (q) => q) {
  let query = service.from(table).select('*', { count: 'exact', head: true });
  query = configure(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function rows(table, columns = '*', configure = (q) => q) {
  let query = service.from(table).select(columns);
  query = configure(query);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error(`No se pudo iniciar sesión: ${email}`);
  return client;
}

export function randomPassword() {
  return `Tt!${randomBytes(24).toString('base64url')}9a`;
}

export function shortRunId() {
  return `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
}

export function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export async function expectRpcError(client, fn, args, label) {
  const { error } = await client.rpc(fn, args);
  assert(!!error, label, error ? `rechazado: ${error.message}` : 'la operación fue aceptada');
}
