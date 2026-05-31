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
  /** Feature 038 — minimum order value to pass Checkout / admin create (0 = no minimum). */
  MIN_ORDER_VALUE: 'orders.min_order_value',
  /** Feature 038 — whether reordering a past order is allowed. */
  REORDER_ENABLED: 'orders.reorder_enabled',
  /** Feature 038 — extra emails CC'd on every order confirmation in scope. */
  CONFIRMATION_RECIPIENTS: 'orders.confirmation_recipients',
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
    {
      code: ORDERS_SETTING_CODES.MIN_ORDER_VALUE,
      name: 'Minimum order value',
      description:
        'Minimum order total required to pass Checkout or to create an order. 0 = no minimum. Sales-channel value overrides the global value.',
      groupCode: 'orders',
      valueType: 'number',
      defaultValue: 0,
    },
    {
      code: ORDERS_SETTING_CODES.REORDER_ENABLED,
      name: 'Reordering enabled',
      description:
        'When enabled, a past order can be placed again (reorder). Sales-channel value overrides the global value.',
      groupCode: 'orders',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: ORDERS_SETTING_CODES.CONFIRMATION_RECIPIENTS,
      name: 'Order confirmation recipients',
      description:
        'Additional email addresses that receive a confirmation for every order placed in scope (global or per Sales Channel).',
      groupCode: 'orders',
      valueType: 'string_list',
      defaultValue: [],
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'orders',
  name: 'Orders',
  description: 'Order placement, lifecycle, and history.',
  version: '1.2.0',
  dependencies: ['settings'],
  settings,
  i18n: { bundlesDir: 'i18n' },
});
