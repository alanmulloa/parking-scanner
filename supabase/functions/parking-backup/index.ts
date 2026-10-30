import { createClient } from 'npm:@supabase/supabase-js@2';

const encoder = new TextEncoder();

const BACKUP_TABLES = [
  'communities',
  'profiles',
  'community_members',
  'community_settings',
  'dwellings',
  'vehicles',
  'temporary_periods',
  'requests',
  'incidents',
  'incident_followups',
  'audit_log',
  'qr_controls',
  'plate_controls'
] as const;

const PAGE_SIZE = 1000;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(value)
  );

  return bytesToHex(
    new Uint8Array(signature)
  );
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);
  }

  return result === 0;
}

async function verifyRequest(
  request: Request,
  body: string
) {
  const secret =
    Deno.env.get('LEGACY_BRIDGE_SECRET') || '';

  if (!secret) {
    return false;
  }

  const timestamp =
    request.headers.get(
      'x-parking-timestamp'
    ) || '';

  const signature =
    request.headers.get(
      'x-parking-signature'
    ) || '';

  const timestampMs =
    Number(timestamp);

  if (
    !timestamp ||
    !signature ||
    !Number.isFinite(timestampMs)
  ) {
    return false;
  }

  if (
    Math.abs(Date.now() - timestampMs) >
    5 * 60 * 1000
  ) {
    return false;
  }

  const expected =
    await hmacHex(
      secret,
      `${timestamp}.${body}`
    );

  return safeEqual(
    expected.toLowerCase(),
    signature.toLowerCase()
  );
}

async function fetchAllRows(
  service: any,
  table: string
) {
  const allRows: unknown[] = [];

  let from = 0;

  while (true) {
    const to =
      from + PAGE_SIZE - 1;

    const {
      data,
      error
    } = await service
      .from(table)
      .select('*')
      .range(from, to);

    if (error) {
      throw new Error(
        `Backup ${table}: ${error.message}`
      );
    }

    const rows =
      data || [];

    allRows.push(...rows);

    if (
      rows.length <
      PAGE_SIZE
    ) {
      break;
    }

    from += PAGE_SIZE;
  }

  return allRows;
}

Deno.serve(async request => {
  if (
    request.method !== 'POST'
  ) {
    return jsonResponse(
      405,
      {
        error:
          'Método no permitido.'
      }
    );
  }

  const body =
    await request.text();

  if (
    !(await verifyRequest(
      request,
      body
    ))
  ) {
    return jsonResponse(
      401,
      {
        error:
          'Firma de backup no válida.'
      }
    );
  }

  let input: {
    action?: string;
    mode?: string;
  } = {};

  try {
    input =
      JSON.parse(
        body || '{}'
      );
  } catch {
    return jsonResponse(
      400,
      {
        error:
          'Solicitud no válida.'
      }
    );
  }

  if (
    input.action !==
    'backupExport'
  ) {
    return jsonResponse(
      400,
      {
        error:
          'Acción no soportada.'
      }
    );
  }

  const url =
    Deno.env.get(
      'SUPABASE_URL'
    );

  const serviceKey =
    Deno.env.get(
      'SUPABASE_SERVICE_ROLE_KEY'
    );

  if (
    !url ||
    !serviceKey
  ) {
    return jsonResponse(
      500,
      {
        error:
          'Configuración Supabase incompleta.'
      }
    );
  }

  const service =
    createClient(
      url,
      serviceKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

  const tables:
    Record<string, unknown[]> = {};

  const counts:
    Record<string, number> = {};

  const tableStats:
    Record<
      string,
      {
        rows: number;
        pages: number;
      }
    > = {};

  for (
    const table
    of BACKUP_TABLES
  ) {
    try {
      const rows =
        await fetchAllRows(
          service,
          table
        );

      tables[table] =
        rows;

      counts[table] =
        rows.length;

      tableStats[table] = {
        rows:
          rows.length,

        pages:
          Math.max(
            1,
            Math.ceil(
              rows.length /
              PAGE_SIZE
            )
          )
      };

    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      return jsonResponse(
        500,
        {
          error:
            message
        }
      );
    }
  }

  return jsonResponse(
    200,
    {
      ok: true,

      version:
        'backup-v1.1',

      mode:
        input.mode ||
        'DAILY',

      generatedAt:
        new Date()
          .toISOString(),

      counts,

      tableStats,

      tables
    }
  );
});
