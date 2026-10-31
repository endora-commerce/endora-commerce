import type { SupportedLanguage } from '@endora-commerce/contracts';

/**
 * The prose this module's backend composes for a reader whose language it
 * knows — the in-code order-confirmation e-mail, written in the language of
 * the order's sales channel (`specs/conventions/module-i18n.md`, the case where
 * the backend can resolve the reader's language).
 *
 * The sentences live in this module's bundle; this table keeps their English
 * beside the code as the last tier, for when the bundle cannot answer.
 * `email-templates/order-confirmation-language.test.ts` holds it equal to
 * `i18n/en.json`.
 */
export const ORDERS_PROSE_EN = {
  'email.orderConfirmation.subject': 'Order confirmation {businessId}',
  'email.orderConfirmation.thanks': 'Thank you for your order.',
  'email.orderConfirmation.order': 'Order: {businessId}',
  'email.orderConfirmation.products': 'Products:',
  'email.orderConfirmation.deliveryMethod': 'Delivery method: {line}',
  'email.orderConfirmation.paymentMethod': 'Payment method: {line}',
  'email.orderConfirmation.discounts': 'Applied discounts:',
  'email.orderConfirmation.summary': 'Summary:',
  'email.orderConfirmation.shippingAddress': 'Shipping address:',
  'email.orderConfirmation.billingAddress': 'Billing address:',
} as const;

export type OrdersProseKey = keyof typeof ORDERS_PROSE_EN;

export type ProseParams = Record<string, string | number>;

/**
 * `_i18n`'s `adminI18nService.translate`, bound to this module's bundle. It
 * answers `orders.<key>` for a key no bundle carries.
 */
export type OrdersTranslate = (
  key: string,
  language: SupportedLanguage,
  params?: ProseParams,
) => Promise<string>;

/** Every key's template in `language`, English for a key the bundle cannot answer. */
export async function ordersProseTable<K extends OrdersProseKey>(
  translate: OrdersTranslate | undefined,
  keys: readonly K[],
  language: SupportedLanguage,
): Promise<Record<K, string>> {
  // One at a time: every lookup is a read of `_i18n`'s bundle table, and a
  // table of them at once would take that many pool connections together.
  const table = {} as Record<K, string>;
  for (const key of keys) {
    table[key] = ORDERS_PROSE_EN[key];
    if (!translate) continue;
    try {
      const text = await translate(key, language);
      if (text !== `orders.${key}`) table[key] = text;
    } catch {
      // The English tier is the answer to an unreachable bundle.
    }
  }
  return table;
}

export function fillPlaceholders(template: string, params?: ProseParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] != null ? String(params[name]) : match,
  );
}
