import { describe, expect, it } from 'vitest';
import {
  defaultShippingEmailRenderer,
  registerShippingEmailRenderer,
  resolveShippingEmailRenderer,
} from '../../../src/modules/shipments/services/shipping-email-renderer.js';

/**
 * T047 (US6) — email shipping-renderer registry + default text builder.
 */
describe('shipping email renderer registry', () => {
  it('default renderer shows the name and the cost', () => {
    expect(defaultShippingEmailRenderer({ name: 'Courier', cost: 15, currency: 'PLN' })).toBe(
      'Courier — 15.00 PLN',
    );
  });

  it('falls back to default for unknown/null key and uses a registered renderer', () => {
    expect(resolveShippingEmailRenderer(null)).toBe(defaultShippingEmailRenderer);
    expect(resolveShippingEmailRenderer('nope')).toBe(defaultShippingEmailRenderer);
    const custom = (): string => 'CUSTOM SHIPPING';
    registerShippingEmailRenderer('vendor.shipping.email', custom);
    expect(resolveShippingEmailRenderer('vendor.shipping.email')).toBe(custom);
  });
});
