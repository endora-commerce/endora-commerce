import { describe, expect, it } from 'vitest';
import { resolvePreferenceFields, type PreferenceRow } from './default-preference-resolver.js';

const orgRow: PreferenceRow = {
  defaultPaymentMethodId: 'pay-org',
  defaultDeliveryMethodId: 'del-org',
  defaultBillingAddressId: 'bill-org',
  defaultShippingAddressId: 'ship-org',
};

describe('resolvePreferenceFields', () => {
  it('falls back to the organization row when the customer has none', () => {
    const r = resolvePreferenceFields(null, orgRow);
    expect(r.payment).toEqual({ id: 'pay-org', source: 'organization' });
    expect(r.shipping).toEqual({ id: 'ship-org', source: 'organization' });
  });

  it('lets a customer value override the organization per field', () => {
    const customerRow: PreferenceRow = {
      defaultPaymentMethodId: null,
      defaultDeliveryMethodId: 'del-cust',
      defaultBillingAddressId: null,
      defaultShippingAddressId: null,
    };
    const r = resolvePreferenceFields(customerRow, orgRow);
    expect(r.delivery).toEqual({ id: 'del-cust', source: 'customer' });
    // Other fields fall back to the org.
    expect(r.payment).toEqual({ id: 'pay-org', source: 'organization' });
    expect(r.billing).toEqual({ id: 'bill-org', source: 'organization' });
  });

  it('returns null with null source when neither tier sets a field', () => {
    const r = resolvePreferenceFields(null, null);
    expect(r.payment).toEqual({ id: null, source: null });
    expect(r.delivery).toEqual({ id: null, source: null });
    expect(r.billing).toEqual({ id: null, source: null });
    expect(r.shipping).toEqual({ id: null, source: null });
  });
});
