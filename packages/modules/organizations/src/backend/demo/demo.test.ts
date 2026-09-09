/**
 * The properties of a demo body that no database comparison can see (feature
 * 113, T222 — contract §2.4, §2.5 and §5.1).
 *
 * `test/integration/demo/demo-parity.test.ts` seeds two databases and diffs
 * them, which is what says this row is the row the host used to write. It cannot
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
 * A minimal EntityManager over an in-memory table, keyed the way the real one
 * is: `taxId` is `Organization`'s unique column, so a `create` of a tax id that
 * is already there is the duplicate-key failure a non-idempotent body would hit
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
    findOne: async (_entity: unknown, where: { taxId: string }) =>
      rows.has(where.taxId) ? { taxId: where.taxId } : null,
    create: (_entity: unknown, payload: Record<string, unknown>) => {
      const taxId = payload['taxId'] as string;
      if (rows.has(taxId)) throw new Error(`duplicate key: ${taxId}`);
      rows.add(taxId);
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

  it('withdraws by the tax id it assigned, never by the table (§2.5)', async () => {
    const { em, deletes } = fakeEm([DEMO_ORGANIZATION.taxId, 'PL0000000000']);
    await resetDemo(contextOver(em));
    expect(deletes).toEqual([{ taxId: DEMO_ORGANIZATION.taxId }]);
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
