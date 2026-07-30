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

const settings = defineModuleSettingsManifest({
  moduleCode: 'carts',
  groups: [{ code: 'carts', name: 'Carts' }],
  settings: [
    {
      code: CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES,
      name: 'Cart abandonment threshold (minutes)',
      description:
        'Minutes of inactivity before an Active cart is considered Abandoned. Default 10080 (7 days).',
      groupCode: 'carts',
      valueType: 'number',
      defaultValue: 10080,
    },
    {
      code: CARTS_SETTING_CODES.ABANDONMENT_NOTIFICATION_RECIPIENT,
      name: 'Abandonment notification recipient',
      description:
        'Single e-mail address that receives an abandonment notification on every Active → Abandoned transition. Empty = no notification.',
      groupCode: 'carts',
      valueType: 'string',
      defaultValue: '',
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
  i18n: { bundlesDir: 'i18n' },
});

/** Legacy export retained for backward compatibility. */
export const cartsManifest = settings;
