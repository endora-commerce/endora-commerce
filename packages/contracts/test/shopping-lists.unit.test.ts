import { describe, expect, it } from 'vitest';
import { convertToRfqResponseSchema } from '../src/index.js';

/**
 * Issue #1159 (architect ruling A) — `POST /shopping-lists/:id/convert-to-rfq`
 * answers `rfqId: null` when no item converted, and the contract says so. The
 * key is always present: `nullable`, not `optional`.
 */
describe('convertToRfqResponseSchema', () => {
  const base = {
    shoppingListId: '00000000-0000-4000-8000-000000000001',
    added: 0,
    skipped: [
      {
        itemId: '00000000-0000-4000-8000-000000000002',
        productId: '00000000-0000-4000-8000-000000000003',
        reason: 'product_archived' as const,
      },
    ],
  };

  it('accepts `rfqId: null` — nothing converted, no quote request was created', () => {
    expect(convertToRfqResponseSchema.safeParse({ ...base, rfqId: null }).success).toBe(true);
  });

  it('accepts a quote request id', () => {
    expect(
      convertToRfqResponseSchema.safeParse({ ...base, added: 1, rfqId: '00000000-0000-4000-8000-000000000004' })
        .success,
    ).toBe(true);
  });

  it('refuses a reply without the `rfqId` key', () => {
    expect(convertToRfqResponseSchema.safeParse(base).success).toBe(false);
  });
});
