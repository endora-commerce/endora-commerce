import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { ChallengeStore } from './challenge-store.js';
import { MfaLoginService } from './mfa-login-service.js';
import type { MfaPolicyResolver } from './policy-resolver.js';
import type { SecondFactorVerifier } from './second-factor-verifier.js';

/**
 * The second step checks no more codes per challenge than its budget, however
 * the requests arrive. The budget used to be read, the code checked and the
 * budget written back, so codes sent together were all checked against the
 * same unspent budget.
 */
function fakeRedis(): Redis {
  const store = new Map<string, string>();
  const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  return {
    async set(key: string, value: string) {
      await tick();
      store.set(key, value);
      return 'OK';
    },
    async get(key: string) {
      await tick();
      return store.get(key) ?? null;
    },
    async del(...keys: string[]) {
      await tick();
      return keys.filter((key) => store.delete(key)).length;
    },
    // One command, as in Redis: read and written with nothing in between.
    async incr(key: string) {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      await tick();
      return next;
    },
    async decr(key: string) {
      const next = Number(store.get(key) ?? '0') - 1;
      store.set(key, String(next));
      await tick();
      return next;
    },
    async expire() {
      return 1;
    },
    async ttl() {
      return 300;
    },
  } as unknown as Redis;
}

function service(verify: SecondFactorVerifier): { login: MfaLoginService; store: ChallengeStore } {
  const store = new ChallengeStore(fakeRedis());
  const login = new MfaLoginService(
    () => ({}) as EntityManager,
    store,
    {} as MfaPolicyResolver,
    verify,
  );
  return { login, store };
}

const SUBJECT = { subjectType: 'customer', subjectId: 'c1', salesChannelId: null } as const;
const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('MfaLoginService.verifyChallenge — the attempt budget', () => {
  it('checks at most five of thirty wrong codes sent at the same time', async () => {
    let checked = 0;
    const { login, store } = service(async () => {
      checked += 1;
      await pause();
      return { ok: false };
    });
    const id = await store.issueChallenge(SUBJECT);

    const results = await Promise.all(
      Array.from({ length: 30 }, () => login.verifyChallenge(id, '000000')),
    );

    expect(checked).toBe(5);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results.filter((result) => !result.ok && result.error === 'invalid_code')).toHaveLength(4);
    expect(await store.getChallenge(id)).toBeNull();
  });

  it('checks five codes sent one after another, then burns the challenge', async () => {
    let checked = 0;
    const { login, store } = service(async () => {
      checked += 1;
      return { ok: false };
    });
    const id = await store.issueChallenge(SUBJECT);

    const errors: string[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const result = await login.verifyChallenge(id, '000000');
      if (!result.ok) errors.push(result.error);
    }
    expect(checked).toBe(5);
    expect(errors).toEqual([
      'invalid_code',
      'invalid_code',
      'invalid_code',
      'invalid_code',
      'locked',
      'invalid_challenge',
      'invalid_challenge',
    ]);
  });

  it('spends nothing on a code that was refused before it was checked', async () => {
    let refuse = true;
    const { login, store } = service(async () => {
      if (refuse) throw new Error('throttled');
      return { ok: false };
    });
    const id = await store.issueChallenge(SUBJECT);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(login.verifyChallenge(id, '000000')).rejects.toThrow('throttled');
    }
    refuse = false;
    const first = await login.verifyChallenge(id, '000000');
    expect(first).toMatchObject({ ok: false, error: 'invalid_code' });
  });

  it('consumes the challenge on a correct code', async () => {
    const { login, store } = service(async () => ({ ok: true, factor: 'totp' }));
    const id = await store.issueChallenge(SUBJECT);

    expect(await login.verifyChallenge(id, '123456')).toMatchObject({ ok: true });
    expect(await store.getChallenge(id)).toBeNull();
    expect(await login.verifyChallenge(id, '123456')).toMatchObject({
      ok: false,
      error: 'invalid_challenge',
    });
  });
});
