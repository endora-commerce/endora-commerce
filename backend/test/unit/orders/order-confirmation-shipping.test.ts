import { describe, expect, it } from 'vitest';
import type { PaymentEmailRendererPort, ShippingEmailRendererPort } from '@endora-commerce/contracts';
import { buildOrderConfirmationEmail } from '../../../src/modules/orders/email-templates/order-confirmation.js';
import {
  noCarrierShippingLineRenderer,
  noGatewayPaymentLineRenderer,
} from '../../../src/modules/orders/email-templates/adapter-line-baselines.js';
import {
  registerShippingEmailRenderer,
  resolveShippingEmailRenderer,
} from '../../../src/modules/shipments/services/shipping-email-renderer.js';

/**
 * T049 (US6) — the order-confirmation e-mail renders the delivery line through
 * the shipping-email renderer registry (default + custom).
 *
 * Feature 075 — the builder no longer imports `shipments`' resolver; it takes
 * `ShippingEmailRendererPort`. This suite builds the same port `shipments`
 * registers, so the subject is unchanged, and adds the third case the cut
 * introduced: what the line says when `shipments` is not present at all.
 */
const shippingPort: ShippingEmailRendererPort = {
  render: (rendererKey, ctx) => resolveShippingEmailRenderer(rendererKey)(ctx),
};
const paymentPort: PaymentEmailRendererPort = noGatewayPaymentLineRenderer;

function input(shippingRendererKey: string | null) {
  return {
    to: 'buyer@example.com',
    order: {
      id: 'order-123',
      businessId: 'ORD-123',
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
    const msg = buildOrderConfirmationEmail(input(null), {
      payment: paymentPort,
      shipping: shippingPort,
    });
    expect(msg.text).toContain('Delivery method: Courier — 15.00 PLN');
  });

  it('uses a registered custom shipping renderer when its key is set', () => {
    registerShippingEmailRenderer('vendor.courier.email', (ctx) => `★ ${ctx.name} express`);
    const msg = buildOrderConfirmationEmail(input('vendor.courier.email'), {
      payment: paymentPort,
      shipping: shippingPort,
    });
    expect(msg.text).toContain('Delivery method: ★ Courier express');
  });

  it('renders the line from the snapshot when `shipments` is absent, key or no key', () => {
    // The declared `degrades-without` behaviour: the confirmation still goes
    // out and the delivery line is written from the method snapshot, with a
    // carrier's custom wording no longer reachable.
    const msg = buildOrderConfirmationEmail(input('vendor.courier.email'), {
      payment: paymentPort,
      shipping: noCarrierShippingLineRenderer,
    });
    expect(msg.text).toContain('Delivery method: Courier — 15.00 PLN');
    expect(msg.text).not.toContain('★');
  });
});
