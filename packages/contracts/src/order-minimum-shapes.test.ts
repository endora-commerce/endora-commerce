import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  cartDroppedLineReasonSchema,
  cartFromQrResponseSchema,
  cartViewLineSchema,
  isQuoteSeededLineExempt,
  type CartBatchLineInput,
  type CartBatchLineOutcome,
  type CartCustomerContext,
  type CartItemRecord,
  type CartWithItems,
  type CartWritePort,
} from './carts.js';
import {
  ADMIN_ORDER_MAX_ITEMS,
  ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE,
  adminCreateOrderRequestSchema,
  adminOrderPreviewRequestSchema,
  adminOrderPreviewResponseSchema,
  orderPreviewTotalResponseSchema,
} from './orders.js';
import {
  QUICK_ORDER_BUILD_MAX_ITEMS,
  quickOrderBuildRequestSchema,
  quickOrderBuildResponseSchema,
  quickOrderImportResponseSchema,
  quickOrderRejectionReasonSchema,
} from './quick-order.js';
import { conversionSkipSchema } from './shopping-lists.js';

/**
 * Feature 155 — the cart, checkout, admin order, quick-order and shopping-list shapes
 * (`contracts/cart-and-checkout-api.md` §3, §5, §6, §8, §10) and the FR-038 bounds, which
 * are the services' (422), never the schemas' (400 — research R20).
 */

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const ID3 = '00000000-0000-4000-8000-000000000003';
const MONEY = { amount: 10, currency: 'PLN' };

describe('cart view line', () => {
  const line = {
    id: ID1,
    productId: ID2,
    variantId: null,
    productName: 'Bolt',
    productThumbnailUrl: null,
    quantity: 5,
    unitPrice: MONEY,
    lineTotal: MONEY,
    unavailable: false,
    unavailableReason: null,
  };

  it('parses without the new keys', () => {
    const parsed = cartViewLineSchema.parse(line);
    expect(parsed).not.toHaveProperty('belowMinimum');
    expect(parsed).not.toHaveProperty('minOrderQuantity');
  });

  it('carries minOrderQuantity and a pieces belowMinimum', () => {
    const parsed = cartViewLineSchema.parse({
      ...line,
      minOrderQuantity: 10,
      belowMinimum: { kind: 'pieces', minimum: 10 },
    });
    expect(parsed.minOrderQuantity).toBe(10);
    expect(parsed.belowMinimum).toEqual({ kind: 'pieces', minimum: 10 });
  });

  it('carries a packaging-unit belowMinimum and null for none', () => {
    expect(
      cartViewLineSchema.parse({
        ...line,
        belowMinimum: { kind: 'packaging_unit', minimum: 2, packagingUnitName: 'Pallet' },
      }).belowMinimum,
    ).toEqual({ kind: 'packaging_unit', minimum: 2, packagingUnitName: 'Pallet' });
    expect(cartViewLineSchema.parse({ ...line, minOrderQuantity: null, belowMinimum: null }).belowMinimum).toBeNull();
  });
});

describe('cart item record — quote-seeded quantity (data-model §2, FR-028)', () => {
  it('CartItemRecord carries a required quoteSeededQuantity: number | null', () => {
    expectTypeOf<CartItemRecord['quoteSeededQuantity']>().toEqualTypeOf<number | null>();
    // Required, not optional: a record built without it is a type error.
    expectTypeOf<undefined>().not.toMatchTypeOf<CartItemRecord['quoteSeededQuantity']>();
  });

  // The state-based exemption (owner ruling P2): exempt while the line's quantity
  // equals the quantity the accepted quote seeded, and only while the basket still
  // carries its quote source.
  it.each([
    { source: 'qr-1', seeded: 5, quantity: 5, exempt: true },
    { source: 'qr-1', seeded: 5, quantity: 12, exempt: false },
    { source: 'qr-1', seeded: 5, quantity: 6, exempt: false },
    { source: 'qr-1', seeded: 5, quantity: 4, exempt: false },
    { source: 'qr-1', seeded: null, quantity: 5, exempt: false },
    { source: null, seeded: 5, quantity: 5, exempt: false },
    { source: null, seeded: null, quantity: 5, exempt: false },
  ])(
    'source $source, seeded $seeded, quantity $quantity → exempt $exempt',
    ({ source, seeded, quantity, exempt }) => {
      expect(
        isQuoteSeededLineExempt(
          { sourceQuoteRequestId: source },
          { quantity, quoteSeededQuantity: seeded },
        ),
      ).toBe(exempt);
    },
  );
});

describe('cart dropped lines', () => {
  it('has below_minimum as a reason', () => {
    expect(cartDroppedLineReasonSchema.options).toContain('below_minimum');
  });

  it('a dropped line may carry the minimum', () => {
    const parsed = cartFromQrResponseSchema.parse({
      data: {
        cartId: ID1,
        appendedLineCount: 0,
        droppedLines: [
          { productId: ID2, productName: 'Bolt', reason: 'below_minimum', minimum: 10 },
          { productId: ID3, productName: 'Nut', reason: 'not_purchasable' },
        ],
      },
    });
    expect(parsed.data.droppedLines[0]).toMatchObject({ reason: 'below_minimum', minimum: 10 });
    expect(parsed.data.droppedLines[1]).not.toHaveProperty('minimum');
  });
});

describe('checkout preview', () => {
  const totals = {
    subtotal: 1,
    taxTotal: 0,
    deliveryTotal: 0,
    paymentSurcharge: 0,
    discountTotal: 0,
    total: 1,
    currency: 'PLN',
  };

  it('defaults belowMinimumLines to []', () => {
    expect(orderPreviewTotalResponseSchema.parse(totals).belowMinimumLines).toEqual([]);
  });

  it('accepts minimum lines and a product_unavailable line without name or minimum', () => {
    const parsed = orderPreviewTotalResponseSchema.parse({
      ...totals,
      belowMinimumLines: [
        { cartItemId: ID1, productId: ID2, productName: 'Bolt', kind: 'pieces', minimum: 10 },
        {
          cartItemId: ID2,
          productId: ID2,
          productName: 'Bolt',
          kind: 'packaging_unit',
          minimum: 2,
          packagingUnitName: 'Pallet',
        },
        { cartItemId: ID3, productId: ID3, kind: 'product_unavailable' },
      ],
    });
    expect(parsed.belowMinimumLines).toHaveLength(3);
    expect(parsed.belowMinimumLines[2]).toEqual({ cartItemId: ID3, productId: ID3, kind: 'product_unavailable' });
  });
});

describe('admin order preview', () => {
  it('keeps BELOW_MINIMUM_QUANTITY last, after the pricing codes (UNPRICED since feature 160)', () => {
    expect(ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE).toEqual([
      'PRODUCT_NOT_FOUND',
      'PRODUCT_NOT_VISIBLE_TO_CUSTOMER',
      'PRODUCT_NOT_IN_SALES_CHANNEL',
      'QUOTE_ONLY',
      'UNPRICED',
      'BELOW_MINIMUM_QUANTITY',
    ]);
  });

  it('a message may carry a minimum, and still parses without one', () => {
    const response = {
      lines: [],
      summary: {
        subtotal: 0,
        taxTotal: 0,
        deliveryTotal: 0,
        paymentSurcharge: 0,
        discountTotal: 0,
        total: 0,
        currency: 'PLN',
      },
      messages: [
        { productId: ID1, code: 'BELOW_MINIMUM_QUANTITY', minimum: 10 },
        { productId: ID2, code: 'QUOTE_ONLY' },
      ],
    };
    const parsed = adminOrderPreviewResponseSchema.parse(response);
    expect(parsed.messages[0]).toEqual({ productId: ID1, code: 'BELOW_MINIMUM_QUANTITY', minimum: 10 });
    expect(parsed.messages[1]).not.toHaveProperty('minimum');
  });
});

describe('quick-order import', () => {
  it('has below_minimum as a rejection reason', () => {
    expect(quickOrderRejectionReasonSchema.options).toContain('below_minimum');
  });

  it('a rejected row may carry minimum and productTotal; a recognised row a warning; the summary a warningCount', () => {
    const parsed = quickOrderImportResponseSchema.parse({
      recognized: [
        {
          line: 2,
          sku: 'SKU-2',
          productId: ID2,
          variantId: null,
          quantity: 3,
          warning: { reason: 'below_minimum', minimum: 10, productTotal: 3 },
        },
        { line: 3, sku: 'SKU-3', productId: ID3, variantId: null, quantity: 1 },
      ],
      rejected: [
        { line: 1, raw: 'SKU-1,4', reason: 'below_minimum', minimum: 10, productTotal: 7 },
        { line: 4, raw: 'x', reason: 'malformed_row' },
      ],
      summary: { recognizedCount: 2, rejectedCount: 2, mergedCount: 0, truncated: false, warningCount: 1 },
    });
    expect(parsed.recognized[0]!.warning).toEqual({ reason: 'below_minimum', minimum: 10, productTotal: 3 });
    expect(parsed.recognized[1]).not.toHaveProperty('warning');
    expect(parsed.rejected[0]).toMatchObject({ minimum: 10, productTotal: 7 });
    expect(parsed.rejected[1]).not.toHaveProperty('minimum');
    expect(parsed.summary.warningCount).toBe(1);
  });

  it('a productTotal of 0 is allowed; a negative one is not', () => {
    const base = { recognized: [], summary: { recognizedCount: 0, rejectedCount: 1, mergedCount: 0, truncated: false } };
    const row = { line: 1, raw: 'r', reason: 'below_minimum', minimum: 10 };
    expect(quickOrderImportResponseSchema.safeParse({ ...base, rejected: [{ ...row, productTotal: 0 }] }).success).toBe(
      true,
    );
    expect(
      quickOrderImportResponseSchema.safeParse({ ...base, rejected: [{ ...row, productTotal: -1 }] }).success,
    ).toBe(false);
  });
});

describe('quick-order build', () => {
  it('the response parses without rejected, and with rejected rows naming the product', () => {
    expect(quickOrderBuildResponseSchema.parse({ target: 'cart', cartId: ID1 })).not.toHaveProperty('rejected');
    const parsed = quickOrderBuildResponseSchema.parse({
      target: 'cart',
      cartId: ID1,
      rejected: [
        {
          productId: ID2,
          variantId: null,
          quantity: 3,
          productName: 'Bolt',
          reason: 'below_minimum',
          kind: 'pieces',
          minimum: 10,
        },
      ],
    });
    expect(parsed.rejected?.[0]).toMatchObject({ productName: 'Bolt', reason: 'below_minimum', minimum: 10 });
  });
});

describe('quick-order build refusal — packaging unit', () => {
  it('keeps an optional packagingUnitName on a rejected line', () => {
    const parsed = quickOrderBuildResponseSchema.parse({
      target: 'cart',
      cartId: ID1,
      rejected: [
        {
          productId: ID2,
          variantId: null,
          quantity: 64,
          productName: 'Bolt',
          reason: 'below_minimum',
          kind: 'packaging_unit',
          minimum: 2,
          packagingUnitName: 'Pallet',
        },
      ],
    });
    expect(parsed.rejected?.[0]?.packagingUnitName).toBe('Pallet');
  });
});

describe('shopping-list conversion skip', () => {
  it('has below_minimum with an optional minimum', () => {
    expect(
      conversionSkipSchema.parse({ itemId: ID1, productId: ID2, reason: 'below_minimum', minimum: 10 }),
    ).toEqual({ itemId: ID1, productId: ID2, reason: 'below_minimum', minimum: 10 });
    expect(conversionSkipSchema.parse({ itemId: ID1, productId: ID2, reason: 'product_not_found' })).not.toHaveProperty(
      'minimum',
    );
  });
});

describe('FR-038 bounds are constants, not schema limits (R20)', () => {
  it('exports both constants as 200', () => {
    expect(QUICK_ORDER_BUILD_MAX_ITEMS).toBe(200);
    expect(ADMIN_ORDER_MAX_ITEMS).toBe(200);
  });

  const items201 = Array.from({ length: 201 }, () => ({ productId: ID1, quantity: 1 }));

  it('quickOrderBuildRequestSchema still parses 201 items', () => {
    expect(quickOrderBuildRequestSchema.safeParse({ target: 'cart', items: items201 }).success).toBe(true);
  });

  it('adminCreateOrderRequestSchema still parses 201 items', () => {
    const result = adminCreateOrderRequestSchema.safeParse({
      customerAccountId: ID1,
      salesChannelId: ID2,
      items: items201,
      deliveryMethodId: ID3,
      paymentMethodId: ID3,
      deliveryAddressId: ID1,
      billingAddressId: ID1,
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('adminOrderPreviewRequestSchema still parses 201 items', () => {
    expect(
      adminOrderPreviewRequestSchema.safeParse({ customerAccountId: ID1, salesChannelId: ID2, items: items201 }).success,
    ).toBe(true);
  });
});

describe('cart batch add — CartWritePort.addItems (contracts/cart-and-checkout-api.md §4, R8)', () => {
  it('CartBatchLineInput has addItem\'s line fields', () => {
    expectTypeOf<CartBatchLineInput>().toEqualTypeOf<{
      productId: string;
      variantId?: string;
      quantity: number;
      packagingUnitId?: string;
      salesChannelId?: string;
    }>();
  });

  it('CartBatchLineOutcome is added, below_minimum or failed, each with its index', () => {
    expectTypeOf<CartBatchLineOutcome['status']>().toEqualTypeOf<'added' | 'below_minimum' | 'failed'>();
    expectTypeOf<CartBatchLineOutcome['index']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<CartBatchLineOutcome, { status: 'below_minimum' }>>().toEqualTypeOf<{
      index: number;
      status: 'below_minimum';
      productId: string;
      productName: string;
      kind: 'pieces' | 'packaging_unit';
      minimum: number;
      packagingUnitName?: string;
    }>();
    // A failed line carries the refusal it met and nothing about the product (F1).
    expectTypeOf<Extract<CartBatchLineOutcome, { status: 'failed' }>>().toEqualTypeOf<{
      index: number;
      status: 'failed';
      error: { status: number; code: string; message: string; details?: unknown };
    }>();
  });

  it('addItems takes the actor, the lines and the modes, and answers the cart with outcomes', () => {
    expectTypeOf<CartWritePort['addItems']>().parameters.toEqualTypeOf<
      [
        { customer?: CartCustomerContext; anonymousToken?: string },
        readonly CartBatchLineInput[],
        {
          onLineError: 'throw' | 'report';
          onBelowMinimum?: 'report' | 'throw';
          replaceExisting?: boolean;
          keepRepeatedLines?: boolean;
          language?: string;
        },
      ]
    >();
    expectTypeOf<CartWritePort['addItems']>().returns.toEqualTypeOf<
      Promise<CartWithItems & { outcomes: CartBatchLineOutcome[] }>
    >();
  });
});
