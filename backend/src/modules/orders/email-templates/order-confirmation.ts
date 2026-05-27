import type { MailerSendInput } from '../../email/services/mailer.js';
import { resolvePaymentEmailRenderer } from '../../payments/services/payment-email-renderer.js';

/**
 * Order-confirmation e-mail (feature 034). Sent after a successful checkout.
 * Contains: the ordered products with amounts, the delivery method + cost, the
 * payment method with any additional payment cost, the applied discounts, the
 * order total summary, and the billing + shipping addresses.
 *
 * Pure builder → MailerSendInput; the payment section is rendered through the
 * payment-email renderer registry (adapter renderer or platform default).
 */
export interface OrderConfirmationAddress {
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string | null;
}

export interface BuildOrderConfirmationEmailInput {
  to: string;
  order: {
    id: string;
    deliveryMethodSnapshot: { code: string; name: string; cost: number };
    paymentMethodSnapshot: {
      code: string;
      name: string;
      kind: string;
      adapter?: string;
      additionalPrice?: number;
    };
    /** Adapter's e-mail renderer key (adapter.renderers.email), resolved by the caller. */
    paymentRendererKey: string | null;
    subtotal: string;
    taxTotal: string;
    discountTotal: string;
    deliveryTotal: string;
    total: string;
    currency: string;
    promotionCode?: string | null;
    deliveryAddress: OrderConfirmationAddress;
    billingAddress: OrderConfirmationAddress;
  };
  items: Array<{
    productSnapshot: { sku: string; name: string };
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }>;
}

function money(value: string | number, currency: string): string {
  return `${Number(value).toFixed(2)} ${currency}`;
}

function formatAddress(a: OrderConfirmationAddress): string {
  const lines = [a.recipientName, a.street, `${a.postalCode} ${a.city}`, a.country];
  if (a.phone) lines.push(`tel. ${a.phone}`);
  return lines.map((l) => `  ${l}`).join('\n');
}

export function buildOrderConfirmationEmail(
  input: BuildOrderConfirmationEmailInput,
): MailerSendInput {
  const { order, items } = input;
  const currency = order.currency;
  const discountTotal = Number(order.discountTotal);

  const productLines = items.map(
    (it) =>
      `  ${it.quantity} × ${it.productSnapshot.name} (${it.productSnapshot.sku}) — ${money(it.lineTotal, currency)}`,
  );

  const paymentLine = resolvePaymentEmailRenderer(order.paymentRendererKey)({
    name: order.paymentMethodSnapshot.name,
    kind: order.paymentMethodSnapshot.kind,
    additionalPrice: Number(order.paymentMethodSnapshot.additionalPrice ?? 0),
    currency,
  });

  const summary = [
    `  Subtotal: ${money(order.subtotal, currency)}`,
    `  Tax: ${money(order.taxTotal, currency)}`,
    `  Delivery: ${money(order.deliveryTotal, currency)}`,
  ];
  if (discountTotal > 0) summary.push(`  Discount: -${money(discountTotal, currency)}`);
  summary.push(`  Total: ${money(order.total, currency)}`);

  const discountSection =
    discountTotal > 0 || order.promotionCode
      ? [
          ``,
          `Applied discounts:`,
          `  ${order.promotionCode ? `${order.promotionCode}: ` : ''}-${money(discountTotal, currency)}`,
        ]
      : [``, `Applied discounts:`, `  none`];

  const text = [
    `Thank you for your order.`,
    ``,
    `Order: ${order.id}`,
    ``,
    `Products:`,
    ...productLines,
    ``,
    `Delivery method: ${order.deliveryMethodSnapshot.name} — ${money(order.deliveryTotal, currency)}`,
    `Payment method: ${paymentLine}`,
    ...discountSection,
    ``,
    `Summary:`,
    ...summary,
    ``,
    `Shipping address:`,
    formatAddress(order.deliveryAddress),
    ``,
    `Billing address:`,
    formatAddress(order.billingAddress),
  ].join('\n');

  return {
    messageId: `order_confirmation:${order.id}`,
    to: input.to,
    subject: `Order confirmation ${order.id.slice(0, 8)}`,
    text,
    meta: {
      kind: 'order_confirmation',
      orderId: order.id,
      total: Number(order.total),
      currency,
      paymentMethod: order.paymentMethodSnapshot.code,
      deliveryMethod: order.deliveryMethodSnapshot.code,
    },
  };
}
