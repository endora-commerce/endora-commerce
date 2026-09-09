/**
 * The two properties of a demo body that no database comparison can see
 * (feature 113, T220 — contract §2.4 and §2.5).
 *
 * `test/integration/demo/demo-shop.test.ts` seeds a throwaway database and
 * holds every table the seed moves to a recorded delta, which is what says
 * these rows are still there and still that many. It
 * cannot say either of the things below, because both are about a **second**
 * call: that seeding twice creates nothing the second time, and that the
 * withdrawal is keyed on the codes `seed` assigns rather than on the table.
 *
 * The second one matters most. The host's withdrawal for this table was a
 * `truncate … cascade`, which cannot tell a demo rule from an operator's, and a
 * `nativeDelete` with no filter would pass a row-count assertion just as well
 * and reproduce exactly that. So the filter itself is asserted.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { ModuleDemoContext } from '@endora-commerce/contracts';
import { Tax } from '../entities/tax.entity.js';
import { DEMO_TAX_CODES, DEMO_TAX_ROWS } from './rows.js';
import { seedDemo } from './seed.js';
import { resetDemo } from './reset.js';

/**
 * A minimal EntityManager over an in-memory table, keyed the way the real one
 * is: `code` is `Tax`'s unique column, so a `create` of a code that
 * is already there is the duplicate-key failure a non-idempotent body would
 * hit against Postgres.
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

describe('taxes demo data', () => {
  it('creates its declared rules on an empty table', async () => {
    const { em, created } = fakeEm();
    const result = await seedDemo(contextOver(em));
    expect(created.map((row) => row['code'])).toEqual([...DEMO_TAX_CODES]);
    expect(result.created).toEqual([
      { entity: 'Tax', count: DEMO_TAX_ROWS.length },
    ]);
  });

  it('creates nothing on a second run and reports the same count (§2.4)', async () => {
    const { em, created } = fakeEm([...DEMO_TAX_CODES]);
    const result = await seedDemo(contextOver(em));
    expect(created).toEqual([]);
    expect(result.created).toEqual([
      { entity: 'Tax', count: DEMO_TAX_ROWS.length },
    ]);
  });

  it('withdraws by the codes it assigned, never by the table (§2.5)', async () => {
    const { em, deletes } = fakeEm([...DEMO_TAX_CODES, 'operator_own']);
    await resetDemo(contextOver(em));
    expect(deletes).toEqual([{ code: { $in: [...DEMO_TAX_CODES] } }]);
  });

  // §2.6's per-language shape has nowhere to go on this table: `Tax.name` is a
  // plain column, and the value is a rule label built out of a country code and
  // a percentage. What is asserted instead is that it stays that — a demo row
  // carrying a sentence here would be prose no language could be chosen for.
  it('labels its rules with the code-and-rate form the column can carry', () => {
    for (const row of DEMO_TAX_ROWS) {
      expect(row.name).toMatch(/^[A-Z]{2} VAT \d+%$/);
    }
  });

  it('is declared over the entity this module owns', () => {
    expect(Tax.name).toBe('Tax');
  });
});
