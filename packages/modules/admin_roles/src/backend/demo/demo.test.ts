/**
 * The properties of a demo body that no database comparison can see (feature
 * 113, T222 — contract §2.4 and §2.5).
 *
 * `test/integration/demo/demo-shop.test.ts` seeds a throwaway database and
 * holds every table the seed moves to a recorded delta, which is what says
 * these rows are still there and still that many. It
 * cannot say either of the things below, because both are about a **second**
 * call: that seeding twice creates nothing the second time, and that the
 * withdrawal is keyed on the codes `seed` assigns rather than on the table.
 *
 * The second one matters more here than anywhere else in this feature. The
 * host's withdrawal for this table was a `truncate admin_roles cascade`, and
 * this table is shared: `blog` and `cms` seed a role apiece from their own boot
 * hooks, and the cascade reached `admin_users` as well. A `nativeDelete` with no
 * filter would pass a row-count assertion just as well and reproduce exactly
 * that, so the filter itself is asserted.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { ModuleDemoContext } from '@endora-commerce/contracts';
import { AdminRole } from '../entities/admin-role.entity.js';
import {
  DEMO_ADMIN_ROLES,
  DEMO_ADMIN_ROLE_CODES,
  SALES_REPRESENTATIVE_PERMISSIONS,
} from './rows.js';
import { seedDemo } from './seed.js';
import { resetDemo } from './reset.js';

/**
 * A minimal EntityManager over an in-memory table, keyed the way the real one
 * is: `code` is `AdminRole`'s unique column, so a `create` of a code that is
 * already there is the duplicate-key failure a non-idempotent body would hit
 * against Postgres.
 */
function fakeEm(existing: readonly string[] = []): {
  em: EntityManager;
  created: Record<string, unknown>[];
  deletes: unknown[];
} {
  const rows = new Set(existing);
  const created: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const em = {
    findOne: async (_entity: unknown, where: { code: string }) =>
      rows.has(where.code) ? { code: where.code } : null,
    create: (_entity: unknown, payload: Record<string, unknown>) => {
      const code = payload['code'] as string;
      if (rows.has(code)) throw new Error(`duplicate key: ${code}`);
      rows.add(code);
      created.push(payload);
      return payload;
    },
    flush: async () => undefined,
    nativeDelete: async (_entity: unknown, where: unknown) => {
      deletes.push(where);
      return rows.size;
    },
  };
  return { em: em as unknown as EntityManager, created, deletes };
}

function contextOver(em: EntityManager): ModuleDemoContext<ModuleContext> {
  return {
    ctx: { cradle: () => ({ emFactory: () => em }) } as unknown as ModuleContext,
  };
}

describe('admin_roles demo data', () => {
  it('creates its declared roles on an empty table', async () => {
    const { em, created } = fakeEm();
    const result = await seedDemo(contextOver(em));
    expect(created.map((row) => row['code'])).toEqual([...DEMO_ADMIN_ROLE_CODES]);
    expect(result.created).toEqual([
      { entity: 'AdminRole', count: DEMO_ADMIN_ROLES.length },
    ]);
  });

  it('creates nothing on a second run and reports the same count (§2.4)', async () => {
    const { em, created } = fakeEm([...DEMO_ADMIN_ROLE_CODES]);
    const result = await seedDemo(contextOver(em));
    expect(created).toEqual([]);
    expect(result.created).toEqual([
      { entity: 'AdminRole', count: DEMO_ADMIN_ROLES.length },
    ]);
  });

  it('withdraws by the codes it assigned, never by the table (§2.5)', async () => {
    // `blog_manager` is `blog`'s boot hook's row and shares this table. The
    // host's `truncate admin_roles cascade` took it, and every `admin_users`
    // row pointing at any of them.
    const { em, deletes } = fakeEm([...DEMO_ADMIN_ROLE_CODES, 'blog_manager']);
    await resetDemo(contextOver(em));
    expect(deletes).toEqual([{ code: { $in: [...DEMO_ADMIN_ROLE_CODES] } }]);
  });

  it('holds no account assignment — that is the composition\'s (§5.1)', async () => {
    const { em, created } = fakeEm();
    await seedDemo(contextOver(em));
    // An `adminRoleId` written here would be `admin_users`' row created from
    // this module's body, which is the boundary the batch was cut on.
    for (const payload of created) {
      expect(Object.keys(payload).sort()).toEqual(['code', 'name', 'permissions']);
    }
  });

  it('grants the platform administrator the wildcard, and the representative named codes', () => {
    const wildcard = DEMO_ADMIN_ROLES.find((row) => row.code === 'platform_admin');
    expect(wildcard?.permissions).toEqual(['*']);
    const representative = DEMO_ADMIN_ROLES.find((row) => row.code === 'sales_representative');
    // Identity and not equality: the six `permission-authority` contract tests
    // read this exported array to say what the seeded representative may reach,
    // and a role built from a *copy* would agree with them on the day it was
    // written and never again. That is the whole reason the list is a constant.
    expect(representative?.permissions).toBe(SALES_REPRESENTATIVE_PERMISSIONS);
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('*');
  });

  it('is declared over the entity this module owns', () => {
    expect(AdminRole.name).toBe('AdminRole');
  });
});
