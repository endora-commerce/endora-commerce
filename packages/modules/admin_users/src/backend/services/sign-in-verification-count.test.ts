import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import type { AdminAuthenticationThrottlePort, AuthSessionPort } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { AdminUser } from '../entities/admin-user.entity.js';
import { AdminAuthService } from './admin-auth-service.js';

/**
 * Every password-hash verification the service asks the kernel for. What one
 * call costs — exactly one argon2 verification, with or without a stored hash —
 * is the kernel's own test (`backend/test/unit/auth/password-hasher.test.ts`).
 */
const verifications = vi.hoisted(() => ({ count: 0 }));
vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@endora-commerce/platform/kernel')>();
  return {
    ...actual,
    verifyPassword: (hash: string, password: string) => {
      verifications.count += 1;
      return actual.verifyPassword(hash, password);
    },
    verifyPasswordOrDummy: (hash: string | null | undefined, password: string) => {
      verifications.count += 1;
      return actual.verifyPasswordOrDummy(hash, password);
    },
  };
});

/**
 * Administrator sign-in does the same password-hash work whether or not the
 * address belongs to an active account. Counted, not timed: a wall-clock
 * assertion on a shared machine is noise.
 */
const PASSWORD = 'correct horse battery staple';

/** Admits every attempt: the counters are not the subject here. */
const throttle = {
  verify: async (_attempt: unknown, check: () => Promise<{ ok: boolean }>) => (await check()).ok,
} as unknown as AdminAuthenticationThrottlePort;

function serviceOver(admin: Partial<AdminUser> | null): AdminAuthService {
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== AdminUser) throw new Error('unexpected entity');
      return admin !== null && where['email'] === admin.email ? admin : null;
    },
  } as unknown as EntityManager;
  return new AdminAuthService(() => em, {} as AuthSessionPort, throttle);
}

async function verificationsDuring(run: () => Promise<unknown>): Promise<{ count: number; error: unknown }> {
  verifications.count = 0;
  let error: unknown;
  await run().catch((caught: unknown) => {
    error = caught;
  });
  return { count: verifications.count, error };
}

describe('administrator sign-in — password-hash verifications per attempt', () => {
  const refusal = { statusCode: 401, code: 'UNAUTHORIZED', message: 'Invalid email or password.' };

  it('verifies once for a known account and a wrong password', async () => {
    const service = serviceOver({
      id: 'a-1',
      email: 'operator@example.test',
      status: 'active',
      passwordHash: await hashPassword(PASSWORD),
    });
    const { count, error } = await verificationsDuring(() =>
      service.login({ email: 'operator@example.test', password: 'a wrong password 1' }),
    );
    expect(count).toBe(1);
    expect(error).toMatchObject(refusal);
  });

  it('verifies once for an address that belongs to nobody, and answers the same', async () => {
    const service = serviceOver(null);
    const { count, error } = await verificationsDuring(() =>
      service.login({ email: 'nobody@example.test', password: 'a wrong password 1' }),
    );
    expect(count).toBe(1);
    expect(error).toMatchObject(refusal);
  });

  it('verifies once for an account that is not active, even with its own password', async () => {
    const service = serviceOver({
      id: 'a-1',
      email: 'operator@example.test',
      status: 'inactive',
      passwordHash: await hashPassword(PASSWORD),
    } as Partial<AdminUser>);
    const { count, error } = await verificationsDuring(() =>
      service.login({ email: 'operator@example.test', password: PASSWORD }),
    );
    expect(count).toBe(1);
    expect(error).toMatchObject(refusal);
  });
});
