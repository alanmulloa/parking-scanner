import assert from 'node:assert/strict';
import test from 'node:test';
import { constantTimeHexEqual, legacyPasswordHash } from '../../../supabase/functions/_shared/legacy-password.ts';

test('reproduces the Apps Script v2 SHA-256 chain exactly', async () => {
  const hash = await legacyPasswordHash('Parking123', 'SALT_TEST', 1000);
  assert.equal(hash, 'db47a61020f7048cf20cb6f72ba4e0bc68d848fc0eec5465496df9a85ec248ec');
  assert.equal(constantTimeHexEqual(hash, hash.toUpperCase()), true);
  assert.equal(constantTimeHexEqual(hash, `0${hash.slice(1)}`), false);
});

test('does not normalize whitespace or case in the password', async () => {
  const original = await legacyPasswordHash('Parking123', 'SALT_TEST', 1000);
  assert.notEqual(await legacyPasswordHash('parking123', 'SALT_TEST', 1000), original);
  assert.notEqual(await legacyPasswordHash('Parking123 ', 'SALT_TEST', 1000), original);
});
