import { describe, expect, it } from 'vitest';
import { createCategoryRequestSchema } from './catalog.js';
import { adminCreateOrderRequestSchema } from './orders.js';
import { adminCreateQuoteRequestSchema } from './quote-requests.js';

/**
 * `specs/175-buyer-input-custom-fields/contracts/registration-and-admin-create.md`
 * §5 — the admin creates that dropped custom-field values accept them, and
 * every body they parsed before still parses the same.
 */

const ID = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';

const cases = [
  {
    name: 'createCategoryRequestSchema',
    schema: createCategoryRequestSchema,
    body: { name: { 'en-US': 'Tools' }, slug: 'tools' },
  },
  {
    name: 'adminCreateOrderRequestSchema',
    schema: adminCreateOrderRequestSchema,
    body: {
      customerAccountId: ID,
      salesChannelId: ID,
      items: [{ productId: ID, quantity: 1 }],
      deliveryMethodId: ID,
      paymentMethodId: ID,
      deliveryAddressId: ID,
      billingAddressId: ID,
    },
  },
  {
    name: 'adminCreateQuoteRequestSchema',
    schema: adminCreateQuoteRequestSchema,
    body: {
      organizationId: ID,
      customerAccountId: ID,
      items: [{ productId: ID, quantity: 2, agreedUnitPrice: 10 }],
    },
  },
] as const;

describe.each(cases)('$name — customFieldValues', ({ schema, body }) => {
  it('parses its existing body unchanged', () => {
    const parsed = schema.parse(body) as Record<string, unknown>;
    expect('customFieldValues' in parsed).toBe(false);
  });

  it('accepts optional customFieldValues', () => {
    const parsed = schema.parse({ ...body, customFieldValues: { po_reference: 'PO-1' } }) as Record<
      string,
      unknown
    >;
    expect(parsed['customFieldValues']).toEqual({ po_reference: 'PO-1' });
  });

  it('refuses a value bag that is not an object', () => {
    expect(schema.safeParse({ ...body, customFieldValues: 'PO-1' }).success).toBe(false);
  });
});
