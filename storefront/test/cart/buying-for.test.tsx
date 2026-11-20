import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CheckoutPayer } from '@endora-commerce/contracts';
import { CartBuyingFor, CartBuyingForNotice } from '../../components/CartBuyingFor';
import { CheckoutPayerScope, PayerSelector } from '../../components/checkout/CheckoutPayer';

/**
 * `specs/182-related-payers/` T058 (FR-110, FR-113, FR-116, FR-060) — *Buying for* on the cart:
 * offered only with a payer to choose; what a switch changed; why a cart left the payer's
 * context; and the checkout showing the payer fixed for a cart bought on the payer's terms.
 */
const PAYER: CheckoutPayer = {
  payerOrganizationId: '00000000-0000-4000-8000-0000000000b2',
  name: 'Payer SA',
  taxId: 'PL1234567890',
  commercialTerms: 'payer',
  billingAddresses: [{ id: 'pa1', recipientName: 'Payer SA', street: 'ul. Płatnika 9', city: 'Kraków', postalCode: '30-001', country: 'PL', phone: null }],
  paymentMethodIds: null,
  creditAvailable: null,
};
const action = async (): Promise<void> => undefined;

describe('CartBuyingFor (FR-110)', () => {
  it('renders nothing without a payer to choose', () => {
    expect(renderToString(<CartBuyingFor payers={[]} current={null} organizationName="Buyer X" action={action} locale="en-US" />)).toBe('');
  });

  it('offers the buyer itself and each payer, the current one selected', () => {
    const html = renderToString(
      <CartBuyingFor payers={[PAYER]} current={PAYER.payerOrganizationId} organizationName="Buyer X" action={action} locale="en-US" />,
    );
    expect(html).toContain('Paid by');
    expect(html).toContain('Buyer X');
    expect(html).toContain('Payer SA');
    expect(html).toMatch(new RegExp(`value="${PAYER.payerOrganizationId}"[^>]*selected|selected[^>]*value="${PAYER.payerOrganizationId}"`));
  });
});

describe('CartBuyingFor — payers on their own terms only (FR-110, RP-22)', () => {
  const ON_BUYER_TERMS: CheckoutPayer = {
    ...PAYER,
    payerOrganizationId: '00000000-0000-4000-8000-0000000000c3',
    name: 'Buyer Terms SA',
    commercialTerms: 'buyer',
  };

  it('renders nothing when every payer is on the buyer\'s terms (chosen at checkout)', () => {
    expect(
      renderToString(<CartBuyingFor payers={[ON_BUYER_TERMS]} current={null} organizationName="Buyer X" action={action} locale="en-US" />),
    ).toBe('');
  });

  it('lists only the payers on their own terms', () => {
    const html = renderToString(
      <CartBuyingFor payers={[PAYER, ON_BUYER_TERMS]} current={null} organizationName="Buyer X" action={action} locale="en-US" />,
    );
    expect(html).toContain('Payer SA');
    expect(html).not.toContain('Buyer Terms SA');
  });

  it('is labelled "Płaci" in Polish', () => {
    const html = renderToString(<CartBuyingFor payers={[PAYER]} current={null} organizationName="Buyer X" action={action} locale="pl-PL" />);
    expect(html).toContain('Płaci');
    expect(html).not.toContain('Kupujesz dla');
  });
});

describe('CartBuyingForNotice (FR-113, FR-116)', () => {
  it('says what a switch changed', () => {
    const html = renderToString(<CartBuyingForNotice repriced={2} unpriced={1} reset={null} locale="en-US" />);
    expect(html).toContain('2');
    expect(html).toContain('1');
    expect(html).toContain('role="status"');
  });

  it('says why the cart returned to the buyer\'s own prices', () => {
    const html = renderToString(<CartBuyingForNotice repriced={null} unpriced={null} reset="terms_changed" locale="en-US" />);
    expect(html).toContain('own prices');
  });

  it('renders nothing with nothing to say', () => {
    expect(renderToString(<CartBuyingForNotice repriced={null} unpriced={null} reset={null} locale="en-US" />)).toBe('');
  });
});

describe('checkout — the payer fixed by the cart (FR-060)', () => {
  it('shows the payer as fixed, with no choice', () => {
    const html = renderToString(
      <CheckoutPayerScope payers={[PAYER]} initialPayerId={PAYER.payerOrganizationId} fixed>
        <PayerSelector locale="en-US" organizationName="Buyer X" />
      </CheckoutPayerScope>,
    );
    expect(html).toContain('Payer SA');
    expect(html).not.toContain('<select');
    expect(html).toContain(`name="payerOrganizationId" value="${PAYER.payerOrganizationId}"`);
  });
});
