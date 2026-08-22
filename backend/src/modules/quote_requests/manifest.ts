import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Settings manifest for the Quote Requests module — feature 008.
 *
 * Settings keys:
 *   - quote_requests.expiryDays      (integer, default 0 = never)
 *   - quote_requests.showAddToQuoteOnCard (boolean, default true)
 *   - quote_requests.showAddToQuoteOnPdp  (boolean, default true)
 *   - quote_requests.business_id.prefix   (string, default '')
 *   - quote_requests.business_id.suffix   (string, default '')
 */

export const QUOTE_REQUESTS_SETTING_CODES = {
  EXPIRY_DAYS: 'quote_requests.expiry_days',
  SHOW_ADD_TO_QUOTE_ON_CARD: 'quote_requests.show_add_to_quote_on_card',
  SHOW_ADD_TO_QUOTE_ON_PDP: 'quote_requests.show_add_to_quote_on_pdp',
  BUSINESS_ID_PREFIX: 'quote_requests.business_id.prefix',
  BUSINESS_ID_SUFFIX: 'quote_requests.business_id.suffix',
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
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'quote_requests.enabled',
      name: 'Quote requests enabled',
      description:
        'Switches the RFQ flow on or off: the customer request surfaces, the add-to-quote controls on the product card and PDP, the admin quote desk, and the worker that expires pending requests. Nothing is dropped — every request, its revisions and its messages stay in the database and resume where they were.',
      groupCode: 'quote_requests',
      valueType: 'boolean',
      defaultValue: true,
    },
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
    {
      code: QUOTE_REQUESTS_SETTING_CODES.BUSINESS_ID_PREFIX,
      name: 'Business Quote Request ID prefix',
      description:
        'Text prepended to the generated business Quote Request ID shown to the Customer (e.g. "QR-"). Empty = no prefix.',
      groupCode: 'quote_requests',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: QUOTE_REQUESTS_SETTING_CODES.BUSINESS_ID_SUFFIX,
      name: 'Business Quote Request ID suffix',
      description:
        'Text appended to the generated business Quote Request ID shown to the Customer (e.g. "-2026"). Empty = no suffix.',
      groupCode: 'quote_requests',
      valueType: 'string',
      defaultValue: '',
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
  // `admin_roles` since feature 072 (T138): the sales-rep roll-up scope reads
  // `permissionService` directly now, rather than through a root-built bundle.
  // It was already satisfied transitively via `auth`; the edge is declared
  // because a manifest is what an operator reads.
  // Feature 075, Phase C — `admin_users` and `customer_accounts` join the seven
  // that were already here. Both are ordinary declarations: neither reaches
  // back to this module, so the edges close no cycle. `carts` and `orders` do
  // reach back and are acknowledged below.
  //
  // `sales_channels` owns `salesChannelAttributionRegistry`, the registry this
  // module pushes its own "how many of my rows are attributed to this channel?"
  // counter into (feature 075, D-87). The registry is ungated and its owner is
  // non-deactivatable, so the declaration buys install and migration order
  // rather than a flip-time refusal.
  dependencies: [
    'admin_roles',
    'admin_users',
    'auth',
    'catalog',
    'custom_fields',
    'customer_accounts',
    'organizations',
    'sales_channels',
    'settings',
    'taxes',
  ],
  /**
   * Feature 075, Phase C — the two edges this module genuinely has and cannot
   * declare above, because `carts/manifest.ts` declares **this** module and
   * `orders` declares `carts`. An ordinary declaration would close a cycle,
   * which `backend/test/unit/db/module-graph.test.ts` fails the build on.
   *
   * Neither is a schema edge, so nothing is lost by keeping them out of the
   * install and migration order: `cartWritePort` is the quote-to-cart
   * conversion (the write that used to be `em.create(Cart, …)` from inside this
   * module), and `orderReadPort` is the `order.created.v1` reactor reading the
   * order that names the quote request it completes. Both fail closed, and both
   * owners are the ones that would have to be off for the path to be reachable
   * at all — a conversion with no cart module has nowhere to convert to.
   */
  acknowledgedDependencies: [
    {
      moduleId: 'carts',
      port: 'cartWritePort',
      reason:
        'Converting an approved quote seeds the customer’s active cart at the agreed unit ' +
        'prices, which is a write into carts’ own tables and belongs to carts. Declaring it ' +
        'as a dependency closes a cycle, because carts declares this module for the ' +
        '"add to quote" surface. The seam fails closed: a conversion that cannot reach the ' +
        'cart must refuse rather than report a checkout URL for a cart nobody wrote.',
    },
    {
      moduleId: 'orders',
      port: 'orderReadPort',
      reason:
        'The order.created.v1 reactor reads the order that names the quote request it ' +
        'completes. Declaring it closes a cycle through carts. The seam fails closed, and ' +
        'the event that triggers it cannot be emitted by an absent orders module, so the ' +
        'acknowledged edge adds no refusal that was reachable before.',
    },
  ],
  settings,
  // Feature 073 (Constitution XVII) — the operator's activation control.
  activation: { settingCode: 'quote_requests.enabled', default: true },
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'open-rfq-inbox',
      labelKey: 'actions.openInbox.label',
      descriptionKey: 'actions.openInbox.description',
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
