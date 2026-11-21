import type { SalesChannelSummary } from '@endora-commerce/contracts';
import { adminLanguageToLocale } from '@endora-commerce/admin-kit/components';
import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';

/**
 * The storefront actions a custom event fires on, as the operator reads them
 * (issue #1537, UX audit CONTENT-20). Every key is in the `google_analytics`
 * bundle; read with `useTranslation('google_analytics')`. The values mirror
 * `gaTriggerActionSchema` in `@endora-commerce/contracts`, in its order, which
 * is the order the editor's select lists them in.
 */
export const gaTriggerActionLabels = defineEnumLabels({
  contact_form_submitted: 'customEvents.actions.contact_form_submitted',
  place_order_clicked: 'customEvents.actions.place_order_clicked',
  add_to_cart: 'customEvents.actions.add_to_cart',
  add_to_quote_request: 'customEvents.actions.add_to_quote_request',
  add_to_shopping_list: 'customEvents.actions.add_to_shopping_list',
  button_click_by_id: 'customEvents.actions.button_click_by_id',
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
