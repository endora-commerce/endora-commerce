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
        countries={[{ code: 'PL', label: 'Poland' }]}
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
      <AddressSection
        deliveryAddresses={[]}
        billingAddresses={[]}
        locale="en-US"
        countries={[{ code: 'PL', label: 'Poland' }]}
      />,
    );
    expect(html).toContain('name="delivery_recipientName"');
    expect(html).toContain('name="delivery_street"');
    expect(html).toContain('name="delivery_country"');
    // No saved picker when there are no saved addresses.
    expect(html).not.toContain('name="deliveryAddressId"');
  });
});

/**
 * Issue #759 (owner ruling of 2026-11-05) — a personal (B2C) Organization is
 * not a company. Its buyer sees an "I need a company invoice" checkbox,
 * unchecked by default, instead of the always-visible company block; checked,
 * it reveals empty company fields validated as at company registration. A
 * company Organization keeps the pre-filled, overridable block.
 */
describe('AddressSection — billing company data (#759)', () => {
  const base = {
    deliveryAddresses: [saved('d1', 'delivery')],
    billingAddresses: [saved('b1', 'billing')],
    locale: 'en-US',
    countries: [{ code: 'PL', label: 'Poland' }],
  };

  it('offers a personal Organization an unchecked company-invoice checkbox and no company fields', () => {
    const html = renderToString(
      <AddressSection
        {...base}
        personalOrganization
        organizationName="Jan Kowalski"
        organizationTaxId="79963f233e3843bd84e144a8fcdd37f8"
      />,
    );
    expect(html).toContain('I need a company invoice');
    expect(html).toMatch(/<input[^>]*name="companyInvoice"[^>]*>/);
    expect(html).not.toMatch(/<input[^>]*name="companyInvoice"[^>]*checked/);
    expect(html).not.toContain('name="billingCompanyName"');
    expect(html).not.toContain('name="billingTaxId"');
    expect(html).not.toContain('79963f233e3843bd84e144a8fcdd37f8');
    expect(html).not.toContain('Jan Kowalski');
  });

  it('reveals empty, required company fields once a personal buyer asks for a company invoice', () => {
    const html = renderToString(
      <AddressSection
        {...base}
        personalOrganization
        initialCompanyInvoice
        organizationName="Jan Kowalski"
        organizationTaxId="79963f233e3843bd84e144a8fcdd37f8"
      />,
    );
    const company = html.match(/<input[^>]*name="billingCompanyName"[^>]*>/)?.[0] ?? '';
    const taxId = html.match(/<input[^>]*name="billingTaxId"[^>]*>/)?.[0] ?? '';
    expect(company).toContain('required');
    expect(company).not.toMatch(/value="[^"]+"/);
    expect(taxId).toContain('required');
    expect(taxId).toContain('minLength="8"');
    expect(taxId).not.toMatch(/value="[^"]+"/);
    expect(html).not.toContain('79963f233e3843bd84e144a8fcdd37f8');
  });

  it('keeps the pre-filled company block, without the checkbox, for a company Organization', () => {
    const html = renderToString(
      <AddressSection {...base} organizationName="Acme Sp. z o.o." organizationTaxId="5260250274" />,
    );
    expect(html).not.toContain('name="companyInvoice"');
    expect(html).toContain('Billing company details');
    expect(html).toMatch(/<input[^>]*name="billingCompanyName"[^>]*value="Acme Sp. z o.o."/);
    expect(html).toMatch(/<input[^>]*name="billingTaxId"[^>]*value="5260250274"/);
  });
});
