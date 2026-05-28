import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Orders module — manifest.
 *
 * Feature 036 adds the customer-facing business Order ID. Its optional
 * prefix/suffix are declared here as settings (`orders.business_id.*`) and
 * seeded by the module-lifecycle ManifestReconciler on boot — the same path
 * `carts.abandonment.*` uses. They are Sales-Channel-scopable through the
 * standard settings scoping; defaults are empty (bare numeric ID).
 */

export const ORDERS_SETTING_CODES = {
  BUSINESS_ID_PREFIX: 'orders.business_id.prefix',
  BUSINESS_ID_SUFFIX: 'orders.business_id.suffix',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'orders',
  groups: [{ code: 'orders', name: 'Orders' }],
  settings: [
    {
      code: ORDERS_SETTING_CODES.BUSINESS_ID_PREFIX,
      name: 'Business Order ID prefix',
      description:
        'Text prepended to the generated business Order ID shown to the Customer (e.g. "ORD-"). Empty = no prefix.',
      groupCode: 'orders',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: ORDERS_SETTING_CODES.BUSINESS_ID_SUFFIX,
      name: 'Business Order ID suffix',
      description:
        'Text appended to the generated business Order ID shown to the Customer (e.g. "-2026"). Empty = no suffix.',
      groupCode: 'orders',
      valueType: 'string',
      defaultValue: '',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'orders',
  name: 'Orders',
  description: 'Order placement, lifecycle, and history.',
  version: '1.1.0',
  dependencies: ['settings'],
  settings,
});
