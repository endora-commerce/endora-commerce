import argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword, verifyPasswordOrDummy } from '@endora-commerce/platform/kernel';

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

describe('verifyPasswordOrDummy', () => {
  it('answers like verifyPassword when there is a hash', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPasswordOrDummy(hash, 'correct-horse-battery-staple')).resolves.toBe(true);
    await expect(verifyPasswordOrDummy(hash, 'nope-nope-nope-nope-12345')).resolves.toBe(false);
  });

  it('does one full verification, and answers false, when there is no hash', async () => {
    const spy = vi.spyOn(argon2, 'verify');
    await expect(verifyPasswordOrDummy(null, 'whatever-whatever')).resolves.toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    // Against a hash of the same algorithm and parameters as a stored one.
    const real = await hashPassword('correct-horse-battery-staple');
    const parameters = (hash: string): string => hash.split('$').slice(1, 4).join('$');
    expect(parameters(String(spy.mock.calls[0]?.[0]))).toBe(parameters(real));
    spy.mockRestore();
  });

  it('uses one dummy hash for the life of the process', async () => {
    const spy = vi.spyOn(argon2, 'verify');
    await verifyPasswordOrDummy(null, 'whatever-whatever');
    await verifyPasswordOrDummy(undefined, 'whatever-whatever');
    expect(spy.mock.calls[0]?.[0]).toBe(spy.mock.calls[1]?.[0]);
    spy.mockRestore();
  });

  it('falls back to the dummy when the stored value is not a hash', async () => {
    const spy = vi.spyOn(argon2, 'verify');
    await expect(verifyPasswordOrDummy('not-a-valid-hash', 'whatever-whatever')).resolves.toBe(false);
    expect(String(spy.mock.calls.at(-1)?.[0])).toMatch(/^\$argon2id\$/);
    spy.mockRestore();
  });

  /**
   * Full-cost verifications: those against a hash carrying the parameters a
   * stored hash is made with today. A refusal must include exactly one.
   */
  async function fullCostVerifications(
    stored: string | null | undefined,
    password: string,
  ): Promise<{ answer: boolean; fullCost: number; all: number }> {
    const current = (await hashPassword('correct-horse-battery-staple')).split('$').slice(0, 4).join('$');
    const spy = vi.spyOn(argon2, 'verify');
    const answer = await verifyPasswordOrDummy(stored, password);
    // A call that threw did no work: it is what a malformed hash gets.
    const hashes = spy.mock.calls
      .map((call) => String(call[0]))
      .filter((_, index) => spy.mock.settledResults[index]?.type === 'fulfilled');
    const all = spy.mock.calls.length;
    spy.mockRestore();
    return {
      answer,
      fullCost: hashes.filter((hash) => hash.startsWith(`${current}$`)).length,
      all,
    };
  }

  const OLDER = { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 };

  it.each([
    ['nothing stored', null],
    ['an empty value', ''],
    ['garbage', 'not-a-valid-hash'],
    ['a bcrypt-shaped hash', '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW'],
    ['a truncated argon2id hash', '$argon2id$v=19$m=19456,t=2,p=1$broken'],
  ])('does exactly one full-cost verification for %s', async (_name, stored) => {
    const result = await fullCostVerifications(stored, 'whatever-whatever');
    expect(result.answer).toBe(false);
    expect(result.fullCost).toBe(1);
  });

  it('does exactly one full-cost verification for a wrong password on a current hash, and no other', async () => {
    const stored = await hashPassword('correct-horse-battery-staple');
    const result = await fullCostVerifications(stored, 'nope-nope-nope-nope-12345');
    expect(result).toEqual({ answer: false, fullCost: 1, all: 1 });
  });

  it('does one full-cost verification for a wrong password on a hash with older, weaker parameters', async () => {
    const stored = await argon2.hash('correct-horse-battery-staple', OLDER);
    const result = await fullCostVerifications(stored, 'nope-nope-nope-nope-12345');
    expect(result.answer).toBe(false);
    expect(result.fullCost).toBe(1);
  });

  it('still accepts the right password for a hash with older parameters', async () => {
    const stored = await argon2.hash('correct-horse-battery-staple', OLDER);
    const result = await fullCostVerifications(stored, 'correct-horse-battery-staple');
    expect(result.answer).toBe(true);
  });
});
