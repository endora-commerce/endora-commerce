import { supportedLanguageOf, unitPriceDisplayText } from '@endora-commerce/contracts';
import type {
  EmailMailerSendInput,
  PaymentEmailRendererPort,
  ShippingEmailRendererPort,
} from '@endora-commerce/contracts';
import {
  orderTotalsLabels,
  type OrderTotalsLabels,
} from '@endora-commerce/email-components/render/order-labels';
import {
  fillPlaceholders,
  ORDERS_PROSE_EN,
  ordersProseTable,
  type OrdersProseKey,
  type OrdersTranslate,
} from '../orders-prose.js';

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

/** A unit price: its significant places, up to four (owner ruling of 2026-10-25). */
function unitMoney(value: string | number, currency: string): string {
  return `${unitPriceDisplayText(value)} ${currency}`;
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
        unitPrice: unitMoney(it.unitPrice, currency),
        lineTotal: money(it.lineTotal, currency),
        /** Alias used by EmailOrderSummary price column. */
        price: money(it.lineTotal, currency),
      })),
    },
    customer: { firstName: input.customerFirstName ?? '' },
  };
}

const ORDER_CONFIRMATION_KEYS = (Object.keys(ORDERS_PROSE_EN) as OrdersProseKey[]).filter(
  (key): key is Extract<OrdersProseKey, `email.orderConfirmation.${string}`> =>
    key.startsWith('email.orderConfirmation.'),
);

/** The sentences of the in-code order confirmation, as templates in one language. */
export type OrderConfirmationProse = Readonly<
  Record<(typeof ORDER_CONFIRMATION_KEYS)[number], string>
>;

/** The sentences in English — what the builder writes when it is handed none. */
export const ORDER_CONFIRMATION_PROSE_EN: OrderConfirmationProse = Object.fromEntries(
  ORDER_CONFIRMATION_KEYS.map((key) => [key, ORDERS_PROSE_EN[key]]),
) as OrderConfirmationProse;

/**
 * The sentences in `language` — the order's content language, a BCP-47 tag —
 * from this module's bundle, English where it cannot answer (issue #95).
 */
export function resolveOrderConfirmationProse(
  translate: OrdersTranslate | undefined,
  language: string | undefined,
): Promise<OrderConfirmationProse> {
  return ordersProseTable(translate, ORDER_CONFIRMATION_KEYS, supportedLanguageOf(language));
}

/**
 * `prose` carries the sentences in the e-mail's language
 * ({@link resolveOrderConfirmationProse}); the totals and address labels are
 * `email-components`' and follow `input.language` as before.
 */
export function buildOrderConfirmationEmail(
  input: BuildOrderConfirmationEmailInput,
  renderers: OrderConfirmationRenderers,
  prose: OrderConfirmationProse = ORDER_CONFIRMATION_PROSE_EN,
): EmailMailerSendInput {
  const { order, items } = input;
  const currency = order.currency;
  const discountTotal = Number(order.discountTotal);
  const labels = orderTotalsLabels(input.language);

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
          prose['email.orderConfirmation.discounts'],
          `  ${order.promotionCode ? `${order.promotionCode}: ` : ''}-${money(discountTotal, currency)}`,
        ]
      : [``, prose['email.orderConfirmation.discounts'], `  ${labels.none}`];

  const text = [
    prose['email.orderConfirmation.thanks'],
    ``,
    fillPlaceholders(prose['email.orderConfirmation.order'], { businessId: order.businessId }),
    ``,
    prose['email.orderConfirmation.products'],
    ...productLines,
    ``,
    fillPlaceholders(prose['email.orderConfirmation.deliveryMethod'], { line: shippingLine }),
    fillPlaceholders(prose['email.orderConfirmation.paymentMethod'], { line: paymentLine }),
    ...discountSection,
    ``,
    prose['email.orderConfirmation.summary'],
    ...summary,
    ``,
    prose['email.orderConfirmation.shippingAddress'],
    formatAddress(order.deliveryAddress, labels),
    ``,
    prose['email.orderConfirmation.billingAddress'],
    formatAddress(order.billingAddress, labels),
  ].join('\n');

  return {
    messageId: `order_confirmation:${order.id}`,
    to: input.to,
    subject: fillPlaceholders(prose['email.orderConfirmation.subject'], {
      businessId: order.businessId,
    }),
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
