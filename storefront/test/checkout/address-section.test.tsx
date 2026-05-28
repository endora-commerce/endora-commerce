import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AddressSection } from '../../components/checkout/AddressSection';
import type { AddressSummary } from '../../lib/api/organization';

/**
 * Feature 036 (US2) — the checkout address section renders a saved-address
 * picker when the org has addresses, falls back to new-address inputs when it
 * doesn't, and defaults billing to "same as shipping" (billing inputs hidden).
 * (Interactive toggling is plain client state; these SSR assertions lock the
 * field-name contract the checkout server action depends on.)
 */
const saved = (id: string, kind: 'delivery' | 'billing'): AddressSummary => ({
  id,
  organizationId: 'org-1',
  kind,
  recipientName: 'Acme Sp. z o.o.',
  street: 'ul. Testowa 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'PL',
  phone: null,
  isDefault: true,
});

describe('AddressSection', () => {
  it('defaults to the saved shipping picker and hides billing (same as shipping)', () => {
    const html = renderToString(
      <AddressSection
        deliveryAddresses={[saved('d1', 'delivery')]}
        billingAddresses={[saved('b1', 'billing')]}
        locale="en-US"
      />,
    );
    expect(html).toContain('name="deliveryAddressId"');
    expect(html).toContain('Billing address same as shipping');
    // Same-as-shipping defaults on → billing picker not rendered.
    expect(html).not.toContain('name="billingAddressId"');
    // Saved mode → no new-address inputs.
    expect(html).not.toContain('name="delivery_street"');
  });

  it('renders required new-address inputs when the org has no saved addresses', () => {
    const html = renderToString(
      <AddressSection deliveryAddresses={[]} billingAddresses={[]} locale="en-US" />,
    );
    expect(html).toContain('name="delivery_recipientName"');
    expect(html).toContain('name="delivery_street"');
    expect(html).toContain('name="delivery_country"');
    // No saved picker when there are no saved addresses.
    expect(html).not.toContain('name="deliveryAddressId"');
  });
});
