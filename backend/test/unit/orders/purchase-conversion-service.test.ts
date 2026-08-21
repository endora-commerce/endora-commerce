import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PurchaseConversionService } from '../../../src/modules/orders/services/purchase-conversion-service.js';

/**
 * Issue #277 — spending an order's claim on a GA4 `purchase` conversion.
 *
 * Two devices may load the same order in the same instant, so the decision and
 * the write have to be one statement: a conditional `UPDATE … RETURNING` whose
 * `where` names the flag it is about to clear. This file holds that statement
 * to its shape — a read followed by a write would let both devices pass the
 * read, and reads the same way at every call site. The behaviour of the
 * statement against a real PostgreSQL is
 * `test/integration/orders/purchase-conversion.test.ts`.
 */
function recordingEm(rows: Array<{ id: string }>): {
  em: () => EntityManager;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const em = {
    async execute(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      return rows;
    },
  } as unknown as EntityManager;
  return { em: () => em, calls };
}

/** Collapse the statement's whitespace so assertions read as one line. */
function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('PurchaseConversionService', () => {
  it('grants the conversion when the conditional update claimed the row', async () => {
    const { em } = recordingEm([{ id: 'order-1' }]);
    expect(await new PurchaseConversionService(em).claim('order-1')).toBe(true);
  });

  it('grants nothing when the row was already spent, or never owed one', async () => {
    // The same empty answer for both, and deliberately: an order that was
    // counted a minute ago and one placed before this column existed are
    // equally not to be reported now.
    const { em } = recordingEm([]);
    expect(await new PurchaseConversionService(em).claim('order-1')).toBe(false);
  });

  it('decides and writes in one conditional statement, keyed on the order', async () => {
    const { em, calls } = recordingEm([{ id: 'order-1' }]);
    await new PurchaseConversionService(em).claim('order-1');
    expect(calls).toHaveLength(1);
    const sql = normalized(calls[0]!.sql);
    // One `update`, so PostgreSQL takes the row lock before it re-checks the
    // `where`: exactly one of two simultaneous callers sees a row come back.
    expect(sql).toMatch(/^update "orders"/);
    expect(sql).toContain('set "purchase_conversion_owed" = false');
    expect(sql).toContain('"purchase_conversion_reported_at" = now()');
    // The guard is the flag it is about to clear — without it every call would
    // report a row and every view would be a conversion.
    expect(sql).toContain('and "purchase_conversion_owed" = true');
    expect(sql).toContain('returning "id"');
    expect(calls[0]!.params).toEqual(['order-1']);
  });
});
