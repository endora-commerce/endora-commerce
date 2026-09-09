import type { EntityManager } from '@mikro-orm/postgresql';
// This test constructs the service itself, over a stubbed `EntityManager`, and
// its stub compares the class it is handed by **identity**. So the entity has
// to be the copy the service under test holds — the package's own source, the
// same specifier the service is imported from below — and not the one off the
// published `entities` array, which is a second class with the same name
// (D-160.6.1). Nothing here composes the platform, so there is only one copy in
// this process and `check:singleton-identity`'s conjunct 1 is false.
import { AdminUser } from '../../../../packages/modules/admin_users/src/backend/entities/admin-user.entity.js';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { createAdminPasswordVerificationPort } from '../../../../packages/modules/admin_users/src/backend/services/admin-user-ports.js';

/**
 * Feature 080, T052 — `adminPasswordVerificationPort`.
 *
 * The two composition roots ran this comparison themselves: each read
 * `passwordHash` off the `AdminUser` entity and called the platform hasher, so
 * a credential column and a hash comparison lived in a file that owns neither
 * — and under D-168 the entity class stops having a name a root can resolve at
 * all once `admin_users` becomes a package.
 *
 * What is asserted here is the contract the roots now rest on, not the hashing:
 * a match answers `true`, a mismatch `false`, an unknown id `false` rather than
 * a throw, and — the property the port exists for — the hash never leaves.
 */
function oneAdmin(admin: AdminUser | null): {
  em: () => EntityManager;
  reads: () => Array<Record<string, unknown>>;
} {
  const reads: Array<Record<string, unknown>> = [];
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== AdminUser) {
        throw new Error(
          `admin_users queried an entity it does not own: ${String(
            (entity as { name?: string }).name ?? entity,
          )}`,
        );
      }
      reads.push(where);
      if (admin === null) return null;
      return where['id'] === admin.id ? admin : null;
    },
  } as unknown as EntityManager;
  return { em: () => em, reads: () => reads };
}

async function makeAdmin(password: string): Promise<AdminUser> {
  return {
    id: 'a-1',
    email: 'operator@example.test',
    passwordHash: await hashPassword(password),
    status: 'active',
    deletedAt: null,
  } as unknown as AdminUser;
}

describe('T052 — adminPasswordVerificationPort', () => {
  it('answers true for the password the stored hash was derived from', async () => {
    const { em } = oneAdmin(await makeAdmin('correct horse battery staple'));
    const port = createAdminPasswordVerificationPort(em);

    await expect(port.verifyPassword('a-1', 'correct horse battery staple')).resolves.toBe(true);
  });

  it('answers false for a wrong password', async () => {
    const { em } = oneAdmin(await makeAdmin('correct horse battery staple'));
    const port = createAdminPasswordVerificationPort(em);

    await expect(port.verifyPassword('a-1', 'Correct Horse Battery Staple')).resolves.toBe(false);
  });

  it('answers false for an unknown id rather than throwing', async () => {
    // The roots answered `false` here and every caller is written against that:
    // step-up verification asks "is this the right password", and an id that
    // resolves to nothing is not a different question.
    const { em } = oneAdmin(null);
    const port = createAdminPasswordVerificationPort(em);

    await expect(port.verifyPassword('a-missing', 'anything')).resolves.toBe(false);
  });

  it('looks the admin up by id alone, leaving the session question to the session layer', async () => {
    const { em, reads } = oneAdmin(await makeAdmin('a-long-enough-password'));
    const port = createAdminPasswordVerificationPort(em);

    await port.verifyPassword('a-1', 'a-long-enough-password');

    expect(reads()).toEqual([{ id: 'a-1' }]);
  });
});
