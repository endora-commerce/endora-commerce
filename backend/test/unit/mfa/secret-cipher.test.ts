import { describe, expect, it } from 'vitest';
import { randomBytes } from 'crypto';
import {
  SecretCipher,
  safeEqual,
} from '../../../../packages/modules/mfa/src/backend/services/secret-cipher.js';

const KEY = randomBytes(32).toString('base64');

describe('SecretCipher — AES-256-GCM at rest', () => {
  it('round-trips a secret', () => {
    const cipher = new SecretCipher(KEY);
    const secret = 'JBSWY3DPEHPK3PXP'; // sample base32 TOTP secret
    const enc = cipher.encrypt(secret);
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(enc.iv.length).toBe(12);
    expect(cipher.decrypt(enc)).toBe(secret);
  });

  it('uses a fresh IV per encryption (ciphertext differs)', () => {
    const cipher = new SecretCipher(KEY);
    const a = cipher.encrypt('JBSWY3DPEHPK3PXP');
    const b = cipher.encrypt('JBSWY3DPEHPK3PXP');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('rejects a tampered auth tag', () => {
    const cipher = new SecretCipher(KEY);
    const enc = cipher.encrypt('JBSWY3DPEHPK3PXP');
    const tampered = { ...enc, authTag: randomBytes(enc.authTag.length) };
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const cipher = new SecretCipher(KEY);
    const enc = cipher.encrypt('JBSWY3DPEHPK3PXP');
    const bad = Buffer.from(enc.ciphertext);
    bad[0] = bad[0]! ^ 0xff;
    expect(() => cipher.decrypt({ ...enc, ciphertext: bad })).toThrow();
  });

  it('refuses a key of the wrong length', () => {
    expect(() => new SecretCipher(Buffer.alloc(16).toString('base64'))).toThrow();
  });

  it('safeEqual compares without leaking length-equal mismatches', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
    expect(safeEqual('abc123', 'abc124')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
