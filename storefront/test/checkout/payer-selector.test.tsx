import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CheckoutPayer } from '@endora-commerce/contracts';
import { AddressSection } from '../../components/checkout/AddressSection';
import { CheckoutPayerScope, PayerSelector } from '../../components/checkout/CheckoutPayer';
import type { AddressSummary } from '../../lib/api/organization';

/**
 * `specs/182-related-payers/` T029 (FR-060, FR-061, SC-007) — the checkout's *Paid by*
 * choice. Shown only when the buyer has usable payers; with a payer chosen the billing
 * address is one of the payer's and the company name and tax ID are the payer's,
 * read-only and never submitted as an override; without one, checkout is unchanged.
 */
const saved = (id: string, kind: 'delivery' | 'billing'): AddressSummary => ({
  id,
  organizationId: 'org-x',
  kind,
  recipientName: 'Buyer X',
  street: 'ul. Kupującego 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'PL',
  phone: null,
  isDefault: true,
});

const PAYER: CheckoutPayer = {
  payerOrganizationId: '00000000-0000-4000-8000-0000000000b2',
  name: 'Payer SA',
  taxId: 'PL1234567890',
  commercialTerms: 'buyer',
  billingAddresses: [
    { id: 'pa1', recipientName: 'Payer SA', street: 'ul. Płatnika 9', city: 'Kraków', postalCode: '30-001', country: 'PL', phone: null },
  ],
  paymentMethodIds: null,
  creditAvailable: null,
};

function section(payers: CheckoutPayer[], initialPayerId: string | null = null): string {
  return renderToString(
    <CheckoutPayerScope payers={payers} initialPayerId={initialPayerId}>
      <PayerSelector locale="en-US" organizationName="Buyer X" />
      <AddressSection
        deliveryAddresses={[saved('d1', 'delivery')]}
        billingAddresses={[saved('b1', 'billing')]}
        locale="en-US"
        countries={[{ code: 'PL', label: 'Poland' }]}
        organizationName="Buyer X"
        organizationTaxId="PL0000000001"
      />
    </CheckoutPayerScope>,
  );
}

describe('checkout payer selector (FR-060, FR-061)', () => {
  it('without usable payers there is no selector and the billing override is unchanged (SC-007)', () => {
    const html = section([]);
    expect(html).not.toContain('name="payerOrganizationId"');
    expect(html).toContain('name="billingCompanyName"');
    expect(html).toContain('name="billingTaxId"');
  });

  it('with payers the selector offers the buyer itself and each payer', () => {
    const html = section([PAYER]);
    expect(html).toContain('name="payerOrganizationId"');
    expect(html).toContain('Paid by');
    expect(html).toContain('Payer SA');
    expect(html).toContain('Buyer X');
    // The buyer itself is the default: checkout is unchanged until a payer is chosen.
    expect(html).toContain('name="billingCompanyName"');
  });

  it('choosing the payer lists only its billing addresses and shows its company data read-only', () => {
    const html = section([PAYER], PAYER.payerOrganizationId);
    expect(html).toContain('name="payerBillingAddressId"');
    expect(html).toContain('ul. Płatnika 9');
    // Not the buyer's own billing picker, and no "same as shipping".
    expect(html).not.toContain('name="billingAddressId"');
    expect(html).not.toContain('name="billingSameAsShipping"');
    // The company data is the payer's, read-only, and not submitted as an override.
    expect(html).not.toContain('name="billingCompanyName"');
    expect(html).not.toContain('name="billingTaxId"');
    expect(html).toMatch(/value="Payer SA"[^>]*readonly|readonly[^>]*value="Payer SA"/i);
    expect(html).toMatch(/value="PL1234567890"[^>]*readonly|readonly[^>]*value="PL1234567890"/i);
  });

  it('the buyer\'s shipping address stays the buyer\'s with a payer (FR-066)', () => {
    const html = section([PAYER], PAYER.payerOrganizationId);
    expect(html).toContain('name="deliveryAddressId"');
    expect(html).toContain('ul. Kupującego 1');
  });

  it('a personal buyer without payers keeps the company-invoice opt-in (SC-007)', () => {
    const html = renderToString(
      <CheckoutPayerScope payers={[]} initialPayerId={null}>
        <AddressSection
          deliveryAddresses={[saved('d1', 'delivery')]}
          billingAddresses={[]}
          locale="en-US"
          countries={[]}
          personalOrganization
        />
      </CheckoutPayerScope>,
    );
    expect(html).toContain('name="companyInvoice"');
  });
});
