import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PaymentMethods } from '../../components/checkout/PaymentMethods';
import {
  registerPaymentMethodRenderer,
  resolvePaymentMethodRenderer,
  DefaultPaymentMethodRenderer,
} from '../../lib/payment-renderers/registry';
import type { PaymentMethodSummary } from '../../lib/api/methods';

const method = (over: Partial<PaymentMethodSummary> = {}): PaymentMethodSummary => ({
  id: 'pm-1',
  code: 'bank_transfer',
  name: { default: 'Bank transfer' },
  kind: 'bank_transfer',
  status: 'active',
  adapter: 'bank_transfer',
  additionalPrice: 0,
  rendererKey: null,
  ...over,
});

describe('payment-method renderer registry', () => {
  it('falls back to the default renderer for an unknown / null key', () => {
    expect(resolvePaymentMethodRenderer(null)).toBe(DefaultPaymentMethodRenderer);
    expect(resolvePaymentMethodRenderer('nope')).toBe(DefaultPaymentMethodRenderer);
  });

  it('returns a registered custom renderer for its key', () => {
    const custom = (): null => null;
    registerPaymentMethodRenderer('custom.key', custom);
    expect(resolvePaymentMethodRenderer('custom.key')).toBe(custom);
  });
});

describe('PaymentMethods section (SSR)', () => {
  it('renders a radio per method with the default renderer + surcharge', () => {
    const html = renderToString(
      <PaymentMethods methods={[method({ additionalPrice: 5 })]} currency="PLN" />,
    );
    expect(html).toContain('name="paymentMethodId"');
    expect(html).toContain('Bank transfer');
    expect(html).toContain('+5.00 PLN');
  });

  it('shows the empty state when no method is eligible', () => {
    const html = renderToString(<PaymentMethods methods={[]} />);
    expect(html).toContain('No payment method is available');
  });

  /**
   * The Apple Pay rule is a *suffix* rule, not a list of two vendor codes.
   * `specs/134-paid-module-extraction/` T041, ruling O-1(b) — every gateway
   * that seeds an Apple Pay method is a fragment the shop copies in, so a rule
   * enumerating the gateways this repository used to carry would silently stop
   * hiding the option for the shop that copied one in under any other id.
   */
  it('omits an Apple Pay method on SSR / unsupported clients, whoever seeded it', () => {
    const html = renderToString(
      <PaymentMethods
        methods={[
          method({ id: 'pm-bank', code: 'bank_transfer', name: { default: 'Bank transfer' } }),
          method({
            id: 'pm-apple',
            code: 'acme_apple_pay',
            name: { default: 'Apple Pay' },
            kind: 'gateway',
            adapter: 'acme',
          }),
        ]}
      />,
    );
    expect(html).toContain('Bank transfer');
    expect(html).not.toContain('Apple Pay');
  });
});

/**
 * `specs/134-paid-module-extraction/` T041, ruling O-1(b) — the five gateways'
 * checkout UI leaves this repository as paid fragments, so `registry.tsx`
 * registers no gateway at all. This is the payment half of what
 * `test/checkout/shipping-methods.test.tsx` pins for the carriers: a shop that
 * has copied no fragment in still renders every gateway method, through the
 * default row, which is feature 034's FR-017 fallback doing the job it was
 * written for rather than a degradation.
 */
describe('a gateway fragment nobody copied in', () => {
  const REDIRECT_KEYS = [
    'stripe_redirect',
    'tpay_redirect',
    'payu_redirect',
    'autopay_redirect',
    'paypal_redirect',
  ];

  it('falls back to the default renderer for every gateway renderer key', () => {
    for (const key of REDIRECT_KEYS) {
      expect(resolvePaymentMethodRenderer(key), key).toBe(DefaultPaymentMethodRenderer);
    }
  });

  it('still renders the gateway method, with its name and surcharge', () => {
    const html = renderToString(
      <PaymentMethods
        methods={[
          method({
            id: 'pm-gw',
            code: 'acme_blik',
            name: { default: 'BLIK' },
            kind: 'gateway',
            adapter: 'acme',
            rendererKey: 'acme_redirect',
            additionalPrice: 2,
          }),
        ]}
        currency="PLN"
      />,
    );
    expect(html).toContain('BLIK');
    expect(html).toContain('value="pm-gw"');
    expect(html).toContain('+2.00 PLN');
  });

  /**
   * The icons are keyed on the method-code *suffix* for the same reason the
   * Apple Pay filter is: `<vendor>_blik` is BLIK whoever the vendor is, and a
   * fragment copied in under its own adapter id keeps its badge.
   */
  it('gives a copied-in fragment the badge its method kind earns', () => {
    const marks = (code: string): string =>
      renderToString(
        <PaymentMethods
          methods={[method({ id: 'pm-x', code, name: { default: 'Pay' }, kind: 'gateway' })]}
        />,
      );
    expect(marks('acme_blik')).toContain('blik-logo.svg');
    expect(marks('acme_google_pay')).toContain('#4285F4');
  });
});
