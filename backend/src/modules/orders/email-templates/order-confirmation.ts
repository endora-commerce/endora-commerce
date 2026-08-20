import type {
  EmailMailerSendInput,
  PaymentEmailRendererPort,
  ShippingEmailRendererPort,
} from '@b2b/contracts';
import {
  orderTotalsLabels,
  type OrderTotalsLabels,
} from '@b2b/email-components/render/order-labels';

/**
 * Order-confirmation e-mail (feature 034). Sent after a successful checkout.
 * Contains: the ordered products with amounts, the delivery method + cost, the
 * payment method with any additional payment cost, the applied discounts, the
 * order total summary, and the billing + shipping addresses.
 *
 * Pure builder → `EmailMailerSendInput`.
 *
 * **Feature 075 — the two adapter renderers arrive as ports.** This builder used
 * to import `payments`' and `shipments`' renderer resolvers and call the
 * functions they returned, which is two modules' internals named inside an
 * e-mail template. It now takes the two published renderer contracts; the caller
 * supplies `paymentEmailRendererPort` / `shippingEmailRendererPort` when those
 * modules are effectively present, so a gateway's own wording still reaches the
 * message and this file knows nothing about either module.
 */
export interface OrderConfirmationRenderers {
  /** `payments`' `paymentEmailRendererPort`, or the no-gateway baseline. */
  readonly payment: PaymentEmailRendererPort;
  /** `shipments`' `shippingEmailRendererPort`, or the no-carrier baseline. */
  readonly shipping: ShippingEmailRendererPort;
}

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
  /** Content language (channel default); drives built-in totals/address labels. */
  language?: string;
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

function formatAddress(a: OrderConfirmationAddress, labels: OrderTotalsLabels): string {
  const lines: string[] = [];
  if (a.companyName) lines.push(a.companyName);
  if (a.taxId) lines.push(`${labels.taxId}: ${a.taxId}`);
  lines.push(a.recipientName, a.street, `${a.postalCode} ${a.city}`, a.country);
  if (a.phone) lines.push(`tel. ${a.phone}`);
  return lines.map((l) => `  ${l}`).join('\n');
}

function buildSummaryLines(
  order: BuildOrderConfirmationEmailInput['order'],
  labels: OrderTotalsLabels,
): string[] {
  const currency = order.currency;
  const discountTotal = Number(order.discountTotal);
  const summaryLines = [
    `  ${labels.subtotal}: ${money(order.subtotal, currency)}`,
    `  ${labels.tax}: ${money(order.taxTotal, currency)}`,
    `  ${labels.delivery}: ${money(order.deliveryTotal, currency)}`,
  ];
  if (discountTotal > 0) {
    summaryLines.push(`  ${labels.discount}: -${money(discountTotal, currency)}`);
  }
  summaryLines.push(`  ${labels.total}: ${money(order.total, currency)}`);
  return summaryLines;
}

/**
 * Feature 047 — builds the variable bundle for the admin-editable
 * `order_confirmation` template. Reuses the exact same formatting (money,
 * addresses, payment/shipping renderers) as the legacy builder so the default
 * template renders output equivalent to today's email (SC-003).
 */
export function buildOrderConfirmationVariables(
  input: BuildOrderConfirmationEmailInput & { customerFirstName?: string },
  renderers: OrderConfirmationRenderers,
): Record<string, unknown> {
  const { order, items } = input;
  const currency = order.currency;
  const discountTotal = Number(order.discountTotal);
  const labels = orderTotalsLabels(input.language);

  const paymentLine = renderers.payment.render(order.paymentRendererKey, {
    name: order.paymentMethodSnapshot.name,
    kind: order.paymentMethodSnapshot.kind,
    additionalPrice: Number(order.paymentMethodSnapshot.additionalPrice ?? 0),
    currency,
  });
  const shippingLine = renderers.shipping.render(order.shippingRendererKey ?? null, {
    name: order.deliveryMethodSnapshot.name,
    cost: Number(order.deliveryTotal),
    currency,
  });

  const discountsText =
    discountTotal > 0 || order.promotionCode
      ? `  ${order.promotionCode ? `${order.promotionCode}: ` : ''}-${money(discountTotal, currency)}`
      : `  ${labels.none}`;

  return {
    order: {
      businessId: order.businessId,
      currency,
      shippingLine,
      paymentLine,
      discountsText,
      summaryText: buildSummaryLines(order, labels).join('\n'),
      shippingAddressText: formatAddress(order.deliveryAddress, labels),
      billingAddressText: formatAddress(order.billingAddress, labels),
      items: items.map((it) => ({
        name: it.productSnapshot.name,
        sku: it.productSnapshot.sku,
        quantity: it.quantity,
        unitPrice: money(it.unitPrice, currency),
        lineTotal: money(it.lineTotal, currency),
        /** Alias used by EmailOrderSummary price column. */
        price: money(it.lineTotal, currency),
      })),
    },
    customer: { firstName: input.customerFirstName ?? '' },
  };
}

export function buildOrderConfirmationEmail(
  input: BuildOrderConfirmationEmailInput,
  renderers: OrderConfirmationRenderers,
): EmailMailerSendInput {
  const { order, items } = input;
  const currency = order.currency;
  const discountTotal = Number(order.discountTotal);
  const labels = orderTotalsLabels(input.language);
  const pl = (input.language ?? '').toLowerCase().startsWith('pl');

  const productLines = items.map(
    (it) =>
      `  ${it.quantity} × ${it.productSnapshot.name} (${it.productSnapshot.sku}) — ${money(it.lineTotal, currency)}`,
  );

  const paymentLine = renderers.payment.render(order.paymentRendererKey, {
    name: order.paymentMethodSnapshot.name,
    kind: order.paymentMethodSnapshot.kind,
    additionalPrice: Number(order.paymentMethodSnapshot.additionalPrice ?? 0),
    currency,
  });

  // Feature 035 — render the shipping line through the shipping-email renderer
  // registry (adapter renderer or platform default), mirroring the payment line.
  const shippingLine = renderers.shipping.render(order.shippingRendererKey ?? null, {
    name: order.deliveryMethodSnapshot.name,
    cost: Number(order.deliveryTotal),
    currency,
  });

  const summary = buildSummaryLines(order, labels);

  const discountSection =
    discountTotal > 0 || order.promotionCode
      ? [
          ``,
          pl ? `Zastosowane rabaty:` : `Applied discounts:`,
          `  ${order.promotionCode ? `${order.promotionCode}: ` : ''}-${money(discountTotal, currency)}`,
        ]
      : [``, pl ? `Zastosowane rabaty:` : `Applied discounts:`, `  ${labels.none}`];

  const text = [
    pl ? `Dziękujemy za zamówienie.` : `Thank you for your order.`,
    ``,
    pl ? `Zamówienie: ${order.businessId}` : `Order: ${order.businessId}`,
    ``,
    pl ? `Produkty:` : `Products:`,
    ...productLines,
    ``,
    pl ? `Metoda dostawy: ${shippingLine}` : `Delivery method: ${shippingLine}`,
    pl ? `Metoda płatności: ${paymentLine}` : `Payment method: ${paymentLine}`,
    ...discountSection,
    ``,
    pl ? `Podsumowanie:` : `Summary:`,
    ...summary,
    ``,
    pl ? `Adres dostawy:` : `Shipping address:`,
    formatAddress(order.deliveryAddress, labels),
    ``,
    pl ? `Adres rozliczeniowy:` : `Billing address:`,
    formatAddress(order.billingAddress, labels),
  ].join('\n');

  return {
    messageId: `order_confirmation:${order.id}`,
    to: input.to,
    subject: pl
      ? `Potwierdzenie zamówienia ${order.businessId}`
      : `Order confirmation ${order.businessId}`,
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
