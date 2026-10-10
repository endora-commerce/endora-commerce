import { beforeEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { ChallengeStore } from './challenge-store.js';

/**
 * Minimal in-memory fake of the ioredis surface used by ChallengeStore
 * (`set key val 'EX' ttl`, `get`, `del`, `ttl`). Keeps the unit test
 * dependency-free; the real Redis is exercised in integration tests.
 */
function fakeRedis(): Redis {
  const store = new Map<string, { value: string; ttl: number }>();
  return {
    async set(key: string, value: string, _ex: string, ttl: number) {
      store.set(key, { value, ttl });
      return 'OK';
    },
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
    async incr(key: string) {
      const next = Number(store.get(key)?.value ?? '0') + 1;
      store.set(key, { value: String(next), ttl: -1 });
      return next;
    },
    async ttl(key: string) {
      return store.get(key)?.ttl ?? -2;
    },
  } as unknown as Redis;
}

describe('ChallengeStore', () => {
  let store: ChallengeStore;

  beforeEach(() => {
    store = new ChallengeStore(fakeRedis());
  });

  it('issues and reads a pending challenge with the attempt budget', async () => {
    const id = await store.issueChallenge({
      subjectType: 'customer',
      subjectId: 'c1',
      salesChannelId: null,
    });
    const c = await store.getChallenge(id);
    expect(c).toMatchObject({ subjectType: 'customer', subjectId: 'c1', attemptsRemaining: 5 });
  });

  it('decrements the budget on a failed attempt and burns at zero', async () => {
    const id = await store.issueChallenge(
      { subjectType: 'customer', subjectId: 'c1', salesChannelId: null },
      2,
    );
    expect(await store.recordFailedAttempt(id)).toBe(1);
    expect(await store.recordFailedAttempt(id)).toBe(0);
    // Burned — gone.
    expect(await store.getChallenge(id)).toBeNull();
  });

  it('consumes a challenge', async () => {
    const id = await store.issueChallenge({
      subjectType: 'admin',
      subjectId: 'a1',
      salesChannelId: null,
    });
    await store.consumeChallenge(id);
    expect(await store.getChallenge(id)).toBeNull();
  });

  it('issues and consumes a setup ticket', async () => {
    const id = await store.issueSetupTicket({
      subjectType: 'customer',
      subjectId: 'c1',
      salesChannelId: 'ch1',
    });
    expect(await store.getSetupTicket(id)).toMatchObject({ subjectId: 'c1', salesChannelId: 'ch1' });
    await store.consumeSetupTicket(id);
    expect(await store.getSetupTicket(id)).toBeNull();
  });

  it('issues and consumes an oauth transaction keyed by state', async () => {
    const state = await store.issueOAuthTransaction({
      surface: 'customer',
      provider: 'google',
      salesChannelId: null,
      pkceVerifier: 'verifier',
      nonce: 'nonce',
      next: '/account',
    });
    const tx = await store.getOAuthTransaction(state);
    expect(tx).toMatchObject({ provider: 'google', pkceVerifier: 'verifier', next: '/account' });
    await store.consumeOAuthTransaction(state);
    expect(await store.getOAuthTransaction(state)).toBeNull();
  });

  describe('invalidateSubject', () => {
    const admin = { subjectType: 'admin', subjectId: 'a1', salesChannelId: null } as const;

    it('withdraws the challenges and setup tickets issued before it', async () => {
      const challenge = await store.issueChallenge(admin);
      const ticket = await store.issueSetupTicket(admin);
      await store.invalidateSubject('admin', 'a1');
      expect(await store.getChallenge(challenge)).toBeNull();
      expect(await store.getSetupTicket(ticket)).toBeNull();
    });

    it('leaves what is issued after it, and survives a second invalidation only until then', async () => {
      await store.invalidateSubject('admin', 'a1');
      const challenge = await store.issueChallenge(admin);
      const ticket = await store.issueSetupTicket(admin);
      expect(await store.getChallenge(challenge)).not.toBeNull();
      expect(await store.getSetupTicket(ticket)).not.toBeNull();
      await store.invalidateSubject('admin', 'a1');
      expect(await store.getChallenge(challenge)).toBeNull();
    });

    it('touches nobody else — not another id, not the same id on the other surface', async () => {
      const other = await store.issueChallenge({ ...admin, subjectId: 'a2' });
      const customer = await store.issueChallenge({ ...admin, subjectType: 'customer' });
      await store.invalidateSubject('admin', 'a1');
      expect(await store.getChallenge(other)).not.toBeNull();
      expect(await store.getChallenge(customer)).not.toBeNull();
    });

    it('counts a withdrawn challenge as gone when an attempt is recorded against it', async () => {
      const challenge = await store.issueChallenge(admin);
      await store.invalidateSubject('admin', 'a1');
      expect(await store.recordFailedAttempt(challenge)).toBe(0);
    });
  });
});
