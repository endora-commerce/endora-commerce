import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Settings manifest for the Inventory module — feature 010.
 *
 * Seven settings (FR-019 / FR-029 / FR-031). Setting codes follow
 * the foundation regex `^[a-z][a-z0-9_][a-z0-9_.]*[a-z0-9]$`.
 */

export const INVENTORY_SETTING_CODES = {
  DISPLAY_MODE: 'inventory.display_mode',
  FULFILMENT_STRATEGY: 'inventory.fulfilment_strategy',
  FULFILMENT_STRATEGY_WAREHOUSE_ORDER: 'inventory.fulfilment_strategy_warehouse_order',
  GLOBAL_THRESHOLD_HIGH: 'inventory.global_threshold_high',
  GLOBAL_THRESHOLD_MEDIUM: 'inventory.global_threshold_medium',
  GLOBAL_THRESHOLD_LOW: 'inventory.global_threshold_low',
  LOW_STOCK_ALERT_RECIPIENT_EMAIL: 'inventory.low_stock_alert_recipient_email',
  ALLOW_NEGATIVE_STOCK: 'inventory.allow_negative_stock',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'inventory',
  groups: [{ code: 'inventory', name: 'Inventory' }],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'inventory.enabled',
      name: 'Inventory enabled',
      description:
        'Switches stock management on or off: warehouses, stock levels and their adjustments, low-stock alerts, the back-in-stock notification flow and the storefront stock figure. Nothing is dropped — every warehouse, stock row and pending notification stays in the database and resumes where it was.',
      groupCode: 'inventory',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: INVENTORY_SETTING_CODES.DISPLAY_MODE,
      name: 'Storefront stock display mode',
      description:
        'How storefront product cards and PDP render stock: exact / band / available_or_not.',
      groupCode: 'inventory',
      valueType: 'string',
      defaultValue: 'band',
    },
    {
      code: INVENTORY_SETTING_CODES.FULFILMENT_STRATEGY,
      name: 'Order fulfilment strategy',
      description:
        'Picks warehouses to fulfil order lines. any | default_first | lowest_stock_first | highest_stock_first | defined_order.',
      groupCode: 'inventory',
      valueType: 'string',
      defaultValue: 'default_first',
    },
    {
      code: INVENTORY_SETTING_CODES.FULFILMENT_STRATEGY_WAREHOUSE_ORDER,
      name: 'Warehouse order (for "defined_order" strategy)',
      description: 'Ordered list of warehouse IDs walked by the defined-order strategy.',
      groupCode: 'inventory',
      valueType: 'json',
      defaultValue: [],
    },
    {
      code: INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_HIGH,
      name: 'Global high-stock threshold',
      description: 'Quantity at or above which a product is considered high-stock.',
      groupCode: 'inventory',
      valueType: 'number',
      defaultValue: 100,
    },
    {
      code: INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_MEDIUM,
      name: 'Global medium-stock threshold',
      description: 'Quantity at or above which a product is considered medium-stock.',
      groupCode: 'inventory',
      valueType: 'number',
      defaultValue: 20,
    },
    {
      code: INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_LOW,
      name: 'Global low-stock threshold',
      description:
        'Quantity at or above which a product is considered low-stock. Below this it is out of stock.',
      groupCode: 'inventory',
      valueType: 'number',
      defaultValue: 1,
    },
    {
      code: INVENTORY_SETTING_CODES.LOW_STOCK_ALERT_RECIPIENT_EMAIL,
      name: 'Low-stock alert recipient email',
      description: 'Email to receive low-stock alerts. Empty falls back to the platform admin.',
      groupCode: 'inventory',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: INVENTORY_SETTING_CODES.ALLOW_NEGATIVE_STOCK,
      name: 'Allow ordering below stock (negative stock)',
      description:
        'Global gate for per-product backorder. When false, no product accepts orders below available stock regardless of its per-product backorder flag. When true, products whose backorder flag is set may be ordered into negative stock.',
      groupCode: 'inventory',
      valueType: 'boolean',
      defaultValue: false,
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'inventory',
  name: 'Inventory',
  description:
    'Multi-warehouse stock levels, fulfilment strategy, and storefront display modes.',
  version: '1.0.0',
  // Feature 075, Phase C adds `customer_accounts` and `email`. Both were
  // reached by importing a file rather than resolving a port, so neither
  // appeared here: the availability queue turns a subscription into an e-mail
  // address by reading `CustomerAccount`, and every message this module sends
  // leaves through `email`'s transport. `customer_accounts` belongs in
  // `dependencies` rather than `nonBindingDependencies` for the reason
  // `quick_order` gives — a back-in-stock notice addressed to an account the
  // platform will not identify is worse than a refused subscription.
  dependencies: [
    'auth',
    'catalog',
    'customer_accounts',
    'dictionaries',
    'email',
    'organizations',
    'sales_channels',
    'settings',
    'transactional_emails',
  ],
  // D-44 — real to the container, binding on no operator.
  nonBindingDependencies: [
    {
      moduleId: 'prompt_actions',
      name: 'promptActionToolRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module’s boot hook, of the warehouse resolver and the ' +
        '`set_stock_level` mutation built over its own services. Nothing is read back: ' +
        'the registry is a plain registration that drops every tool whose owner is not ' +
        'effectively present, so an absent contributor costs the host nothing and an ' +
        'absent host holds a table nobody walks. Declaring the edge would make an ' +
        'optional assistant undeactivatable for as long as stock is tracked.',
    },
  ],
  settings,
  // Feature 073 (Constitution XVII) — the operator's activation control.
  activation: { settingCode: 'inventory.enabled', default: true },
  i18n: { bundlesDir: 'i18n' },
  // Feature 047 — admin-editable transactional emails owned by this module.
  transactionalEmails: [
    {
      code: 'low_stock_alert',
      name: 'Low stock alert',
      group: 'inventory',
      variables: [
        { key: 'product.name', label: 'Product name', sampleValue: 'Widget' },
        { key: 'product.sku', label: 'Product SKU', sampleValue: 'WID-001' },
        { key: 'cumulativeOnHand', label: 'Cumulative on-hand', sampleValue: '3' },
        { key: 'threshold', label: 'Threshold', sampleValue: '5' },
      ],
    },
    {
      code: 'availability_back_in_stock',
      name: 'Back in stock notification',
      group: 'inventory',
      variables: [{ key: 'product.name', label: 'Product name', sampleValue: 'Widget' }],
    },
  ],
  actions: [
    {
      id: 'open-inventory',
      labelKey: 'actions.openInventory.label',
      descriptionKey: 'actions.openInventory.description',
      icon: 'Boxes',
      targetRoute: '/inventory',
      requiredPermission: 'catalog:write',
      keywords: ['stock', 'inventory', 'warehouse', 'magazyn', 'zapasy'],
      weight: 230,
    },
  ],
});

/** Legacy export retained for backward compatibility. */
export const inventoryManifest = settings;
