import { describe, expect, it } from 'vitest';
import { buildOrderConfirmationEmail } from '../../../src/modules/orders/email-templates/order-confirmation.js';
import { registerShippingEmailRenderer } from '../../../src/modules/shipments/services/shipping-email-renderer.js';

/**
 * T049 (US6) — the order-confirmation e-mail renders the delivery line through
 * the shipping-email renderer registry (default + custom).
 */
function input(shippingRendererKey: string | null) {
  return {
    to: 'buyer@example.com',
    order: {
      id: 'order-123',
      deliveryMethodSnapshot: { code: 'courier', name: 'Courier', cost: 15 },
      paymentMethodSnapshot: { code: 'bt', name: 'Bank transfer', kind: 'bank_transfer' },
      paymentRendererKey: null,
      shippingRendererKey,
      subtotal: '100.00',
      taxTotal: '23.00',
      discountTotal: '0',
      deliveryTotal: '15.00',
      total: '138.00',
      currency: 'PLN',
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    },
    items: [
      { productSnapshot: { sku: 'SKU1', name: 'Widget' }, quantity: 1, unitPrice: '100.00', lineTotal: '100.00' },
    ],
  };
}

describe('order-confirmation e-mail shipping line', () => {
  it('uses the default shipping renderer when no key is set', () => {
    const msg = buildOrderConfirmationEmail(input(null));
    expect(msg.text).toContain('Delivery method: Courier — 15.00 PLN');
  });

  it('uses a registered custom shipping renderer when its key is set', () => {
    registerShippingEmailRenderer('vendor.courier.email', (ctx) => `★ ${ctx.name} express`);
    const msg = buildOrderConfirmationEmail(input('vendor.courier.email'));
    expect(msg.text).toContain('Delivery method: ★ Courier express');
  });
});
