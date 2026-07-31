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

  it('omits Apple Pay on SSR / unsupported clients', () => {
    const html = renderToString(
      <PaymentMethods
        methods={[
          method({ id: 'pm-bank', code: 'bank_transfer', name: { default: 'Bank transfer' } }),
          method({
            id: 'pm-apple',
            code: 'payu_apple_pay',
            name: { default: 'Apple Pay' },
            kind: 'gateway',
            adapter: 'payu',
          }),
        ]}
      />,
    );
    expect(html).toContain('Bank transfer');
    expect(html).not.toContain('Apple Pay');
  });
});
