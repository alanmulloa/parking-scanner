#!/usr/bin/env node
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

if (!url || !anonKey || !email || !password) {
  throw new Error('Define SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL y TEST_PASSWORD en un entorno seguro');
}

async function login() {
  const response = await fetch(`${url}/functions/v1/legacy-auth-migrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anonKey, origin: process.env.ALLOWED_ORIGIN || '' },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json();
  if (!response.ok || !body.session?.access_token) throw new Error(`JIT login falló con HTTP ${response.status}`);
  return Boolean(body.migrated);
}

const firstMigrated = await login();
const secondMigrated = await login();
if (!firstMigrated || secondMigrated) throw new Error('La secuencia JIT no fue primer login migrado + segundo login nativo');
console.log(JSON.stringify({ first_login: 'migrated', second_login: 'native', password_or_tokens_logged: false }, null, 2));
