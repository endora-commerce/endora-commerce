import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  PRICING_SETTING_CODES,
} from '@endora-commerce/contracts';

/**
 * Admin permission codes owned by this module (issue #219).
 *
 * Before these existed every admin route here was gated by `catalog:write`, so
 * a role granted catalogue content work could change what customers pay. That
 * boundary was never chosen — it was the side effect of the module declaring no
 * codes of its own. Pricing is not catalogue content.
 *
 * The split is read/write rather than one code because the two authorities are
 * genuinely different: reading a price list, its brackets and the rule-target
 * pickers is what an operator needs to understand a quoted price, while editing
 * a bracket changes what a customer is charged.
 */
export const PRICE_LIST_PERMISSIONS = {
  READ: 'price_lists:read',
  WRITE: 'price_lists:write',
} as const;

/**
 * Settings manifest for the Price Lists module — feature 011.
 *
 * Two settings (FR-037). Setting codes follow the foundation regex
 * `^[a-z][a-z0-9_][a-z0-9_.]*[a-z0-9]$`.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'price_lists',
  groups: [{ code: 'pricing', name: 'Pricing' }],
  settings: [
    {
      code: PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE,
      name: 'Default price display mode',
      description:
        'How storefront product surfaces render prices for signed-in customers: gross_only / net_only / both / none.',
      groupCode: 'pricing',
      valueType: 'string',
      defaultValue: 'gross_only',
      enumOptions: ['gross_only', 'net_only', 'both', 'none'],
    },
    {
      code: PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE,
      name: 'Unauthenticated price display mode',
      description:
        'Display mode for anonymous (not signed in) visitors. Defaults to the same as `default_display_mode` — set to `none` to hide prices until login.',
      groupCode: 'pricing',
      valueType: 'string',
      defaultValue: 'gross_only',
      enumOptions: ['gross_only', 'net_only', 'both', 'none'],
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'price_lists',
  name: 'Price Lists',
  description:
    'Customer-group pricing, brackets, display modes, and rule-based engine.',
  version: '1.0.0',
  // `customer_accounts` since feature 076 (D-79): customer groups moved to the
  // module that owns the customer, so this module reads `customerGroupReadPort`
  // for the rule-target picker and its validation, and `customerAccountReadPort`
  // for the admin resolved-price probe. Both fail closed, which is why the edge
  // is binding — pricing for a customer the platform will not identify is worse
  // than refusing the probe.
  // `currencies` owns `currencyReferenceRegistry`, the registry this module
  // contributes its "who still prices in this currency" descriptor to (feature
  // 077, D-87). `currencies` used to ask the question itself, with a
  // `count(*) from "price_lists"` naming this module's table.
  // `audit_logs` owns `auditReferenceRegistry`, the registry this module pushes
  // its own "what is this audit row called, and where does the admin app show
  // it?" resolver into (feature 075, D-87). The registry is ungated and its
  // owner is non-deactivatable, so the declaration buys install and migration
  // order rather than a flip-time refusal.
  dependencies: [
    'audit_logs',
    'catalog',
    'currencies',
    'customer_accounts',
    'organizations',
    'settings',
  ],
  permissions: [
    { code: PRICE_LIST_PERMISSIONS.READ, label: 'View price lists and pricing rules' },
    { code: PRICE_LIST_PERMISSIONS.WRITE, label: 'Edit price lists, brackets and display modes' },
  ],
  settings,
  // Feature 074 (Constitution XVII), test C2 — functional base, and one of the
  // escalation answers. B2B *is* contract pricing. The deciding fact is the
  // same shape as `taxes`: absent, the resolution falls back to the base price
  // silently, so every buyer pays list and nothing on any surface says so. A
  // platform where that happens is a B2C shop, not a reduced B2B one.
  //
  // As with `taxes` this closes the operator route only; the platform route —
  // a deployment that never installs the module — is a separate follow-up.
  //
  // `price_lists.enabled` goes with the control it backed: one of the nineteen
  // that never accepted a deactivation. The existing rows are removed by a core
  // data migration (feature 074, FR-010a).
  activation: {
    nonDeactivatable: true,
    reason:
      'B2B is contract pricing. Absent, every buyer silently pays base price, which makes the ' +
      'platform a B2C shop rather than a reduced B2B one.',
  },
  i18n: { bundlesDir: 'i18n' },
});

/** Legacy export retained for backward compatibility. */
export const priceListsManifest = settings;
