import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  SecretKeyInvalid,
  SecretKeyMissing,
  decryptSecretValue,
  encryptSecretValue,
  isSecretEnvelope,
  secretValueIsSet,
} from '../../../../packages/modules/credentials/src/backend/services/secret-value-codec.js';

/**
 * Feature 058 US1 (T018) — the duplicated AES-256-GCM secret codec.
 * Round-trip, set-detection, and fail-closed on a missing/invalid key.
 */
describe('credentials secret-value-codec [unit]', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a secret through encrypt/decrypt', () => {
    const envelope = encryptSecretValue('sk-super-secret', key);
    expect(isSecretEnvelope(envelope)).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('sk-super-secret');
    expect(decryptSecretValue(envelope, key)).toBe('sk-super-secret');
  });

  it('reports whether a stored value is set', () => {
    expect(secretValueIsSet(encryptSecretValue('x', key))).toBe(true);
    expect(secretValueIsSet('legacy-plain')).toBe(true);
    expect(secretValueIsSet('')).toBe(false);
    expect(secretValueIsSet(undefined)).toBe(false);
    expect(secretValueIsSet(null)).toBe(false);
  });

  it('throws SecretKeyMissing when encrypting without a key (fail-closed)', () => {
    expect(() => encryptSecretValue('x', undefined)).toThrow(SecretKeyMissing);
  });

  it('throws SecretKeyInvalid for a wrong-length key', () => {
    expect(() => encryptSecretValue('x', randomBytes(16).toString('base64'))).toThrow(SecretKeyInvalid);
  });

  it('passes legacy plaintext through decrypt unchanged', () => {
    expect(decryptSecretValue('legacy-plain', key)).toBe('legacy-plain');
  });
});
