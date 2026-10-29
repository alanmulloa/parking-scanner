const encoder = new TextEncoder();

function hexToArrayBuffer(value: string): ArrayBuffer {
  const normalized = String(value || '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) throw new Error('invalid hex');
  const buffer = new ArrayBuffer(normalized.length / 2);
  const out = new Uint8Array(buffer);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  return buffer;
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export async function technicalRootPasswordMatches(
  password: string,
  verifier: {
    password_algorithm?: unknown;
    password_salt?: unknown;
    password_hash?: unknown;
    password_iterations?: unknown;
  }
): Promise<boolean> {
  if (String(verifier.password_algorithm || '') !== 'PBKDF2-SHA256') return false;
  const iterations = Number(verifier.password_iterations);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
  const salt = String(verifier.password_salt || '');
  const expected = String(verifier.password_hash || '').toLowerCase();
  if (!/^[0-9a-f]{32,}$/.test(salt) || !/^[0-9a-f]{64}$/.test(expected)) return false;

  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: hexToArrayBuffer(salt), iterations },
      key,
      256
    );
    return constantTimeEqual(bytesToHex(derived), expected);
  } catch {
    return false;
  }
}
