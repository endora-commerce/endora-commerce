import { describe, expect, it } from 'vitest';
import { adminOrderDetailSchema, orderSchema } from './orders.js';

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
