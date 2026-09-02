import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@endora-commerce/platform/kernel';

describe('password-hasher', () => {
  it('produces a hash that verifies the original password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'correct-horse-battery-staple')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword(hash, 'nope-nope-nope-nope-12345')).resolves.toBe(false);
  });

  it('returns false (never throws) on a malformed hash', async () => {
    await expect(verifyPassword('not-a-valid-hash', 'whatever-whatever')).resolves.toBe(false);
  });

  it('rejects passwords shorter than 12 characters', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 12 characters/);
  });

  it('produces different hashes for the same password on each call (random salt)', async () => {
    const a = await hashPassword('correct-horse-battery-staple');
    const b = await hashPassword('correct-horse-battery-staple');
    expect(a).not.toBe(b);
    await expect(verifyPassword(a, 'correct-horse-battery-staple')).resolves.toBe(true);
    await expect(verifyPassword(b, 'correct-horse-battery-staple')).resolves.toBe(true);
  });
});
