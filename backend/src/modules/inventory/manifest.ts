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
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'inventory',
  groups: [{ code: 'inventory', name: 'Inventory' }],
  settings: [
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
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'inventory',
  name: 'Inventory',
  description:
    'Multi-warehouse stock levels, fulfilment strategy, and storefront display modes.',
  version: '1.0.0',
  dependencies: ['settings', 'sales_channels', 'dictionaries'],
  settings,
});

/** Legacy export retained for backward compatibility. */
export const inventoryManifest = settings;
