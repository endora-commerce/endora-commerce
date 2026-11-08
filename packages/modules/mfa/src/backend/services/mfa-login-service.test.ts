import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { ChallengeStore } from './challenge-store.js';
import { MfaLoginService } from './mfa-login-service.js';
import { MfaPolicyResolver } from './mfa-policy-resolver.js';
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
    // One script, as in Redis: read and written with nothing in between.
    async eval(_script: string, _keys: number, key: string) {
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

  it('answers "start over", not "too many attempts", when the challenge goes while a code is in flight', async () => {
    const { login, store } = service(async () => ({ ok: false }));
    const id = await store.issueChallenge(SUBJECT);
    // Another request completes the challenge after this one has read it.
    const take = store.takeAttempt.bind(store);
    store.takeAttempt = async (challengeId) => {
      await store.consumeChallenge(challengeId);
      return take(challengeId);
    };

    expect(await login.verifyChallenge(id, '000000')).toEqual({
      ok: false,
      error: 'invalid_challenge',
    });
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

/**
 * Issue #349 — an administrator whose role requires a second factor is asked
 * to enrol when they have none, and challenged when they have one, exactly as
 * `mfa.admin.totp_enforced` asks every administrator.
 */
describe('MfaLoginService.beginLogin — a role that requires a second factor', () => {
  function loginWith(enrolled: boolean, requiresTwoFactor: boolean): MfaLoginService {
    const em = (() => ({
      findOne: async () => (enrolled ? { id: 'e1', status: 'active' } : null),
    })) as unknown as () => EntityManager;
    const resolver = new MfaPolicyResolver(
      { get: async () => false as never },
      em,
      async () => ({
        role: {
          id: 'r1',
          code: 'accounting',
          name: 'Accounting',
          permissions: [],
          requiresTwoFactor,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      }),
    );
    // A composition with its encryption key: the second step can be checked.
    return new MfaLoginService(em, new ChallengeStore(fakeRedis()), resolver, async () => ({ ok: true }));
  }
  const admin = { subjectType: 'admin', subjectId: 'a1' } as const;

  it('answers "setup" for a holder with no enrolment', async () => {
    const decision = await loginWith(false, true).beginLogin(admin, { salesChannelId: null });
    expect(decision.kind).toBe('setup');
  });

  it('answers "challenge" for a holder who is enrolled', async () => {
    const decision = await loginWith(true, true).beginLogin(admin, { salesChannelId: null });
    expect(decision.kind).toBe('challenge');
  });

  it('answers "proceed" when the role does not require it and nothing else does', async () => {
    const decision = await loginWith(false, false).beginLogin(admin, { salesChannelId: null });
    expect(decision.kind).toBe('proceed');
  });
});

/**
 * Issue #948, owner ruling Q6 (2026-11-08) — without `MFA_SECRET_ENCRYPTION_KEY`
 * this module serves neither the code-entry step nor the setup step, so a
 * challenge or a setup ticket is one nothing can redeem: a lockout of exactly
 * the accounts that opted into a second factor, or were required to. With no
 * key there is no second step at all, for administrators and customers alike.
 */
describe('MfaLoginService.beginLogin — no encryption key (issue #948)', () => {
  function keyless(options: { enrolled: boolean; enforced: boolean }): {
    login: MfaLoginService;
    issued: string[];
  } {
    const issued: string[] = [];
    const em = (() => ({
      findOne: async () => (options.enrolled ? { id: 'e1', status: 'active' } : null),
    })) as unknown as () => EntityManager;
    const store = new ChallengeStore(fakeRedis());
    const issueChallenge = store.issueChallenge.bind(store);
    const issueSetupTicket = store.issueSetupTicket.bind(store);
    store.issueChallenge = async (input) => {
      issued.push('challenge');
      return issueChallenge(input);
    };
    store.issueSetupTicket = async (input) => {
      issued.push('setup');
      return issueSetupTicket(input);
    };
    const resolver = {
      resolve: async () => ({
        totpEnabled: options.enforced,
        totpEnforced: options.enforced,
        googleEnabled: false,
        microsoftEnabled: false,
      }),
    } as unknown as MfaPolicyResolver;
    // No verifier: the composition was given no encryption key.
    return { login: new MfaLoginService(em, store, resolver), issued };
  }

  for (const subject of [
    { subjectType: 'admin', subjectId: 'a1' },
    { subjectType: 'customer', subjectId: 'c1' },
  ] as const) {
    it(`does not challenge an enrolled ${subject.subjectType}`, async () => {
      const { login, issued } = keyless({ enrolled: true, enforced: false });
      expect((await login.beginLogin(subject, { salesChannelId: null })).kind).toBe('proceed');
      expect(issued).toEqual([]);
    });

    it(`does not send an unenrolled ${subject.subjectType} to a setup step, whatever requires it`, async () => {
      const { login, issued } = keyless({ enrolled: false, enforced: true });
      expect((await login.beginLogin(subject, { salesChannelId: null })).kind).toBe('proceed');
      expect(issued).toEqual([]);
    });
  }

  // Architect ruling on #967 (#947): the keyless `proceed` is global, so a
  // customer an organization's policy binds is not sent to a setup step either.
  it('does not send a customer bound by organization enforcement to a setup step', async () => {
    const issued: string[] = [];
    const em = (() => ({
      // No enrolment; the organization's policy enforces TOTP.
      findOne: async (entity: { name?: string }) =>
        entity?.name === 'MfaOrganizationPolicy' ? { enforceTotp: true } : null,
    })) as unknown as () => EntityManager;
    const store = new ChallengeStore(fakeRedis());
    store.issueSetupTicket = async () => {
      issued.push('setup');
      return 'ticket';
    };
    store.issueChallenge = async () => {
      issued.push('challenge');
      return 'challenge';
    };
    const resolver = new MfaPolicyResolver(
      { get: async () => false as never },
      em,
      async () => ({ refusal: new Error('not an administrator') }),
      async () => null,
      false,
    );
    const policy = await resolver.resolve(
      { subjectType: 'customer', subjectId: 'c1' },
      { salesChannelId: null, organizationId: 'org1' },
    );
    // The organization's requirement is real, and still nothing is asked.
    expect(policy.totpEnforced).toBe(true);
    const login = new MfaLoginService(em, store, resolver);
    const decision = await login.beginLogin(
      { subjectType: 'customer', subjectId: 'c1' },
      { salesChannelId: null, organizationId: 'org1' },
    );
    expect(decision.kind).toBe('proceed');
    expect(issued).toEqual([]);
  });
});
