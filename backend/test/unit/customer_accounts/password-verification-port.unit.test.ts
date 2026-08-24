import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../../../src/kernel/crypto/password-hasher.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { CustomerPasswordVerificationService } from '../../../src/modules/customer_accounts/services/customer-account-ports.js';

/**
 * Feature 080, T052 — `customerPasswordVerificationPort`, the customer-side
 * twin of `adminPasswordVerificationPort`.
 *
 * Same repair and same reason: the composition roots read `passwordHash` off
 * this module's entity and compared it themselves. The two are asserted
 * separately rather than in one parametrised file because they are two
 * modules' contracts, and a shared fixture would let one module's regression
 * hide behind the other's green.
 */
function oneAccount(account: CustomerAccount | null): {
  em: () => EntityManager;
  reads: () => Array<Record<string, unknown>>;
} {
  const reads: Array<Record<string, unknown>> = [];
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== CustomerAccount) {
        throw new Error(
          `customer_accounts queried an entity it does not own: ${String(
            (entity as { name?: string }).name ?? entity,
          )}`,
        );
      }
      reads.push(where);
      if (account === null) return null;
      return where['id'] === account.id ? account : null;
    },
  } as unknown as EntityManager;
  return { em: () => em, reads: () => reads };
}

async function makeAccount(password: string): Promise<CustomerAccount> {
  return {
    id: 'c-1',
    email: 'buyer@example.test',
    passwordHash: await hashPassword(password),
    role: 'organization_admin',
    deletedAt: null,
  } as unknown as CustomerAccount;
}

describe('T052 — customerPasswordVerificationPort', () => {
  it('answers true for the password the stored hash was derived from', async () => {
    const { em } = oneAccount(await makeAccount('correct horse battery staple'));
    const port = new CustomerPasswordVerificationService(em);

    await expect(port.verifyPassword('c-1', 'correct horse battery staple')).resolves.toBe(true);
  });

  it('answers false for a wrong password', async () => {
    const { em } = oneAccount(await makeAccount('correct horse battery staple'));
    const port = new CustomerPasswordVerificationService(em);

    await expect(port.verifyPassword('c-1', 'correct horse battery stapler')).resolves.toBe(false);
  });

  it('answers false for an unknown id rather than throwing', async () => {
    const { em } = oneAccount(null);
    const port = new CustomerPasswordVerificationService(em);

    await expect(port.verifyPassword('c-missing', 'anything')).resolves.toBe(false);
  });

  it('looks the account up by id alone, leaving the session question to the session layer', async () => {
    const { em, reads } = oneAccount(await makeAccount('a-long-enough-password'));
    const port = new CustomerPasswordVerificationService(em);

    await port.verifyPassword('c-1', 'a-long-enough-password');

    expect(reads()).toEqual([{ id: 'c-1' }]);
  });
});
