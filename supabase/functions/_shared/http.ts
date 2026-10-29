export const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

export function allowedOrigins(): Set<string> {
  const configured = [
    Deno.env.get('ALLOWED_ORIGIN') || '',
    Deno.env.get('ALLOWED_ORIGINS') || '',
    Deno.env.get('SUPABASE_URL') || ''
  ].flatMap((value) => value.split(',')).map((value) => value.trim().replace(/\/$/, '')).filter(Boolean);
  return new Set(configured);
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  return allowedOrigins().has(origin.replace(/\/$/, ''));
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { vary: 'origin' };
  if (origin && isAllowedOrigin(origin)) headers['access-control-allow-origin'] = origin;
  return headers;
}

export function jsonResponse(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, 'cache-control': 'no-store', ...corsHeaders(origin) }
  });
}

export function optionsResponse(origin: string | null) {
  if (!origin || !isAllowedOrigin(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, apikey',
      'access-control-max-age': '600'
    }
  });
}
