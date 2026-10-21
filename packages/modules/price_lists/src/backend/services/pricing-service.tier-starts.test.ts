import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PricingService } from './pricing-service.js';

/**
 * Feature 160 (T049) — `listTierStarts`: the distinct starting quantities of
 * the rows and base tiers that can apply to a product (and a variant) in a
 * currency, ascending. The external catalogue probes `resolveLinePrices` at
 * each of them to build a buyer's ladder, so over-inclusion is allowed (a
 * start that does not apply resolves to its predecessor's price) and one
 * statement answers it.
 */
describe('PricingService.listTierStarts (price books)', () => {
  function serviceAnswering(rows: Array<{ min_quantity: number | string }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const em = {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return rows;
      },
    } as unknown as EntityManager;
    const service = new PricingService(() => em, undefined, undefined, undefined, undefined, {
      model: 'books',
      channelBridge: { entityIdsInChannelSubquery: () => ({ sql: 'select 1', params: [] }) },
    });
    return { service, calls };
  }

  it('answers distinct starts, ascending, as numbers, in one statement', async () => {
    const { service, calls } = serviceAnswering([{ min_quantity: '1' }, { min_quantity: 10 }, { min_quantity: '100' }]);
    expect(await service.listTierStarts('p1', 'pln', 'v1')).toEqual([1, 10, 100]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/price_list_matrix_entries/);
    expect(calls[0]!.params).toEqual(expect.arrayContaining(['p1', 'PLN', 'v1']));
  });

  it('reads only books of the currency that can apply now, and the base books', async () => {
    const { service, calls } = serviceAnswering([]);
    await service.listTierStarts('p1', 'PLN');
    expect(calls[0]!.sql).toMatch(/is_system/);
    expect(calls[0]!.sql).toMatch(/starts_at/);
    expect(calls[0]!.sql).toMatch(/ends_at/);
  });
});
