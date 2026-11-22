import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { InventoryStockReadService, quotedColumn } from './inventory-read-port.js';

/**
 * Issue #1624 — the stock-state predicate `catalog` embeds in its products list.
 * Its behaviour against a database is `backend/test/contract/catalog/products-admin-list-filters.test.ts`;
 * this file holds the two properties a database cannot show: it splices only
 * quoted column references, and it executes nothing.
 */
const columns = {
  productId: '"products"."id"',
  manageStock: '"products"."manage_stock"',
  lowStockThreshold: '"products"."low_stock_threshold"',
};

describe('InventoryStockReadService.stockStatePredicate (issue #1624)', () => {
  const service = new InventoryStockReadService((): EntityManager => {
    throw new Error('the predicate must not touch the database');
  });

  it('correlates on the caller\'s product column and names no caller table', () => {
    for (const state of ['low', 'out'] as const) {
      const { sql, params } = service.stockStatePredicate(state, columns);
      expect(sql).toContain('sl.product_id = "products"."id"');
      expect(sql).toContain('"products"."manage_stock" is not false');
      expect(sql).not.toMatch(/\bfrom\s+"?products"?/i);
      expect(params).toEqual([]);
    }
    expect(service.stockStatePredicate('low', columns).sql).toContain('<= "products"."low_stock_threshold"');
  });

  it.each(['products.id', '"id"; drop table products', 'id', '"Products"."id"'])(
    'refuses %s as a column reference',
    (ref) => {
      expect(() => quotedColumn(ref)).toThrow(/quoted column reference/);
      expect(() => service.stockStatePredicate('out', { ...columns, productId: ref })).toThrow();
    },
  );
});
