import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Settings manifest for the Quote Requests module — feature 008.
 *
 * Three settings keys (FR-031 / FR-032 / FR-033):
 *   - quote_requests.expiryDays      (integer, default 0 = never)
 *   - quote_requests.showAddToQuoteOnCard (boolean, default true)
 *   - quote_requests.showAddToQuoteOnPdp  (boolean, default true)
 */

export const QUOTE_REQUESTS_SETTING_CODES = {
  EXPIRY_DAYS: 'quote_requests.expiry_days',
  SHOW_ADD_TO_QUOTE_ON_CARD: 'quote_requests.show_add_to_quote_on_card',
  SHOW_ADD_TO_QUOTE_ON_PDP: 'quote_requests.show_add_to_quote_on_pdp',
} as const;

export const DEFAULT_QUOTE_REQUESTS_EXPIRY_DAYS = 0;

const settings = defineModuleSettingsManifest({
  moduleCode: 'quote_requests',
  groups: [
    {
      code: 'quote_requests',
      name: 'Quote Requests',
    },
  ],
  settings: [
    {
      code: QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS,
      name: 'Auto-expire pending after (days)',
      description:
        'Number of days a Pending or Created from admin Quote Request lives before the expiry worker flips it to Expired. 0 disables auto-expiry entirely.',
      groupCode: 'quote_requests',
      valueType: 'number',
      defaultValue: DEFAULT_QUOTE_REQUESTS_EXPIRY_DAYS,
    },
    {
      code: QUOTE_REQUESTS_SETTING_CODES.SHOW_ADD_TO_QUOTE_ON_CARD,
      name: 'Show "Add to quote" on product card',
      description: 'Toggles the "Add to quote" button on storefront product card listings.',
      groupCode: 'quote_requests',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: QUOTE_REQUESTS_SETTING_CODES.SHOW_ADD_TO_QUOTE_ON_PDP,
      name: 'Show "Add to quote" on product detail',
      description: 'Toggles the "Add to quote" button on storefront product detail pages.',
      groupCode: 'quote_requests',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'quote_requests',
  name: 'Quote Requests',
  description:
    'Customer-initiated RFQ workflow with admin pricing, approvals, and expiry.',
  version: '1.0.0',
  dependencies: ['settings', 'catalog'],
  settings,
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'open-rfq-inbox',
      labelKey: 'quote_requests.actions.openInbox.label',
      descriptionKey: 'quote_requests.actions.openInbox.description',
      icon: 'Inbox',
      targetRoute: '/quote-requests',
      requiredPermission: 'rfqs:handle',
      keywords: ['rfq', 'quote', 'inbox', 'zapytanie', 'oferta'],
      weight: 310,
    },
  ],
});

/** Legacy export retained for backward compatibility. */
export const quoteRequestsManifest = settings;
