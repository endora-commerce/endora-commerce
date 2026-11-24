import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type {
  AuthSessionPort,
  CustomerAuthenticationAttempt,
  CustomerAuthenticationCheckResult,
  CustomerAuthenticationThrottlePort,
} from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { PasswordResetToken } from '../entities/password-reset-token.entity.js';
import { CustomerAuthService } from './customer-auth-service.js';
import { PasswordResetService } from './password-reset-service.js';

/**
 * How customer sign-in and the reset request use the customer authentication
 * throttle: what attempt they name, that a refusal looks nothing up, and that
 * a completed sign-in mints the known-device value.
 */
const PASSWORD = 'correct horse battery staple';

function recordingThrottle(refusal?: Error): {
  throttle: CustomerAuthenticationThrottlePort;
  attempts: CustomerAuthenticationAttempt[];
  results: CustomerAuthenticationCheckResult[];
  issued: string[];
} {
  const attempts: CustomerAuthenticationAttempt[] = [];
  const results: CustomerAuthenticationCheckResult[] = [];
  const issued: string[] = [];
  return {
    attempts,
    results,
    issued,
    throttle: {
      verify: async (attempt, check) => {
        attempts.push(attempt);
        if (refusal) throw refusal;
        const result = await check();
        results.push(result);
        return result.ok;
      },
      issueKnownDevice: async (customerAccountId) => {
        issued.push(customerAccountId);
        return `v1.${customerAccountId}.device.stamp`;
      },
    },
  };
}

async function buyer(): Promise<Partial<CustomerAccount>> {
  return {
    id: 'c-1',
    email: 'buyer@example.test',
    passwordHash: await hashPassword(PASSWORD),
    deletedAt: null,
    blockedAt: null,
  };
}

function entityManager(account: Partial<CustomerAccount> | null): {
  em: EntityManager;
  lookups: () => number;
  created: Array<Record<string, unknown>>;
  outstanding: Array<{ consumedAt: Date | null }>;
} {
  let lookups = 0;
  const created: Array<Record<string, unknown>> = [];
  const outstanding = [{ consumedAt: null as Date | null }, { consumedAt: null as Date | null }];
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== CustomerAccount) throw new Error('unexpected entity');
      lookups += 1;
      return account !== null && where['email'] === account.email ? account : null;
    },
    find: async (entity: unknown) => {
      if (entity !== PasswordResetToken) throw new Error('unexpected entity');
      return outstanding.filter((token) => token.consumedAt === null);
    },
    create: (_entity: unknown, data: Record<string, unknown>) => {
      created.push(data);
      return data;
    },
    persist: () => ({ flush: async () => undefined }),
    flush: async () => undefined,
  } as unknown as EntityManager;
  return { em, lookups: () => lookups, created, outstanding };
}

const sessions = {
  createSession: async () => ({ cookieValue: 's.tok', expiresAt: new Date(0) }),
} as unknown as AuthSessionPort;

describe('customer sign-in through the throttle', () => {
  it('names the folded address and the known device, and mints a device on a completed sign-in', async () => {
    const { em } = entityManager(await buyer());
    const t = recordingThrottle();
    const service = new CustomerAuthService(() => em, sessions, undefined, undefined, t.throttle);

    const outcome = await service.login({
      email: 'Buyer@Example.TEST',
      password: PASSWORD,
      knownDevice: 'v1.c-1.old.stamp',
    });

    expect(t.attempts).toEqual([
      { factor: 'password', account: 'buyer@example.test', knownDevice: 'v1.c-1.old.stamp' },
    ]);
    expect(t.results).toEqual([{ ok: true, customerAccountId: 'c-1' }]);
    expect(outcome).toMatchObject({ status: 'authenticated', knownDevice: 'v1.c-1.device.stamp' });
  });

  it('reports a wrong password as a failure against the account', async () => {
    const { em } = entityManager(await buyer());
    const t = recordingThrottle();
    const service = new CustomerAuthService(() => em, sessions, undefined, undefined, t.throttle);

    await expect(
      service.login({ email: 'buyer@example.test', password: 'wrong' }),
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    expect(t.results).toEqual([{ ok: false, customerAccountId: 'c-1' }]);
    expect(t.issued).toEqual([]);
  });

  it('counts an address that belongs to nobody without naming an account', async () => {
    const { em } = entityManager(null);
    const t = recordingThrottle();
    const service = new CustomerAuthService(() => em, sessions, undefined, undefined, t.throttle);

    await expect(
      service.login({ email: 'nobody@example.test', password: PASSWORD }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(t.results).toEqual([{ ok: false }]);
  });

  it('looks nothing up while the throttle refuses', async () => {
    const { em, lookups } = entityManager(await buyer());
    const refusal = new Error('throttled');
    const t = recordingThrottle(refusal);
    const service = new CustomerAuthService(() => em, sessions, undefined, undefined, t.throttle);

    await expect(service.login({ email: 'buyer@example.test', password: PASSWORD })).rejects.toBe(
      refusal,
    );
    expect(lookups()).toBe(0);
  });

  it('mints no device when a second factor is still to come', async () => {
    const { em } = entityManager(await buyer());
    const t = recordingThrottle();
    const service = new CustomerAuthService(
      () => em,
      sessions,
      () =>
        ({
          beginLogin: async () => ({ kind: 'challenge', challengeId: 'ch-1' }),
        }) as never,
      undefined,
      t.throttle,
    );

    await expect(service.login({ email: 'buyer@example.test', password: PASSWORD })).resolves.toEqual({
      status: 'mfaRequired',
      challengeId: 'ch-1',
    });
    expect(t.issued).toEqual([]);
  });
});

describe('password-reset request through the throttle', () => {
  it('counts every request per folded address, as a failure, and retires the earlier tokens', async () => {
    const { em, created, outstanding } = entityManager(await buyer());
    const t = recordingThrottle();
    const service = new PasswordResetService(() => em, sessions, undefined, undefined, t.throttle);

    const { rawToken } = await service.requestReset('Buyer@Example.TEST', {
      knownDevice: 'v1.c-1.old.stamp',
    });

    expect(rawToken).toEqual(expect.any(String));
    expect(t.attempts).toEqual([
      { factor: 'password_reset', account: 'buyer@example.test', knownDevice: 'v1.c-1.old.stamp' },
    ]);
    expect(t.results).toEqual([{ ok: false, customerAccountId: 'c-1' }]);
    expect(created).toHaveLength(1);
    expect(outstanding.every((token) => token.consumedAt instanceof Date)).toBe(true);
  });

  it('counts an unknown address the same way and issues nothing', async () => {
    const { em, created } = entityManager(null);
    const t = recordingThrottle();
    const service = new PasswordResetService(() => em, sessions, undefined, undefined, t.throttle);

    await expect(service.requestReset('nobody@example.test')).resolves.toEqual({ rawToken: null });
    expect(t.results).toEqual([{ ok: false }]);
    expect(created).toEqual([]);
  });

  it('issues nothing while the throttle refuses', async () => {
    const { em, created } = entityManager(await buyer());
    const refusal = new Error('throttled');
    const t = recordingThrottle(refusal);
    const service = new PasswordResetService(() => em, sessions, undefined, undefined, t.throttle);

    await expect(service.requestReset('buyer@example.test')).rejects.toBe(refusal);
    expect(created).toEqual([]);
  });
});
