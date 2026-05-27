import { describe, expect, it } from 'vitest';
import {
  defaultPaymentEmailRenderer,
  registerPaymentEmailRenderer,
  resolvePaymentEmailRenderer,
} from '../../../src/modules/payments/services/payment-email-renderer.js';

/**
 * T049 (US6) — email payment-renderer registry + default text builder.
 */
describe('payment email renderer registry', () => {
  it('default renderer shows the name, and a surcharge only when > 0', () => {
    expect(
      defaultPaymentEmailRenderer({ name: 'Cash on delivery', kind: 'pickup', additionalPrice: 5, currency: 'PLN' }),
    ).toBe('Cash on delivery (+5.00 PLN)');
    expect(
      defaultPaymentEmailRenderer({ name: 'Bank transfer', kind: 'bank_transfer', additionalPrice: 0, currency: 'PLN' }),
    ).toBe('Bank transfer');
  });

  it('falls back to default for unknown/null key and uses a registered renderer', () => {
    expect(resolvePaymentEmailRenderer(null)).toBe(defaultPaymentEmailRenderer);
    expect(resolvePaymentEmailRenderer('nope')).toBe(defaultPaymentEmailRenderer);
    const custom = (): string => 'CUSTOM';
    registerPaymentEmailRenderer('vendor.email', custom);
    expect(resolvePaymentEmailRenderer('vendor.email')).toBe(custom);
  });
});
