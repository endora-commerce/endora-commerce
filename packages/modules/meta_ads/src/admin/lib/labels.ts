import type { SalesChannelSummary } from '@endora-commerce/contracts';
import { adminLanguageToLocale } from '@endora-commerce/admin-kit/components';
import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';

/**
 * The storefront actions a Meta custom event fires on, as the operator reads
 * them (issue #1537, UX audit CONTENT-20). Every key is in the `meta_ads`
 * bundle; read with `useTranslation('meta_ads')`. The values mirror
 * `metaTriggerActionSchema` in `@endora-commerce/contracts`, in its order.
 */
export const metaTriggerActionLabels = defineEnumLabels({
  product_viewed: 'customEvents.action.product_viewed',
  add_to_cart: 'customEvents.action.add_to_cart',
  add_to_quote_request: 'customEvents.action.add_to_quote_request',
  add_to_shopping_list: 'customEvents.action.add_to_shopping_list',
  begin_checkout: 'customEvents.action.begin_checkout',
  place_order_clicked: 'customEvents.action.place_order_clicked',
  purchase: 'customEvents.action.purchase',
  contact_form_submitted: 'customEvents.action.contact_form_submitted',
});

/**
 * A sales channel as the list and the editor name it: its name in the admin
 * language (`pl` → `pl-PL`), then `en-US`, then any name, then its code — the
 * order the kit's `SalesChannelPicker` uses. `fallback` is what is shown when
 * the channel could not be read (the stored code or id), so a failed channel
 * read never hides which channel a row is for.
 */
export function salesChannelLabel(
  channel: Pick<SalesChannelSummary, 'code' | 'name'> | undefined,
  language: string,
  fallback: string,
): string {
  if (channel === undefined) return fallback;
  const locale = adminLanguageToLocale(language);
  return channel.name[locale] ?? channel.name['en-US'] ?? Object.values(channel.name)[0] ?? channel.code;
}
