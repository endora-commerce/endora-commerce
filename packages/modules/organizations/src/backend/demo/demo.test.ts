/**
 * The properties of a demo body that no database comparison can see (feature
 * 113, T222 — contract §2.4, §2.5 and §5.1).
 *
 * `test/integration/demo/demo-shop.test.ts` seeds a throwaway database and
 * holds every table the seed moves to a recorded delta, which is what says
 * this row is still there. It cannot
 * say that a second call creates nothing, and it cannot say that the withdrawal
 * is filtered — which on this table is the assertion that matters most: an
 * organisation is the tenant every buyer, address, cart and order hangs off, so
 * an unfiltered delete takes a developer's whole test tenancy through the
 * cascade while a row-count assertion reads exactly the same.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { ModuleDemoContext } from '@endora-commerce/contracts';
import { Organization } from '../entities/organization.entity.js';
import { DEMO_ORGANIZATION } from './rows.js';
import { seedDemo } from './seed.js';
import { resetDemo } from './reset.js';

/**
 * A minimal EntityManager over an in-memory table. The bodies find the demo
 * organisation through `TaxIdLookupService` (`specs/177-tax-id-scope/` O5),
 * which selects ids in SQL — root first — and loads them with `find`; so the
 * fake answers `execute` with the matching ids in insertion order (the first
 * row stands for the tree's root) and `find` by `id: { $in }`. `create` of a
 * tax id that is already there is the duplicate-key failure a non-idempotent
 * body would hit against Postgres in the `global` scope.
 */
function fakeEm(existing: readonly string[] = []): {
  em: EntityManager;
  created: Record<string, unknown>[];
  deletes: unknown[];
} {
  const rows = existing.map((taxId, index) => ({ id: index === 0 ? `id-of-${taxId}` : `id-${index}-of-${taxId}`, taxId }));
  const created: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const em = {
    execute: async (_sql: string, params: unknown[]) =>
      rows.filter((row) => row.taxId === params[0]).map((row) => ({ id: row.id })),
    find: async (_entity: unknown, where: { id: { $in: string[] } }) =>
      rows.filter((row) => where.id.$in.includes(row.id)),
    create: (_entity: unknown, payload: Record<string, unknown>) => {
      const taxId = payload['taxId'] as string;
      if (rows.some((row) => row.taxId === taxId)) throw new Error(`duplicate key: ${taxId}`);
      rows.push({ id: `id-of-${taxId}`, taxId });
      created.push(payload);
      return payload;
    },
    flush: async () => undefined,
    nativeDelete: async (entity: { name: string }, where: unknown) => {
      deletes.push({ [entity.name]: where });
      return 1;
    },
  };
  return { em: em as unknown as EntityManager, created, deletes };
}

function contextOver(em: EntityManager): ModuleDemoContext<ModuleContext> {
  return {
    ctx: { cradle: () => ({ emFactory: () => em }) } as unknown as ModuleContext,
  };
}

describe('organizations demo data', () => {
  it('creates its declared organisation on an empty table', async () => {
    const { em, created } = fakeEm();
    const result = await seedDemo(contextOver(em));
    expect(created.map((row) => row['taxId'])).toEqual([DEMO_ORGANIZATION.taxId]);
    expect(created[0]?.['status']).toBe('active');
    expect(result.created).toEqual([{ entity: 'Organization', count: 1 }]);
  });

  it('creates nothing on a second run and reports the same count (§2.4)', async () => {
    const { em, created } = fakeEm([DEMO_ORGANIZATION.taxId]);
    const result = await seedDemo(contextOver(em));
    expect(created).toEqual([]);
    expect(result.created).toEqual([{ entity: 'Organization', count: 1 }]);
  });

  it('withdraws the organisation found by the tax id it assigned, by id, never by the table (§2.5)', async () => {
    const { em, deletes } = fakeEm([DEMO_ORGANIZATION.taxId, 'PL0000000000']);
    await resetDemo(contextOver(em));
    expect(deletes.at(-1)).toEqual({ Organization: { id: `id-of-${DEMO_ORGANIZATION.taxId}` } });
  });

  // `specs/177-tax-id-scope/` T026 (O5) — in `per-tree-root` a branch may share
  // the demo tax ID; a delete by tax ID would take it with the demo row.
  it('leaves a branch that shares the demo tax ID in place', async () => {
    const { em, deletes } = fakeEm([DEMO_ORGANIZATION.taxId, DEMO_ORGANIZATION.taxId]);
    await resetDemo(contextOver(em));
    const organizationDeletes = deletes.filter((entry) => Object.keys(entry as object)[0] === 'Organization');
    expect(organizationDeletes).toEqual([{ Organization: { id: `id-of-${DEMO_ORGANIZATION.taxId}` } }]);
  });

  it('creates nothing when a branch already holds the demo tax ID under the demo root', async () => {
    const { em, created } = fakeEm([DEMO_ORGANIZATION.taxId, DEMO_ORGANIZATION.taxId]);
    await seedDemo(contextOver(em));
    expect(created).toEqual([]);
  });

  it('withdraws what this module holds against that organisation first (issue #143)', async () => {
    // A buyer who invited a colleague, and an administrator who assigned a
    // sales representative, each leave a row of this module's naming the demo
    // organisation. The invitation's foreign key refuses the organisation's
    // deletion; the assignment has none and would be left naming nothing.
    const { em, deletes } = fakeEm([DEMO_ORGANIZATION.taxId, 'PL0000000000']);
    await resetDemo(contextOver(em));
    const demoOnly = { organizationId: { $in: [`id-of-${DEMO_ORGANIZATION.taxId}`] } };
    expect(deletes).toEqual([
      { OrganizationInvitation: demoOnly },
      { OrganizationSalesRepAssignment: demoOnly },
      { Organization: { id: `id-of-${DEMO_ORGANIZATION.taxId}` } },
    ]);
  });

  it('deletes nothing when there is no demo organisation', async () => {
    const { em, deletes } = fakeEm(['PL0000000000']);
    const result = await resetDemo(contextOver(em));
    expect(deletes).toEqual([]);
    expect(result.removed).toEqual([
      { entity: 'Organization', count: 0 },
      { entity: 'OrganizationInvitation', count: 0 },
      { entity: 'OrganizationSalesRepAssignment', count: 0 },
    ]);
  });

  it('creates no buyer and no credit limit — both are the composition\'s (§5.1)', async () => {
    const { em, created } = fakeEm();
    await seedDemo(contextOver(em));
    for (const payload of created) {
      expect(Object.keys(payload).sort()).toEqual([
        'name',
        'registeredAddress',
        'status',
        'taxId',
        'vatStatus',
      ]);
    }
  });

  it('is declared over the entity this module owns', () => {
    expect(Organization.name).toBe('Organization');
  });
});
