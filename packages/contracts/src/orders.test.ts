import { describe, expect, it } from 'vitest';
import {
  ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE,
  adminOrderDetailSchema,
  adminOrderPreviewMessageCodeSchema,
  adminOrderPreviewResponseSchema,
  adminOrdersListQuerySchema,
  adminCreateOrderRequestSchema,
  adminOrderPreviewRequestSchema,
  createOrderSavedViewRequestSchema,
  orderItemSchema,
  orderCommentSchema,
  orderCommentSystemNoteSchema,
  orderSavedViewSchema,
  orderSchema,
  updateOrderSavedViewRequestSchema,
} from './orders.js';

const ADDRESS = {
  recipientName: 'Jan Kowalski',
  street: 'ul. Prosta 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'PL',
  phone: null,
};

/** An order as the routes answered it before `customFieldValues` was declared. */
const ORDER = {
  id: '00000000-0000-4000-8000-000000000001',
  businessId: '1',
  organizationId: '00000000-0000-4000-8000-000000000002',
  placedByCustomerAccountId: '00000000-0000-4000-8000-000000000003',
  placedOnBehalf: false,
  placedOnBehalfByAdminUserId: null,
  salesChannelId: '00000000-0000-4000-8000-000000000004',
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: ADDRESS,
  billingAddress: ADDRESS,
  deliveryMethod: {
    id: '00000000-0000-4000-8000-000000000005',
    code: 'pickup',
    name: 'Pickup',
    cost: 0,
  },
  paymentMethod: {
    id: '00000000-0000-4000-8000-000000000006',
    code: 'bank_transfer',
    name: 'Bank transfer',
    kind: 'bank_transfer',
  },
  sourceQuoteRequestId: null,
  items: [],
  subtotal: 0,
  taxTotal: 0,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 0,
  currency: 'PLN',
  placedAt: '2026-10-10T10:00:00.000Z',
  customerNote: null,
  nextAction: null,
};

const ORGANIZATION = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Acme',
  legalName: null,
  taxId: 'PL0000000099',
  vatStatus: 'vat_payer',
};
const CUSTOMER = {
  id: '00000000-0000-4000-8000-000000000003',
  firstName: 'Jan',
  lastName: 'Kowalski',
  email: 'jan@example.com',
};

describe('orderSchema — customFieldValues', () => {
  it('keeps what the reply carries', () => {
    const parsed = orderSchema.parse({ ...ORDER, customFieldValues: { po_number: 'PO-1' } });
    expect(parsed.customFieldValues).toEqual({ po_number: 'PO-1' });
  });

  it('still parses an order that does not carry the key — the addition is not a narrowing', () => {
    expect(orderSchema.parse(ORDER).customFieldValues).toEqual({});
  });
});

describe('adminOrderDetailSchema', () => {
  it('keeps the organization and the customer of the admin detail', () => {
    const parsed = adminOrderDetailSchema.parse({
      ...ORDER,
      organization: ORGANIZATION,
      customer: CUSTOMER,
    });
    expect(parsed.organization).toEqual(ORGANIZATION);
    expect(parsed.customer).toEqual(CUSTOMER);
  });

  it('admits null for a record that can no longer be read', () => {
    const parsed = adminOrderDetailSchema.parse({ ...ORDER, organization: null, customer: null });
    expect(parsed.organization).toBeNull();
    expect(parsed.customer).toBeNull();
  });

  it('is not what the plain order schema describes: orderSchema drops both keys', () => {
    const parsed = orderSchema.parse({ ...ORDER, organization: ORGANIZATION, customer: CUSTOMER });
    expect(parsed).not.toHaveProperty('organization');
    expect(parsed).not.toHaveProperty('customer');
  });
});

describe('admin order preview message codes', () => {
  const PRECEDENCE = [
    'PRODUCT_NOT_FOUND',
    'PRODUCT_NOT_VISIBLE_TO_CUSTOMER',
    'PRODUCT_NOT_IN_SALES_CHANNEL',
    'QUOTE_ONLY',
    // Feature 160 — a line no price book prices (no `defaultPrice` fallback).
    'UNPRICED',
    // Feature 155 — appended last: a line with an earlier code keeps that code.
    'BELOW_MINIMUM_QUANTITY',
  ];

  it('orders the six codes by precedence, first match wins', () => {
    expect([...ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE]).toEqual(PRECEDENCE);
  });

  it('enumerates exactly the precedence, in the same order', () => {
    expect(adminOrderPreviewMessageCodeSchema.options).toEqual(PRECEDENCE);
  });

  it('still parses a message whose code it does not know — the field is not narrowed', () => {
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
      messages: [{ productId: '00000000-0000-4000-8000-000000000007', code: 'SOME_FUTURE_CODE' }],
    };
    expect(adminOrderPreviewResponseSchema.parse(response).messages[0]?.code).toBe(
      'SOME_FUTURE_CODE',
    );
  });

  it('feature 159 — a priced line carries its tax rate; a line without one still parses', () => {
    const line = {
      productId: '00000000-0000-4000-8000-000000000007',
      quantity: 2,
      unitPrice: '10.00',
      currency: 'PLN',
      lineTotal: 20,
    };
    const summary = {
      subtotal: 20,
      taxTotal: 4.6,
      deliveryTotal: 0,
      paymentSurcharge: 0,
      discountTotal: 0,
      total: 24.6,
      currency: 'PLN',
    };
    const parsed = adminOrderPreviewResponseSchema.parse({
      lines: [{ ...line, taxRate: 0.23 }, line],
      summary,
      messages: [],
    });
    expect(parsed.lines.map((l) => l.taxRate)).toEqual([0.23, undefined]);
  });
});

describe('order saved views (FR-003, R-8, S-05, S-06)', () => {
  const VIEW = {
    id: '00000000-0000-4000-8000-000000000010',
    name: 'Unpaid EU',
    shared: true,
    ownerAdminUserId: '00000000-0000-4000-8000-000000000011',
    ownedByCaller: false,
    canModify: false,
    filters: { paymentStatus: 'awaiting_payment' },
    sort: { field: 'placedAt', dir: 'desc' },
    visibleColumns: null,
  };
  const CREATE = {
    name: 'Unpaid EU',
    shared: false,
    filters: {},
    sort: { field: 'placedAt', dir: 'desc' },
  };
  /** `JSON.stringify` of the result is exactly `bytes` UTF-8 bytes; `ł` is 2 bytes. */
  const filtersOfBytes = (bytes: number, fill = 'x', fillBytes = 1) => ({
    k: fill.repeat(Math.floor((bytes - 8) / fillBytes)) + 'x'.repeat((bytes - 8) % fillBytes),
  });

  it('createOrderSavedViewRequestSchema trims the name', () => {
    expect(createOrderSavedViewRequestSchema.parse({ ...CREATE, name: '  a  ' }).name).toBe('a');
  });

  it('createOrderSavedViewRequestSchema rejects a whitespace-only and a 161-character name', () => {
    expect(createOrderSavedViewRequestSchema.safeParse({ ...CREATE, name: '   ' }).success).toBe(
      false,
    );
    expect(
      createOrderSavedViewRequestSchema.safeParse({ ...CREATE, name: 'a'.repeat(161) }).success,
    ).toBe(false);
    expect(
      createOrderSavedViewRequestSchema.safeParse({ ...CREATE, name: 'a'.repeat(160) }).success,
    ).toBe(true);
  });

  it('updateOrderSavedViewRequestSchema trims a supplied name and stays partial', () => {
    expect(updateOrderSavedViewRequestSchema.parse({ name: ' b ' })).toEqual({ name: 'b' });
    expect(updateOrderSavedViewRequestSchema.parse({})).toEqual({});
  });

  it('orderSavedViewSchema requires ownedByCaller and canModify', () => {
    expect(orderSavedViewSchema.parse(VIEW)).toMatchObject({
      ownedByCaller: false,
      canModify: false,
    });
    const { ownedByCaller: _o, ...withoutOwned } = VIEW;
    const { canModify: _c, ...withoutCanModify } = VIEW;
    expect(orderSavedViewSchema.safeParse(withoutOwned).success).toBe(false);
    expect(orderSavedViewSchema.safeParse(withoutCanModify).success).toBe(false);
  });

  it('orderSavedViewSchema still requires a non-null sort', () => {
    const { sort: _s, ...withoutSort } = VIEW;
    expect(orderSavedViewSchema.safeParse(withoutSort).success).toBe(false);
    expect(orderSavedViewSchema.safeParse({ ...VIEW, sort: null }).success).toBe(false);
  });

  for (const [label, schema] of [
    ['createOrderSavedViewRequestSchema', createOrderSavedViewRequestSchema],
    ['updateOrderSavedViewRequestSchema', updateOrderSavedViewRequestSchema],
  ] as const) {
    describe(label, () => {
      it('rejects a name with a control or format character', () => {
        for (const name of ['a\u0000b', 'a‮b', 'a​b']) {
          expect(schema.safeParse({ ...CREATE, name }).success).toBe(false);
        }
        expect(schema.safeParse({ ...CREATE, name: 'Zaległe 🚀' }).success).toBe(true);
      });

      it('bounds filters to 8192 UTF-8 bytes', () => {
        expect(schema.safeParse({ ...CREATE, filters: filtersOfBytes(8192) }).success).toBe(true);
        expect(schema.safeParse({ ...CREATE, filters: filtersOfBytes(8193) }).success).toBe(false);
        expect(schema.safeParse({ ...CREATE, filters: filtersOfBytes(8194, 'ł', 2) }).success).toBe(
          false,
        );
      });

      it('bounds visibleColumns to 64 entries of 64 characters', () => {
        const ok = Array.from({ length: 64 }, (_, i) => `${i}`.padEnd(64, 'c'));
        expect(schema.safeParse({ ...CREATE, visibleColumns: ok }).success).toBe(true);
        expect(schema.safeParse({ ...CREATE, visibleColumns: [...ok, 'extra'] }).success).toBe(
          false,
        );
        expect(schema.safeParse({ ...CREATE, visibleColumns: ['c'.repeat(65)] }).success).toBe(
          false,
        );
      });

      it('bounds sort.field to 64 characters', () => {
        expect(
          schema.safeParse({ ...CREATE, sort: { field: 'f'.repeat(64), dir: 'asc' } }).success,
        ).toBe(true);
        expect(
          schema.safeParse({ ...CREATE, sort: { field: 'f'.repeat(65), dir: 'asc' } }).success,
        ).toBe(false);
      });
    });
  }
});

describe('adminOrdersListQuerySchema customFieldFilters (specs/157-custom-fields-list-filters/)', () => {
  it('parses the JSON parameter to the filter record', () => {
    const parsed = adminOrdersListQuerySchema.parse({
      customFieldFilters: '{"src":{"in":["a","b"]}}',
    });
    expect(parsed.customFieldFilters).toEqual({ src: { in: ['a', 'b'] } });
  });

  it('leaves it undefined when absent', () => {
    expect(adminOrdersListQuerySchema.parse({}).customFieldFilters).toBeUndefined();
  });

  it('locates a malformed bound under the parameter, the key and the operator', () => {
    const result = adminOrdersListQuerySchema.safeParse({
      customFieldFilters: JSON.stringify({ src: { min: 'ten' } }),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ['customFieldFilters', 'src', 'min'],
    ]);
  });

  it('survives the second parse the handlers perform after the route validator', () => {
    const query = {
      customFieldFilters: JSON.stringify({ src: { in: ['a'] }, amount: { min: '-12.5' } }),
      status: ['pending', 'shipped'],
      pageSize: '50',
    };
    const once = adminOrdersListQuerySchema.parse(query);
    expect(adminOrdersListQuerySchema.parse(once)).toEqual(once);
  });
});

// Feature 159 — line groups on orders (`specs/159-quote-request-item-groups/`).
describe('order line groups (T007)', () => {
  const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const CREATE = {
    customerAccountId: ID(3),
    salesChannelId: ID(4),
    deliveryMethodId: ID(5),
    paymentMethodId: ID(6),
    deliveryAddressId: ID(7),
    billingAddressId: ID(7),
  };
  const ITEM = {
    id: ID(20),
    productId: ID(21),
    productSnapshot: { sku: 'B-1', name: 'Bolt', primaryAssetUrl: null },
    variantId: null,
    variantSnapshot: null,
    quantity: 2,
    unitPrice: 10,
    taxRate: 0.23,
    lineTotal: 24.6,
  };
  const paths = (result: { error?: { issues: { path: PropertyKey[] }[] } }) =>
    (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

  it('admin create accepts groups and per-line group keys', () => {
    const parsed = adminCreateOrderRequestSchema.parse({
      ...CREATE,
      groups: [{ key: 'g1', name: ' Hall A ' }],
      items: [
        { productId: ID(30), quantity: 1, groupKey: 'g1' },
        { productId: ID(31), quantity: 1 },
      ],
    });
    expect(parsed.groups).toEqual([{ key: 'g1', name: 'Hall A' }]);
    expect(parsed.items[0]?.groupKey).toBe('g1');
  });

  it('admin create refuses an id on a group, an unknown key, duplicate keys and 51 groups', () => {
    expect(
      adminCreateOrderRequestSchema.safeParse({
        ...CREATE,
        groups: [{ key: 'g1', id: ID(9), name: 'A' }],
        items: [{ productId: ID(30), quantity: 1, groupKey: 'g1' }],
      }).success,
    ).toBe(false);
    expect(
      paths(
        adminCreateOrderRequestSchema.safeParse({
          ...CREATE,
          items: [{ productId: ID(30), quantity: 1, groupKey: 'nope' }],
        }),
      ),
    ).toEqual(['items.0.groupKey']);
    expect(
      paths(
        adminCreateOrderRequestSchema.safeParse({
          ...CREATE,
          groups: [
            { key: 'a', name: 'A' },
            { key: 'a', name: 'B' },
          ],
          items: [{ productId: ID(30), quantity: 1 }],
        }),
      ),
    ).toEqual(['groups.1.key']);
    const many = Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, name: `G${i}` }));
    expect(
      paths(
        adminCreateOrderRequestSchema.safeParse({
          ...CREATE,
          groups: many,
          items: [{ productId: ID(30), quantity: 1 }],
        }),
      ),
    ).toContain('groups');
  });

  it('admin create still applies its address rule', () => {
    const { deliveryAddressId: _omit, ...withoutDelivery } = CREATE;
    expect(
      paths(
        adminCreateOrderRequestSchema.safeParse({
          ...withoutDelivery,
          items: [{ productId: ID(30), quantity: 1 }],
        }),
      ),
    ).toEqual(['deliveryAddressId']);
  });

  it('the admin preview is unchanged: a groupKey is stripped, not refused', () => {
    const parsed = adminOrderPreviewRequestSchema.parse({
      customerAccountId: ID(3),
      salesChannelId: ID(4),
      items: [{ productId: ID(30), quantity: 1, groupKey: 'g1' }],
    });
    expect(parsed.items[0]).not.toHaveProperty('groupKey');
  });

  it('an order item defaults groupId and position; an order defaults itemGroups', () => {
    const item = orderItemSchema.parse(ITEM);
    expect(item.groupId).toBeNull();
    expect(item.position).toBe(0);
    expect(orderItemSchema.parse({ ...ITEM, groupId: ID(40), position: 2 })).toMatchObject({
      groupId: ID(40),
      position: 2,
    });
    expect(orderSchema.parse(ORDER).itemGroups).toEqual([]);
    const groups = [{ id: ID(40), name: 'Hall A', position: 0 }];
    expect(orderSchema.parse({ ...ORDER, itemGroups: groups }).itemGroups).toEqual(groups);
  });
});

describe('feature 162 — the order comment system note', () => {
  const NOTE = {
    kind: 'custom_field_carry_skipped',
    source: {
      entityType: 'quote_request',
      recordId: '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a02',
      reference: 'QR-1042',
    },
    skipped: [{ key: 'order_source', reason: 'value_invalid' }],
  };
  const COMMENT = {
    id: '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a03',
    orderId: '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a04',
    authorAdminUserId: null,
    authorCustomerAccountId: null,
    body: 'Custom field values were not carried.',
    isCustomerVisible: false,
    notifyCustomer: false,
    createdAt: '2026-10-20T10:00:00.000Z',
  };

  it("parses the contract's example", () => {
    expect(orderCommentSystemNoteSchema.parse(NOTE)).toEqual(NOTE);
  });

  it('refuses a note that skipped nothing', () => {
    expect(orderCommentSystemNoteSchema.safeParse({ ...NOTE, skipped: [] }).success).toBe(false);
  });

  it('refuses an unknown reason', () => {
    expect(
      orderCommentSystemNoteSchema.safeParse({ ...NOTE, skipped: [{ key: 'order_source', reason: 'other' }] })
        .success,
    ).toBe(false);
  });

  it('refuses a source of another entity type', () => {
    expect(
      orderCommentSystemNoteSchema.safeParse({ ...NOTE, source: { ...NOTE.source, entityType: 'order' } }).success,
    ).toBe(false);
  });

  it('a comment carries a note, no note, or no key at all', () => {
    expect(orderCommentSchema.parse({ ...COMMENT, systemNote: NOTE }).systemNote).toEqual(NOTE);
    expect(orderCommentSchema.parse({ ...COMMENT, systemNote: null }).systemNote).toBeNull();
    expect(Object.hasOwn(orderCommentSchema.parse(COMMENT), 'systemNote')).toBe(false);
  });
});
