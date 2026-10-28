const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(value: string): Promise<string> {
  return hex(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(value)
    )
  );
}

export async function legacyPasswordHash(
  password: string,
  salt: string,
  iterations: number | string
): Promise<string> {
  const rounds = Number(iterations);

  if (
    !Number.isInteger(rounds) ||
    rounds < 1 ||
    rounds > 1_000_000
  ) {
    throw new Error('invalid iterations');
  }

  const normalizedSalt = String(salt);
  const normalizedPassword = String(password);

  let output = await sha256Hex(
    `${normalizedSalt}|${normalizedPassword}`
  );

  for (let index = 1; index < rounds; index += 1) {
    output = await sha256Hex(
      `${normalizedSalt}|${output}`
    );
  }

  return output;
}

export function constantTimeHexEqual(
  left: string,
  right: string
): boolean {
  const a = String(left).toLowerCase();
  const b = String(right).toLowerCase();

  if (a.length !== b.length) return false;

  let difference = 0;

  for (let index = 0; index < a.length; index += 1) {
    difference |=
      a.charCodeAt(index) ^
      b.charCodeAt(index);
  }

  return difference === 0;
}
