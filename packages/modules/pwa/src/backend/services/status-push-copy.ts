import {
  LANGUAGE_FALLBACK,
  SUPPORTED_LANGUAGES,
  type OrderStatusDefinitionRecord,
  type SupportedLanguage,
} from '@endora-commerce/contracts';

/**
 * The pure rules behind an order status push's sentence
 * (`specs/149-pwa-order-status-push/` research R-8 – R-10): which language,
 * which status label, which bundle key, which parameters and which deep link.
 *
 * A push is rendered by the device from the payload, so there is no consumer
 * with a catalogue to translate a key — the backend sends the sentence
 * (translation-boundary case 1). The sentences themselves live in this
 * module's own `i18n/{en,pl}.json` and are rendered through `_i18n`; nothing
 * here translates.
 */

/**
 * The channel's default language reduced to its primary subtag and bounded to
 * the bundles the platform ships; anything else is English (FR-010).
 */
export function notificationLanguage(channelLanguage: string | null | undefined): SupportedLanguage {
  const primary = (channelLanguage ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary)
    ? (primary as SupportedLanguage)
    : LANGUAGE_FALLBACK;
}

/**
 * The shop's own label for a status: the name in the notification language,
 * then the default name, then the code (FR-011). A blank label counts as
 * missing.
 */
export function orderStatusLabel(
  code: string,
  definition: OrderStatusDefinitionRecord | null,
  language: SupportedLanguage,
): string {
  const localised = definition?.name[language]?.trim();
  if (localised) return localised;
  const fallback = definition?.defaultName.trim();
  if (fallback) return fallback;
  return code;
}

/** A sentence to render: two bundle keys, their parameters, and where a tap lands. */
export interface StatusPushCopy {
  titleKey: string;
  bodyKey: string;
  params: Record<string, string>;
  url: string;
}

/** An order status change: names the order and its new status, opens the order (FR-013). */
export function orderStatusCopy(input: {
  orderId: string;
  businessId: string;
  statusLabel: string;
}): StatusPushCopy {
  return {
    titleKey: 'notification.orderStatus.title',
    bodyKey: 'notification.orderStatus.body',
    params: { orderNumber: input.businessId, status: input.statusLabel },
    url: `/orders/${input.orderId}`,
  };
}
