/**
 * The properties of a demo body that no database comparison can see (feature
 * 113, T222 — contract §2.4, §2.5 and §5.1).
 *
 * `test/integration/demo/demo-shop.test.ts` seeds a throwaway database and
 * holds every table the seed moves to a recorded delta, which is what says
 * these rows are still there and still that many. It
 * cannot say any of the three things below, because each is about something
 * other than the final state: that a second call creates nothing, that the
 * withdrawal is keyed on the addresses `seed` assigns, and that this body writes
 * **no** `adminRoleId` — the last of which the comparison is structurally blind
 * to, because the composition assigns the roles a moment later and the diff sees
 * only the end of the run.
 */
import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { ModuleDemoContext } from '@endora-commerce/contracts';
import { AdminUser } from '../entities/admin-user.entity.js';
import {
  DEMO_ADMIN_PASSWORD,
  DEMO_ADMIN_USERS,
  DEMO_ADMIN_USER_EMAILS,
} from './rows.js';
import { seedDemo } from './seed.js';
import { resetDemo } from './reset.js';

vi.mock('@endora-commerce/platform/kernel', () => ({
  hashPassword: async (plain: string) => `hashed:${plain}`,
}));

/**
 * A minimal EntityManager over an in-memory table, keyed the way the real one
 * is: `email` is `AdminUser`'s unique column, so a `create` of an address that
 * is already there is the duplicate-key failure a non-idempotent body would hit
 * against Postgres.
 */
const ROLE_IDS: Record<string, string> = {
  platform_admin: 'role-platform',
  sales_representative: 'role-sales',
};

function fakeEm(existing: readonly string[] = [], existingRoleId: string | null = 'role-kept'): {
  em: EntityManager;
  created: Record<string, unknown>[];
  deletes: unknown[];
  found: Map<string, { email: string; adminRoleId: string | null }>;
} {
  const found = new Map(
    existing.map((email) => [email, { email, adminRoleId: existingRoleId }] as const),
  );
  const created: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const em = {
    findOne: async (_entity: unknown, where: { email: string }) => found.get(where.email) ?? null,
    create: (_entity: unknown, payload: Record<string, unknown>) => {
      const email = payload['email'] as string;
      if (found.has(email)) throw new Error(`duplicate key: ${email}`);
      found.set(email, { email, adminRoleId: (payload['adminRoleId'] as string) ?? null });
      created.push(payload);
      return payload;
    },
    flush: async () => undefined,
    nativeDelete: async (_entity: unknown, where: unknown) => {
      deletes.push(where);
      return found.size;
    },
  };
  return { em: em as unknown as EntityManager, created, deletes, found };
}

function contextOver(
  em: EntityManager,
  roleIds: Record<string, string> = ROLE_IDS,
): ModuleDemoContext<ModuleContext> {
  const adminRolePort = {
    findByCode: async (code: string) => (roleIds[code] ? { id: roleIds[code], code } : null),
  };
  return {
    ctx: { cradle: () => ({ emFactory: () => em, adminRolePort }) } as unknown as ModuleContext,
  };
}

describe('admin_users demo data', () => {
  it('creates its declared accounts on an empty table', async () => {
    const { em, created } = fakeEm();
    const result = await seedDemo(contextOver(em));
    expect(created.map((row) => row['email'])).toEqual([...DEMO_ADMIN_USER_EMAILS]);
    expect(result.created).toEqual([
      { entity: 'AdminUser', count: DEMO_ADMIN_USERS.length },
    ]);
  });

  it('creates every account already holding its role, in the same statement', async () => {
    // An administrator without a role is refused everywhere, so an account
    // must never exist without one — not even until a later step pairs them,
    // because that step may be the one that fails.
    const { em, created } = fakeEm();
    await seedDemo(contextOver(em));
    expect(created.map((row) => [row['email'], row['adminRoleId']])).toEqual([
      ['admin@demo.local', 'role-platform'],
      ['sales-rep@demo.local', 'role-sales'],
      ['sales-rep-other@demo.local', 'role-sales'],
    ]);
    expect(DEMO_ADMIN_USERS.map((row) => row.roleCode)).toEqual([
      'platform_admin',
      'sales_representative',
      'sales_representative',
    ]);
  });

  it('fails by name rather than create an account whose role does not exist', async () => {
    const { em, created } = fakeEm();
    await expect(
      seedDemo(contextOver(em, { platform_admin: 'role-platform' })),
    ).rejects.toThrow(/sales_representative/);
    // The one account whose role was there is the only one created, and it
    // holds that role: no account was written without one.
    expect(created.every((row) => typeof row['adminRoleId'] === 'string')).toBe(true);
  });

  it('gives a role to an account an earlier, interrupted run left without one', async () => {
    const { em, created, found } = fakeEm([...DEMO_ADMIN_USER_EMAILS], null);
    await seedDemo(contextOver(em));
    expect(created).toEqual([]);
    expect([...found.values()].map((row) => row.adminRoleId)).toEqual([
      'role-platform',
      'role-sales',
      'role-sales',
    ]);
  });

  it('never replaces a role an existing account already holds', async () => {
    const { em, found } = fakeEm([...DEMO_ADMIN_USER_EMAILS], 'role-kept');
    await seedDemo(contextOver(em));
    expect([...found.values()].every((row) => row.adminRoleId === 'role-kept')).toBe(true);
  });

  it('creates nothing on a second run and reports the same count (§2.4)', async () => {
    const { em, created } = fakeEm([...DEMO_ADMIN_USER_EMAILS]);
    const result = await seedDemo(contextOver(em));
    expect(created).toEqual([]);
    expect(result.created).toEqual([
      { entity: 'AdminUser', count: DEMO_ADMIN_USERS.length },
    ]);
  });

  it('reports the sign-in details rather than printing them (§3.7)', async () => {
    const { em } = fakeEm();
    const result = await seedDemo(contextOver(em));
    expect(result.credentials).toEqual([
      { label: 'Platform Administrator', value: `admin@demo.local / ${DEMO_ADMIN_PASSWORD}` },
      { label: 'Sales Representative', value: `sales-rep@demo.local / ${DEMO_ADMIN_PASSWORD}` },
      {
        label: 'Sales Rep (other)',
        value: `sales-rep-other@demo.local / ${DEMO_ADMIN_PASSWORD}`,
      },
    ]);
  });

  it('reports the same credentials when it created nothing', async () => {
    // Otherwise a developer re-running the seed loses the addresses it printed
    // the first time, which is the one thing they came back for.
    const { em } = fakeEm([...DEMO_ADMIN_USER_EMAILS]);
    const result = await seedDemo(contextOver(em));
    expect(result.credentials).toHaveLength(DEMO_ADMIN_USERS.length);
  });

  it('withdraws by the addresses it assigned, never by the table (§2.5)', async () => {
    const { em, deletes } = fakeEm([...DEMO_ADMIN_USER_EMAILS, 'operator@own.example']);
    await resetDemo(contextOver(em));
    expect(deletes).toEqual([{ email: { $in: [...DEMO_ADMIN_USER_EMAILS] } }]);
  });

  it('is declared over the entity this module owns', () => {
    expect(AdminUser.name).toBe('AdminUser');
  });
});
