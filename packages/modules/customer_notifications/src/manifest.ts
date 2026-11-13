import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * `customer_notifications` — the buyer's notification centre on the storefront
 * (`specs/179-rfq-and-customer-notifications/`, research R-2).
 *
 * Entries are addressed to one customer account of one Organization
 * (Principle XI), concern one sales channel or every channel (Principle XII),
 * and are recorded by other modules through the published
 * `customerNotificationRecordPort`. `quote_requests` is the first producer.
 * The module owns the entries, their storefront API and their retention; it
 * has no admin screen — its two settings are shown on the generic Settings
 * screen, and its activation control on `/platform/modules`.
 */
export const manifest = defineModuleManifest({
  id: 'customer_notifications',
  name: 'Customer notifications',
  description:
    "A notification centre in the buyer's storefront account: entries other modules record for one customer account, read, counted and marked read through the storefront API, and deleted after a retention period.",
  version: '1.0.0',
  // Research R-20. Every owner bound here is one this module cannot do without:
  // `_i18n` owns `adminI18nService`, through which an entry is rendered in the
  // reader's language; `auth` the storefront guard (`requireCustomer`) and the
  // session behind it; `settings` the store the activation control and the
  // retention period live in, and the write-validator registry that holds the
  // period to its range; `customer_accounts` `customerAccountReadPort`, which
  // the retention sweep asks which accounts were deleted or anonymised.
  dependencies: ['_i18n', 'auth', 'customer_accounts', 'settings'],
  // The bundles carry the settings group's heading and its labels.
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  settings: {
    moduleCode: 'customer_notifications',
    groups: [{ code: 'customer_notifications', name: 'Customer notifications' }],
    settings: [
      {
        // Constitution XVII — the operator's activation control. Platform-wide.
        code: 'customer_notifications.enabled',
        name: 'Customer notifications enabled',
        description:
          "Switches the notification centre in the buyer's storefront account on or off. While off nothing is recorded, the storefront shows neither the notifications page nor the unread count, and its API is gone. Nothing is deleted — entries already recorded are kept and reappear when you switch it back on.",
        groupCode: 'customer_notifications',
        valueType: 'boolean',
        defaultValue: true,
      },
      {
        // Research R-16 — platform-wide, held to 7–730 whole days by this
        // module's settings write validator; the reader holds a stored value
        // outside it to the range.
        code: 'customer_notifications.retention_days',
        name: 'Keep notifications for (days)',
        description:
          'How many days a notification stays in the buyer\'s account before it is deleted. From 7 to 730 days.',
        groupCode: 'customer_notifications',
        valueType: 'number',
        defaultValue: 90,
      },
    ],
  },
  activation: { settingCode: 'customer_notifications.enabled', default: true },
});
