import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import type { AuthSessionPort } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CustomerAuthService } from './customer-auth-service.js';

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
 * Customer sign-in does the same password-hash work whether or not the address
 * belongs to a usable account. Counted, not timed: a wall-clock assertion on a
 * shared machine is noise.
 */
const PASSWORD = 'correct horse battery staple';

function serviceOver(account: Partial<CustomerAccount> | null): CustomerAuthService {
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== CustomerAccount) throw new Error('unexpected entity');
      return account !== null && where['email'] === account.email ? account : null;
    },
  } as unknown as EntityManager;
  return new CustomerAuthService(() => em, {} as AuthSessionPort);
}

async function account(overrides: Partial<CustomerAccount> = {}): Promise<Partial<CustomerAccount>> {
  return {
    id: 'c-1',
    email: 'buyer@example.test',
    passwordHash: await hashPassword(PASSWORD),
    deletedAt: null,
    blockedAt: null,
    ...overrides,
  };
}

async function verificationsDuring(run: () => Promise<unknown>): Promise<{ count: number; error: unknown }> {
  verifications.count = 0;
  let error: unknown;
  await run().catch((caught: unknown) => {
    error = caught;
  });
  return { count: verifications.count, error };
}

describe('customer sign-in — password-hash verifications per attempt', () => {
  const refusal = { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' };

  it('verifies once for a known account and a wrong password', async () => {
    const service = serviceOver(await account());
    const { count, error } = await verificationsDuring(() =>
      service.login({ email: 'buyer@example.test', password: 'a wrong password 1' }),
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

  it('verifies once for a deleted account, and answers the same', async () => {
    const service = serviceOver(await account({ deletedAt: new Date() }));
    const { count, error } = await verificationsDuring(() =>
      service.login({ email: 'buyer@example.test', password: PASSWORD }),
    );
    expect(count).toBe(1);
    expect(error).toMatchObject(refusal);
  });

  it('does not tell a stranger that an account is blocked: a wrong password is refused like any other', async () => {
    const service = serviceOver(await account({ blockedAt: new Date() }));
    const { count, error } = await verificationsDuring(() =>
      service.login({ email: 'buyer@example.test', password: 'a wrong password 1' }),
    );
    expect(count).toBe(1);
    expect(error).toMatchObject(refusal);
  });

  it('still tells the holder of a blocked account, who has the password, that it is blocked', async () => {
    const service = serviceOver(await account({ blockedAt: new Date() }));
    const { error } = await verificationsDuring(() =>
      service.login({ email: 'buyer@example.test', password: PASSWORD }),
    );
    expect(error).toMatchObject({ statusCode: 403, code: 'ACCOUNT_BLOCKED' });
  });
});
