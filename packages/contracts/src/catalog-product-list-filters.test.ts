import { describe, expect, it } from 'vitest';
import {
  adminProductListFiltersSchema,
  productStockFilterSchema,
  resolveProductIdsRequestSchema,
} from './catalog.js';

/**
 * Issue #1624 — the admin products list narrows by category, sales channel and
 * stock state, and the selection (`resolve-ids`) takes the very same filters, so
 * "select all matching" can never reach a product the list did not show.
 */

const CATEGORY = '00000000-0000-4000-8000-0000000000c1';
const CHANNEL = '00000000-0000-4000-8000-0000000000d1';

describe('adminProductListFiltersSchema (issue #1624)', () => {
  it('takes a category id, a sales-channel id and a stock state', () => {
    expect(
      adminProductListFiltersSchema.parse({ categoryId: CATEGORY, salesChannelId: CHANNEL, stock: 'low' }),
    ).toEqual({ categoryId: CATEGORY, salesChannelId: CHANNEL, stock: 'low' });
    expect(adminProductListFiltersSchema.parse({})).toEqual({});
  });

  it('refuses a malformed id and an unknown stock state', () => {
    expect(adminProductListFiltersSchema.safeParse({ categoryId: 'shoes' }).success).toBe(false);
    expect(adminProductListFiltersSchema.safeParse({ salesChannelId: 'pl_retail' }).success).toBe(false);
    expect(adminProductListFiltersSchema.safeParse({ stock: 'in' }).success).toBe(false);
  });

  it('offers the two stock states the Inventory list offers', () => {
    expect(productStockFilterSchema.options).toEqual(['low', 'out']);
  });
});

describe('resolveProductIdsRequestSchema — the list\'s narrowing filters (issue #1624)', () => {
  it('accepts every filter the list accepts', () => {
    const body = { categoryId: CATEGORY, salesChannelId: CHANNEL, stock: 'out', archived: 'exclude' } as const;
    expect(resolveProductIdsRequestSchema.parse(body)).toEqual(body);
  });

  it('refuses what the list refuses', () => {
    expect(resolveProductIdsRequestSchema.safeParse({ categoryId: 'shoes' }).success).toBe(false);
    expect(resolveProductIdsRequestSchema.safeParse({ stock: 'high' }).success).toBe(false);
  });
});
