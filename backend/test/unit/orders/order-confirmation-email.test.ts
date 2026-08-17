import { describe, expect, it } from 'vitest';
import {
  buildOrderConfirmationEmail,
  buildOrderConfirmationVariables,
} from '../../../src/modules/orders/email-templates/order-confirmation.js';
import {
  noCarrierShippingLineRenderer,
  noGatewayPaymentLineRenderer,
} from '../../../src/modules/orders/email-templates/adapter-line-baselines.js';

/**
 * Feature 075 — the builder takes the two renderer contracts instead of
 * importing `payments`' and `shipments`' resolvers. With neither module
 * present these are the baselines the module falls back to, so this suite is
 * also the proof that the degrade renders the same two lines it always did.
 */
const renderers = {
  payment: noGatewayPaymentLineRenderer,
  shipping: noCarrierShippingLineRenderer,
};

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
    const mail = buildOrderConfirmationEmail(input(), renderers);
    expect(mail.to).toBe('buyer@example.com');
    expect(mail.messageId).toBe('order_confirmation:abcdef12-0000-4000-8000-000000000001');

    const body = mail.text;
    expect(body).toContain('2 × Widget (SKU-1) — 98.40 PLN');
    expect(body).toContain('Delivery method: Courier — 12.00 PLN');
    expect(body).toContain('Payment method: Cash on delivery (+5.00 PLN)');
    expect(body).toContain('SAVE10: -10.00 PLN');
    expect(body).toContain('Total: 130.00 PLN');
    expect(body).toContain('Shipping address:');
    expect(body).toContain('Jan Kowalski');
    expect(body).toContain('Billing address:');
    expect(body).toContain('Firma Sp. z o.o.');
  });

  it('identifies the order by its business Order ID (feature 036)', () => {
    const mail = buildOrderConfirmationEmail(input(), renderers);
    expect(mail.subject).toContain('ORD-1042');
    expect(mail.text).toContain('Order: ORD-1042');
    expect(mail.subject).not.toContain('abcdef12');
    expect(mail.text).not.toContain('Order: abcdef12');
  });

  it('shows "none" when there is no discount', () => {
    const i = input();
    i.order.discountTotal = '0.00';
    i.order.promotionCode = null as unknown as string;
    const body = buildOrderConfirmationEmail(i, renderers).text;
    expect(body).toContain('Applied discounts:');
    expect(body).toContain('none');
  });

  it('localizes summary labels for pl-PL', () => {
    const mail = buildOrderConfirmationEmail({ ...input(), language: 'pl-PL' }, renderers);
    expect(mail.subject).toContain('Potwierdzenie zamówienia');
    expect(mail.text).toContain('Suma częściowa: 100.00 PLN');
    expect(mail.text).toContain('VAT: 23.00 PLN');
    expect(mail.text).toContain('Dostawa: 12.00 PLN');
    expect(mail.text).toContain('Razem: 130.00 PLN');
    expect(mail.text).toContain('Podsumowanie:');
  });
});

describe('buildOrderConfirmationVariables', () => {
  it('uses English totals labels by default', () => {
    const vars = buildOrderConfirmationVariables(input(), renderers);
    const order = vars['order'] as { summaryText: string };
    expect(order.summaryText).toContain('Subtotal:');
    expect(order.summaryText).toContain('Tax:');
  });

  it('uses Polish totals labels for pl-PL', () => {
    const vars = buildOrderConfirmationVariables({ ...input(), language: 'pl-PL' }, renderers);
    const order = vars['order'] as { summaryText: string };
    expect(order.summaryText).toContain('Suma częściowa:');
    expect(order.summaryText).toContain('VAT:');
    expect(order.summaryText).toContain('Razem:');
    expect(order.summaryText).not.toContain('Subtotal:');
  });
});
