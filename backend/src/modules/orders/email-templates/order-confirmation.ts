import type { MailerSendInput } from '../../email/services/mailer.js';
import { resolvePaymentEmailRenderer } from '../../payments/services/payment-email-renderer.js';
import { resolveShippingEmailRenderer } from '../../shipments/services/shipping-email-renderer.js';

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
  /** Billing snapshot only — company name + tax-id captured at placement. */
  companyName?: string | null;
  taxId?: string | null;
}

export interface BuildOrderConfirmationEmailInput {
  to: string;
  order: {
    id: string;
    /** Feature 036 — customer-facing business Order ID used in the e-mail. */
    businessId: string;
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
    /** Shipping adapter's e-mail renderer key (feature 035), resolved by the caller. */
    shippingRendererKey?: string | null;
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
  const lines: string[] = [];
  if (a.companyName) lines.push(a.companyName);
  if (a.taxId) lines.push(`NIP: ${a.taxId}`);
  lines.push(a.recipientName, a.street, `${a.postalCode} ${a.city}`, a.country);
  if (a.phone) lines.push(`tel. ${a.phone}`);
  return lines.map((l) => `  ${l}`).join('\n');
}

/**
 * Feature 047 — builds the variable bundle for the admin-editable
 * `order_confirmation` template. Reuses the exact same formatting (money,
 * addresses, payment/shipping renderers) as the legacy builder so the default
 * template renders output equivalent to today's email (SC-003).
 */
export function buildOrderConfirmationVariables(
  input: BuildOrderConfirmationEmailInput & { customerFirstName?: string },
): Record<string, unknown> {
  const { order, items } = input;
  const currency = order.currency;
  const discountTotal = Number(order.discountTotal);

  const paymentLine = resolvePaymentEmailRenderer(order.paymentRendererKey)({
    name: order.paymentMethodSnapshot.name,
    kind: order.paymentMethodSnapshot.kind,
    additionalPrice: Number(order.paymentMethodSnapshot.additionalPrice ?? 0),
    currency,
  });
  const shippingLine = resolveShippingEmailRenderer(order.shippingRendererKey ?? null)({
    name: order.deliveryMethodSnapshot.name,
    cost: Number(order.deliveryTotal),
    currency,
  });

  const summaryLines = [
    `  Subtotal: ${money(order.subtotal, currency)}`,
    `  Tax: ${money(order.taxTotal, currency)}`,
    `  Delivery: ${money(order.deliveryTotal, currency)}`,
  ];
  if (discountTotal > 0) summaryLines.push(`  Discount: -${money(discountTotal, currency)}`);
  summaryLines.push(`  Total: ${money(order.total, currency)}`);

  const discountsText =
    discountTotal > 0 || order.promotionCode
      ? `  ${order.promotionCode ? `${order.promotionCode}: ` : ''}-${money(discountTotal, currency)}`
      : `  none`;

  return {
    order: {
      businessId: order.businessId,
      currency,
      shippingLine,
      paymentLine,
      discountsText,
      summaryText: summaryLines.join('\n'),
      shippingAddressText: formatAddress(order.deliveryAddress),
      billingAddressText: formatAddress(order.billingAddress),
      items: items.map((it) => ({
        name: it.productSnapshot.name,
        sku: it.productSnapshot.sku,
        quantity: it.quantity,
        unitPrice: money(it.unitPrice, currency),
        lineTotal: money(it.lineTotal, currency),
      })),
    },
    customer: { firstName: input.customerFirstName ?? '' },
  };
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

  // Feature 035 — render the shipping line through the shipping-email renderer
  // registry (adapter renderer or platform default), mirroring the payment line.
  const shippingLine = resolveShippingEmailRenderer(order.shippingRendererKey ?? null)({
    name: order.deliveryMethodSnapshot.name,
    cost: Number(order.deliveryTotal),
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
    `Order: ${order.businessId}`,
    ``,
    `Products:`,
    ...productLines,
    ``,
    `Delivery method: ${shippingLine}`,
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
    subject: `Order confirmation ${order.businessId}`,
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
