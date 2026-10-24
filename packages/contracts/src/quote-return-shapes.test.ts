import { describe, expect, expectTypeOf, it } from 'vitest';
import { comparisonProductSummarySchema } from './comparisons.js';
import {
  createQuoteRequestLineSchema,
  createQuoteRequestSchema,
  quoteRequestItemSchema,
  type CreateForCustomerOptions,
  type QuoteRequestLineRecord,
} from './quote-requests.js';
import { returnableLineSchema, returnableResponseSchema, type OrderReturnContextLine } from './returns.js';

/**
 * Feature 155 — quote-request, returns and comparison shapes
 * (`contracts/quote-requests-api.md` §1, §3, §4; `contracts/returns-api.md` §2;
 * `contracts/catalog-api.md` §4).
 */

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';

describe('buyer quote-request line', () => {
  it('accepts a packagingUnitId', () => {
    expect(
      createQuoteRequestLineSchema.parse({ productId: ID1, quantity: 64, packagingUnitId: ID2 }).packagingUnitId,
    ).toBe(ID2);
  });

  it('refuses a packagingUnitId that is not a uuid', () => {
    expect(
      createQuoteRequestLineSchema.safeParse({ productId: ID1, quantity: 64, packagingUnitId: 'pallet' }).success,
    ).toBe(false);
  });
});

describe('createQuoteRequestSchema — no HTTP body carries `minimums` (S3, M4)', () => {
  it('strips a top-level and a per-line `minimums` key instead of refusing it', () => {
    const result = createQuoteRequestSchema.safeParse({
      minimums: 'warn',
      items: [{ productId: ID1, quantity: 1, minimums: 'warn' }],
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('minimums');
    expect(result.data!.items[0]).not.toHaveProperty('minimums');
  });
});

describe('CreateForCustomerOptions', () => {
  it("accepts minimums 'warn' and 'enforce'", () => {
    const warn: CreateForCustomerOptions = { minimums: 'warn' };
    const enforce: CreateForCustomerOptions = { minimums: 'enforce' };
    expect([warn.minimums, enforce.minimums]).toEqual(['warn', 'enforce']);
    expectTypeOf<CreateForCustomerOptions['minimums']>().toEqualTypeOf<'enforce' | 'warn' | undefined>();
  });
});

describe('quote-request item', () => {
  const item = {
    id: ID1,
    productId: ID2,
    productName: 'Bolt',
    productSlug: null,
    variantId: null,
    variantLabel: null,
    quantity: 5,
    desiredUnitPrice: null,
    agreedUnitPrice: null,
    lineNote: null,
    lineCurrency: 'PLN',
    discountPercent: null,
  };

  it('parses without the new keys', () => {
    const parsed = quoteRequestItemSchema.parse(item);
    expect(parsed).not.toHaveProperty('minimumWarning');
    expect(parsed).not.toHaveProperty('packagingUnitId');
  });

  it('carries minimumWarning and packagingUnitId, each nullable', () => {
    const parsed = quoteRequestItemSchema.parse({
      ...item,
      packagingUnitId: ID1,
      minimumWarning: { kind: 'packaging_unit', minimum: 2, packagingUnitName: 'Pallet' },
    });
    expect(parsed.packagingUnitId).toBe(ID1);
    expect(parsed.minimumWarning).toEqual({ kind: 'packaging_unit', minimum: 2, packagingUnitName: 'Pallet' });
    const cleared = quoteRequestItemSchema.parse({ ...item, packagingUnitId: null, minimumWarning: null });
    expect(cleared.packagingUnitId).toBeNull();
    expect(cleared.minimumWarning).toBeNull();
  });
});

describe('QuoteRequestLineRecord (read port, contracts/quote-requests-api.md §5)', () => {
  it('carries an optional, nullable packagingUnitId', () => {
    expectTypeOf<QuoteRequestLineRecord['packagingUnitId']>().toEqualTypeOf<string | null | undefined>();
    const line: Pick<QuoteRequestLineRecord, 'packagingUnitId'> = { packagingUnitId: ID1 };
    expect(line.packagingUnitId).toBe(ID1);
  });
});

describe('returnable lines', () => {
  const line = {
    orderItemId: ID1,
    productId: ID2,
    name: 'Bolt',
    purchasedQty: 4,
    remainingReturnableQty: 4,
    paidUnitAmount: 10,
    currency: 'PLN',
  };

  it('carries returnable and notReturnableReason', () => {
    expect(returnableLineSchema.parse({ ...line, returnable: true }).returnable).toBe(true);
    expect(
      returnableLineSchema.parse({ ...line, returnable: false, notReturnableReason: 'product_not_returnable' }),
    ).toMatchObject({ returnable: false, notReturnableReason: 'product_not_returnable' });
    expect(returnableLineSchema.safeParse({ ...line, returnable: false, notReturnableReason: 'other' }).success).toBe(
      false,
    );
  });

  it('requires returnable (feature 155 Phase 12a, contracts/returns-api.md §2)', () => {
    expect(returnableLineSchema.safeParse(line).success).toBe(false);
  });

  it('the response reason has no_returnable_lines', () => {
    expect(returnableResponseSchema.shape.reason.unwrap().options).toContain('no_returnable_lines');
    expect(
      returnableResponseSchema.parse({
        eligible: false,
        reason: 'no_returnable_lines',
        freeReturnEligible: true,
        lines: [{ ...line, returnable: false, notReturnableReason: 'product_not_returnable' }],
      }).reason,
    ).toBe('no_returnable_lines');
  });
});

describe('OrderReturnContextLine (port, contracts/returns-api.md §1)', () => {
  it('carries a required returnableAtPurchase: boolean | null', () => {
    // Required, not optional: an optional key would widen to `| undefined`.
    expectTypeOf<OrderReturnContextLine['returnableAtPurchase']>().toEqualTypeOf<boolean | null>();
    expectTypeOf<OrderReturnContextLine>().toHaveProperty('returnableAtPurchase');
    const base = { orderItemId: ID1, productId: ID2, name: 'Bolt', purchasedQty: 1, paidUnitAmount: 1, paidLineAmount: 1, unitNetPrice: '1.00', taxRate: '0.0000' };
    // @ts-expect-error — a line without the stamp is not an OrderReturnContextLine.
    const missing: OrderReturnContextLine = base;
    const legacy: OrderReturnContextLine = { ...base, returnableAtPurchase: null };
    expect([missing.orderItemId, legacy.returnableAtPurchase]).toEqual([ID1, null]);
  });
});

describe('comparison product summary', () => {
  const summary = {
    id: ID1,
    sku: 'SKU-1',
    name: { en: 'Bolt' },
    slug: 'bolt',
    type: 'simple',
    primaryAssetUrl: null,
    price: null,
    available: true,
    addedAt: '2026-10-16T00:00:00.000Z',
  };

  it('parses with and without minOrderQuantity', () => {
    expect(comparisonProductSummarySchema.parse(summary)).not.toHaveProperty('minOrderQuantity');
    expect(comparisonProductSummarySchema.parse({ ...summary, minOrderQuantity: 10 }).minOrderQuantity).toBe(10);
    expect(comparisonProductSummarySchema.parse({ ...summary, minOrderQuantity: null }).minOrderQuantity).toBeNull();
  });
});
