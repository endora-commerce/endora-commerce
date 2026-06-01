import { describe, expect, it } from 'vitest';
import { buildOrderConfirmationEmail } from '../../../src/modules/orders/email-templates/order-confirmation.js';

/**
 * Order-confirmation e-mail builder — covers every section required by the
 * spec: products + amounts, delivery method + cost, payment method + surcharge,
 * applied discounts, total summary, and both addresses.
 */
const input = () => ({
  to: 'buyer@example.com',
  order: {
    id: 'abcdef12-0000-4000-8000-000000000001',
    businessId: 'ORD-1042',
    deliveryMethodSnapshot: { code: 'courier', name: 'Courier', cost: 12 },
    paymentMethodSnapshot: {
      code: 'cod',
      name: 'Cash on delivery',
      kind: 'pickup',
      adapter: 'pickup',
      additionalPrice: 5,
    },
    paymentRendererKey: null,
    subtotal: '100.00',
    taxTotal: '23.00',
    discountTotal: '10.00',
    deliveryTotal: '12.00',
    total: '130.00',
    currency: 'PLN',
    promotionCode: 'SAVE10',
    deliveryAddress: {
      recipientName: 'Jan Kowalski',
      street: 'ul. Wysyłkowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
    billingAddress: {
      recipientName: 'Firma Sp. z o.o.',
      street: 'ul. Rozliczeniowa 2',
      city: 'Kraków',
      postalCode: '30-002',
      country: 'PL',
    },
  },
  items: [
    {
      productSnapshot: { sku: 'SKU-1', name: 'Widget' },
      quantity: 2,
      unitPrice: '40.00',
      lineTotal: '98.40',
    },
  ],
});

describe('buildOrderConfirmationEmail', () => {
  it('renders all required sections', () => {
    const mail = buildOrderConfirmationEmail(input());
    expect(mail.to).toBe('buyer@example.com');
    expect(mail.messageId).toBe('order_confirmation:abcdef12-0000-4000-8000-000000000001');

    const body = mail.text;
    // products + amounts
    expect(body).toContain('2 × Widget (SKU-1) — 98.40 PLN');
    // delivery method + cost
    expect(body).toContain('Delivery method: Courier — 12.00 PLN');
    // payment method + additional cost (default renderer)
    expect(body).toContain('Payment method: Cash on delivery (+5.00 PLN)');
    // applied discounts
    expect(body).toContain('SAVE10: -10.00 PLN');
    // total summary
    expect(body).toContain('Total: 130.00 PLN');
    // both addresses
    expect(body).toContain('Shipping address:');
    expect(body).toContain('Jan Kowalski');
    expect(body).toContain('Billing address:');
    expect(body).toContain('Firma Sp. z o.o.');
  });

  it('identifies the order by its business Order ID (feature 036)', () => {
    const mail = buildOrderConfirmationEmail(input());
    // Subject + body reference the customer-facing business ID, not the UUID.
    expect(mail.subject).toContain('ORD-1042');
    expect(mail.text).toContain('Order: ORD-1042');
    expect(mail.subject).not.toContain('abcdef12');
    expect(mail.text).not.toContain('Order: abcdef12');
  });

  it('shows "none" when there is no discount', () => {
    const i = input();
    i.order.discountTotal = '0.00';
    i.order.promotionCode = null as unknown as string;
    const body = buildOrderConfirmationEmail(i).text;
    expect(body).toContain('Applied discounts:');
    expect(body).toContain('none');
  });
});
