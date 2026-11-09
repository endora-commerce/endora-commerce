import { describe, expect, it } from 'vitest';
import {
  ADMIN_ORDER_MAX_ITEMS,
  ERROR_CODES,
  LINE_QUANTITY_EXCEEDED,
  createPackagingUnitRequestSchema,
  isAmountPrecisionIssue,
  isLineQuantityExceededIssue,
  updateCartItemRequestSchema,
  updatePackagingUnitRequestSchema,
  LINE_QUANTITY_MAX,
  ORDER_MINIMUM_MAX,
  QUICK_ORDER_BUILD_MAX_ITEMS,
  REQUEST_LINE_ITEMS_MAX,
  addCartItemRequestSchema,
  addShoppingListItemRequestSchema,
  adminCreateOrderRequestSchema,
  adminCreateQuoteRequestSchema,
  adminOrderPreviewRequestSchema,
  adminPatchQuoteRequestSchema,
  apiPlaceOrderRequestSchema,
  cartSnapshotSchema,
  catalogBulkPriceRequestSchema,
  createQuoteRequestSchema,
  createReturnCaseRequestSchema,
  lineQuantitySchema,
  patchQuoteRequestSchema,
  quickOrderBuildRequestSchema,
  quickOrderOneClickRequestSchema,
  updateCartItemRequestStrictSchema,
  updateShoppingListItemRequestSchema,
} from './index.js';

/**
 * Issue #351 — one upper bound for a line quantity in every request schema that
 * carries one, so an out-of-range quantity is a validation failure (400) and
 * never reaches the integer column it is stored in; and one item-count bound
 * for the request line arrays.
 */

const ID = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';

describe('lineQuantitySchema (issue #351)', () => {
  it('is the order-minimum ceiling, so the largest minimum is still orderable', () => {
    expect(LINE_QUANTITY_MAX).toBe(1_000_000);
    expect(LINE_QUANTITY_MAX).toBe(ORDER_MINIMUM_MAX);
  });

  it('accepts 1 and the bound', () => {
    expect(lineQuantitySchema.safeParse(1).success).toBe(true);
    expect(lineQuantitySchema.safeParse(LINE_QUANTITY_MAX).success).toBe(true);
  });

  it.each([
    ['one above the bound', LINE_QUANTITY_MAX + 1],
    ['the int4 ceiling', 2 ** 31],
    ['past 2^53', 2 ** 53 + 2],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
  ])('refuses %s', (_label, value) => {
    expect(lineQuantitySchema.safeParse(value).success).toBe(false);
  });

  // Architect ruling R1 on PR #1009 — a refusal of its own, tagged like the
  // money-precision issue, so the envelope answers the translated
  // `LINE_QUANTITY_EXCEEDED` instead of `VALIDATION_FAILED`.
  it('refuses past the bound with the one issue tagged LINE_QUANTITY_EXCEEDED', () => {
    const issues = lineQuantitySchema.safeParse(LINE_QUANTITY_MAX + 1).error?.issues ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe(LINE_QUANTITY_EXCEEDED);
    expect(isLineQuantityExceededIssue(issues[0])).toBe(true);
    expect(isAmountPrecisionIssue(issues[0])).toBe(false);
    expect(ERROR_CODES.LINE_QUANTITY_EXCEEDED).toBe(LINE_QUANTITY_EXCEEDED);
  });

  it('keeps the floor and the whole-number rule as plain issues', () => {
    for (const value of [0, 1.5]) {
      const issues = lineQuantitySchema.safeParse(value).error?.issues ?? [];
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(isLineQuantityExceededIssue)).toBe(false);
    }
  });

  it('recognises the Fastify-wrapped form, whose params carry the issue', () => {
    expect(isLineQuantityExceededIssue({ params: { params: { code: LINE_QUANTITY_EXCEEDED } } })).toBe(true);
    expect(isLineQuantityExceededIssue({ params: { code: 'too_big' } })).toBe(false);
    expect(isLineQuantityExceededIssue(null)).toBe(false);
  });
});

describe('REQUEST_LINE_ITEMS_MAX (issue #351)', () => {
  it('is the one 200-line cap the order and quick-order intakes already apply', () => {
    expect(REQUEST_LINE_ITEMS_MAX).toBe(200);
    expect(ADMIN_ORDER_MAX_ITEMS).toBe(REQUEST_LINE_ITEMS_MAX);
    expect(QUICK_ORDER_BUILD_MAX_ITEMS).toBe(REQUEST_LINE_ITEMS_MAX);
  });
});

/** Every request schema carrying a line quantity, built around one quantity. */
const address = { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-001', country: 'PL' };
const bodies: Record<string, { schema: { safeParse(v: unknown): { success: boolean } }; body: (q: number) => unknown }> = {
  'carts add item': { schema: addCartItemRequestSchema, body: (q) => ({ productId: ID, quantity: q }) },
  'carts update item (strict)': { schema: updateCartItemRequestStrictSchema, body: (q) => ({ quantity: q }) },
  'quote request create': {
    schema: createQuoteRequestSchema,
    body: (q) => ({ items: [{ productId: ID, quantity: q }] }),
  },
  'quote request draft edit': {
    schema: patchQuoteRequestSchema,
    body: (q) => ({ items: [{ productId: ID, quantity: q }] }),
  },
  'admin quote request create': {
    schema: adminCreateQuoteRequestSchema,
    body: (q) => ({
      organizationId: ID,
      customerAccountId: ID2,
      items: [{ productId: ID, quantity: q, agreedUnitPrice: 1 }],
    }),
  },
  'admin quote request edit': {
    schema: adminPatchQuoteRequestSchema,
    body: (q) => ({ items: [{ productId: ID, quantity: q }] }),
  },
  'admin order create': {
    schema: adminCreateOrderRequestSchema,
    body: (q) => ({
      customerAccountId: ID,
      salesChannelId: ID2,
      items: [{ productId: ID, quantity: q }],
      deliveryMethodId: ID,
      paymentMethodId: ID,
      deliveryAddress: { ...address, saveToAddressBook: false },
      billingAddress: { ...address, saveToAddressBook: false },
    }),
  },
  'admin order preview': {
    schema: adminOrderPreviewRequestSchema,
    body: (q) => ({ customerAccountId: ID, salesChannelId: ID2, items: [{ productId: ID, quantity: q }] }),
  },
  'external order intake': {
    schema: apiPlaceOrderRequestSchema,
    body: (q) => ({
      lines: [{ sku: 'SKU', quantity: q }],
      deliveryMethodId: ID,
      paymentMethodId: ID,
      deliveryAddressId: ID,
      billingAddressId: ID,
    }),
  },
  'quick order build': {
    schema: quickOrderBuildRequestSchema,
    body: (q) => ({ target: 'cart', items: [{ productId: ID, quantity: q }] }),
  },
  'quick order one-click': { schema: quickOrderOneClickRequestSchema, body: (q) => ({ productId: ID, quantity: q }) },
  'shopping list add item': { schema: addShoppingListItemRequestSchema, body: (q) => ({ productId: ID, quantity: q }) },
  'shopping list update item': { schema: updateShoppingListItemRequestSchema, body: (q) => ({ quantity: q }) },
  'return create': {
    schema: createReturnCaseRequestSchema,
    body: (q) => ({ orderId: ID, kind: 'return', lines: [{ orderItemId: ID2, quantity: q, reasonId: ID }] }),
  },
  'external bulk pricing': {
    schema: catalogBulkPriceRequestSchema,
    body: (q) => ({ lines: [{ sku: 'SKU', quantity: q }] }),
  },
  'promotions preview': {
    schema: cartSnapshotSchema,
    body: (q) => ({
      organizationId: null,
      customerGroupId: null,
      currency: 'PLN',
      deliveryTotal: 0,
      lines: [{ productId: ID, variantId: null, categoryIds: [], quantity: q, unitPrice: { amount: 1, currency: 'PLN' } }],
    }),
  },
};

describe.each(Object.entries(bodies))('%s — line quantity bound (issue #351)', (_name, { schema, body }) => {
  it('accepts a quantity at the bound', () => {
    expect(schema.safeParse(body(LINE_QUANTITY_MAX))).toMatchObject({ success: true });
  });

  it('refuses a quantity one above the bound', () => {
    expect(schema.safeParse(body(LINE_QUANTITY_MAX + 1)).success).toBe(false);
  });
});

describe('line arrays bounded at REQUEST_LINE_ITEMS_MAX (issue #351)', () => {
  const quoteLine = { productId: ID, quantity: 1 };
  const adminQuoteLine = { productId: ID, quantity: 1, agreedUnitPrice: 1 };
  const returnLine = { orderItemId: ID2, quantity: 1, reasonId: ID };
  const lines = <T>(line: T, n: number): T[] => Array.from({ length: n }, () => line);
  const cases: Array<[string, (n: number) => unknown, { safeParse(v: unknown): { success: boolean } }]> = [
    ['quote request create', (n) => ({ items: lines(quoteLine, n) }), createQuoteRequestSchema],
    ['quote request draft edit', (n) => ({ items: lines(quoteLine, n) }), patchQuoteRequestSchema],
    [
      'admin quote request create',
      (n) => ({ organizationId: ID, customerAccountId: ID2, items: lines(adminQuoteLine, n) }),
      adminCreateQuoteRequestSchema,
    ],
    ['admin quote request edit', (n) => ({ items: lines(quoteLine, n) }), adminPatchQuoteRequestSchema],
    [
      'return create',
      (n) => ({ orderId: ID, kind: 'return', lines: lines(returnLine, n) }),
      createReturnCaseRequestSchema,
    ],
  ];

  it.each(cases)('%s accepts the cap and refuses one more', (_name, body, schema) => {
    expect(schema.safeParse(body(REQUEST_LINE_ITEMS_MAX))).toMatchObject({ success: true });
    expect(schema.safeParse(body(REQUEST_LINE_ITEMS_MAX + 1)).success).toBe(false);
  });
});

describe('the cart line edit and the packaging unit base quantity (ruling R3)', () => {
  it('a cart line edit takes 0 (remove) up to the bound, past 999', () => {
    for (const quantity of [0, 999, 5000, LINE_QUANTITY_MAX]) {
      expect(updateCartItemRequestSchema.safeParse({ quantity }).success, String(quantity)).toBe(true);
    }
    const issues = updateCartItemRequestSchema.safeParse({ quantity: LINE_QUANTITY_MAX + 1 }).error?.issues ?? [];
    expect(issues.map(isLineQuantityExceededIssue)).toEqual([true]);
    expect(updateCartItemRequestSchema.safeParse({ quantity: -1 }).success).toBe(false);
  });

  it('a packaging unit base quantity is a line quantity: past the bound it is refused', () => {
    const create = (baseQuantity: number) => createPackagingUnitRequestSchema.safeParse({ name: 'Pallet', baseQuantity });
    expect(create(LINE_QUANTITY_MAX).success).toBe(true);
    expect((create(LINE_QUANTITY_MAX + 1).error?.issues ?? []).map(isLineQuantityExceededIssue)).toEqual([true]);
    expect(updatePackagingUnitRequestSchema.safeParse({ baseQuantity: LINE_QUANTITY_MAX }).success).toBe(true);
    expect(updatePackagingUnitRequestSchema.safeParse({ baseQuantity: LINE_QUANTITY_MAX + 1 }).success).toBe(false);
  });
});
