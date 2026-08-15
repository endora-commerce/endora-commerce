import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Carts module — feature 027 consolidation pass.
 *
 * Settings (`carts.abandonment.*`) declared here are seeded by the module-
 * lifecycle ManifestReconciler on backend boot. No raw INSERT in the
 * migration; the reconciler is the single seed path (matches the
 * `inventory.*` and `organizations.*` patterns).
 */

export const CARTS_SETTING_CODES = {
  ABANDONMENT_INACTIVITY_MINUTES: 'carts.abandonment.inactivity_minutes',
  ABANDONMENT_NOTIFICATION_RECIPIENT: 'carts.abandonment.notification_recipient',
} as const;

/**
 * The manifest defaults, exported so a read that has to degrade degrades to
 * *this* binding rather than to a literal invented at the call site (feature
 * 072, D-43).
 *
 * The two used to diverge: the manifest said 10080 while both readers' `catch`
 * answered `0`, and `CartAbandonmentWorker` treats `<= 0` as "sweep nothing".
 * The divergence did not merely lose the configured value — it inverted the
 * feature, and it would still have been off after the channel was fixed. A
 * compiled-in fallback is a second source of truth consulted only when the
 * first is unreachable, i.e. exactly when nobody is watching.
 */
export const DEFAULT_ABANDONMENT_INACTIVITY_MINUTES = 10080;
export const DEFAULT_ABANDONMENT_NOTIFICATION_RECIPIENT = '';

const settings = defineModuleSettingsManifest({
  moduleCode: 'carts',
  groups: [{ code: 'carts', name: 'Carts' }],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'carts.enabled',
      name: 'Carts enabled',
      description:
        'Switches the cart on or off: the storefront cart, coupons and upsells, the organization approval workflow, the admin cart screens and the abandonment sweep. Checkout goes with it, because an order is placed from a cart. Nothing is dropped — every cart, its lines, its approval state and its audit history stay in the database.',
      groupCode: 'carts',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES,
      name: 'Cart abandonment threshold (minutes)',
      description:
        'Minutes of inactivity before an Active cart is considered Abandoned. Default 10080 (7 days).',
      groupCode: 'carts',
      valueType: 'number',
      defaultValue: DEFAULT_ABANDONMENT_INACTIVITY_MINUTES,
    },
    {
      code: CARTS_SETTING_CODES.ABANDONMENT_NOTIFICATION_RECIPIENT,
      name: 'Abandonment notification recipient',
      description:
        'Single e-mail address that receives an abandonment notification on every Active → Abandoned transition. Empty = no notification.',
      groupCode: 'carts',
      valueType: 'string',
      defaultValue: DEFAULT_ABANDONMENT_NOTIFICATION_RECIPIENT,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'carts',
  name: 'Carts',
  description: 'Shopping cart aggregation, pricing, lifecycle, and approval gate.',
  version: '2.0.0',
  dependencies: [
    'customer_accounts',
    'organizations',
    'price_lists',
    'promotions',
    'quote_requests',
    'sales_channels',
    'settings',
  ],
  settings,
  // Feature 073 (Constitution XVII) — deactivatable, and the reason it is not
  // `nonDeactivatable` is a product one: a quote-only B2B deployment is a real
  // configuration, where RFQ replaces checkout and `quote_requests` stands on
  // its own. `orders` declares `carts` as a dependency, so dependencies-fail-
  // closed means switching this off takes checkout with it — which is the
  // intended meaning, not an accident.
  activation: { settingCode: 'carts.enabled', default: true },
  // Feature 026 checklist — `routes.admin.ts` gates on both codes and this
  // manifest declared neither, so until T136 only a role holding `'*'` could
  // reach the admin cart screens. The permission-inventory contract test did
  // not catch it: its scanner requires an optional-call dot before the argument
  // list, so it matches almost nothing in the tree. Filed separately — the fix
  // has a fan-out well beyond this module, and the scanner reads comments, so
  // spelling the pattern out here would register a phantom code.
  permissions: [
    { code: 'carts:read', label: 'View customer carts' },
    { code: 'carts:reject', label: 'Reject a cart pending organization approval' },
  ],
  i18n: { bundlesDir: 'i18n' },
});

/** Legacy export retained for backward compatibility. */
export const cartsManifest = settings;
