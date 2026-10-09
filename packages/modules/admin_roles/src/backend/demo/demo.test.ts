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
  RETIRED_DEMO_PERMISSION_CODES,
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
function fakeEm(
  existing: readonly string[] = [],
  storedPermissions: Readonly<Record<string, string[]>> = {},
): {
  em: EntityManager;
  created: Record<string, unknown>[];
  deletes: unknown[];
  stored: Map<string, { code: string; permissions: string[] }>;
} {
  // The row objects are kept, as a managed entity is: what `seed` assigns onto
  // the one `findOne` handed it is what the flush would write.
  const stored = new Map(
    existing.map((code) => [code, { code, permissions: storedPermissions[code] ?? [] }]),
  );
  const created: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const em = {
    findOne: async (_entity: unknown, where: { code: string }) => stored.get(where.code) ?? null,
    create: (_entity: unknown, payload: Record<string, unknown>) => {
      const code = payload['code'] as string;
      if (stored.has(code)) throw new Error(`duplicate key: ${code}`);
      stored.set(code, { code, permissions: payload['permissions'] as string[] });
      created.push(payload);
      return payload;
    },
    flush: async () => undefined,
    nativeDelete: async (_entity: unknown, where: unknown) => {
      deletes.push(where);
      return stored.size;
    },
  };
  return { em: em as unknown as EntityManager, created, deletes, stored };
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
    expect(created.map((row) => row['code'])).toEqual(DEMO_ADMIN_ROLES.map((row) => row.code));
    expect(result.created).toEqual([
      { entity: 'AdminRole', count: DEMO_ADMIN_ROLES.length },
    ]);
  });

  it('creates nothing on a second run and reports the same count (§2.4)', async () => {
    const { em, created } = fakeEm(DEMO_ADMIN_ROLES.map((row) => row.code));
    const result = await seedDemo(contextOver(em));
    expect(created).toEqual([]);
    expect(result.created).toEqual([
      { entity: 'AdminRole', count: DEMO_ADMIN_ROLES.length },
    ]);
  });

  it('withdraws a retired code from a role an earlier seed wrote, and nothing else (issue #180)', async () => {
    // An instance seeded before the fix holds a code no manifest declares, so
    // the role editor cannot save the role and offers no checkbox to drop it.
    // `seed` wrote that code, so `seed` takes it back — and leaves what an
    // operator did to the role since exactly as it is.
    const retired = RETIRED_DEMO_PERMISSION_CODES[0] as string;
    const { em, created, stored } = fakeEm(['platform_admin', 'sales_representative'], {
      platform_admin: ['*'],
      sales_representative: ['rfqs:handle', retired, 'orders:read'],
    });
    await seedDemo(contextOver(em));
    expect(created).toEqual([]);
    expect(stored.get('sales_representative')?.permissions).toEqual(['rfqs:handle', 'orders:read']);
    expect(stored.get('platform_admin')?.permissions).toEqual(['*']);
  });

  it('leaves an existing role that holds no retired code untouched', async () => {
    const narrowed = ['catalog:read'];
    const { em, stored } = fakeEm(['platform_admin', 'sales_representative'], {
      platform_admin: ['*'],
      sales_representative: narrowed,
    });
    await seedDemo(contextOver(em));
    // Identity: not reassigned, so the unit of work has nothing to write.
    expect(stored.get('sales_representative')?.permissions).toBe(narrowed);
  });

  it('seeds no code it also retires', () => {
    for (const role of DEMO_ADMIN_ROLES) {
      for (const code of RETIRED_DEMO_PERMISSION_CODES) {
        expect(role.permissions).not.toContain(code);
      }
    }
  });

  it('withdraws by the codes it assigned, never by the table (§2.5)', async () => {
    // `blog_manager` is `blog`'s boot hook's row and shares this table. The
    // host's `truncate admin_roles cascade` took it, and every `admin_users`
    // row pointing at any of them.
    const { em, deletes } = fakeEm([...DEMO_ADMIN_ROLE_CODES, 'blog_manager']);
    await resetDemo(contextOver(em));
    expect(deletes).toEqual([{ code: { $in: [...DEMO_ADMIN_ROLE_CODES] } }]);
  });

  it('leaves the platform-administrator role in place: installation owns it, not the demo', () => {
    expect(DEMO_ADMIN_ROLE_CODES).toEqual(['sales_representative']);
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
