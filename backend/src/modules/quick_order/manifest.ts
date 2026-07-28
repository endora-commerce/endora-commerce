import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';

/**
 * Quick Order module — manifest (Module Lifecycle, feature 018) extended for
 * feature 039.
 *
 * Settings (feature 039):
 *   - quick_order.one_click_buy_enabled — gates the storefront one-click-buy
 *     button. Sales-channel-scoped (each channel may override the global
 *     value); default off.
 *   - quick_order.import_max_rows — upper bound on rows accepted by a single
 *     CSV / Excel import. Global.
 *
 * Setting codes follow the foundation regex `^[a-z][a-z0-9_][a-z0-9_.]*[a-z0-9]$`.
 */

export const QUICK_ORDER_SETTING_CODES = {
  ONE_CLICK_BUY_ENABLED: 'quick_order.one_click_buy_enabled',
  IMPORT_MAX_ROWS: 'quick_order.import_max_rows',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'quick_order',
  groups: [{ code: 'quick_order', name: 'Quick Order' }],
  settings: [
    {
      code: QUICK_ORDER_SETTING_CODES.ONE_CLICK_BUY_ENABLED,
      name: 'One-click buy enabled',
      description:
        'When enabled, buyers with all four default ordering preferences set see a "Buy in one click" button on product pages. The per-channel value overrides the global value.',
      groupCode: 'quick_order',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS,
      name: 'Import row limit',
      description:
        'Maximum number of data rows accepted by a single CSV / Excel quick-order import. Rows beyond the limit are rejected.',
      groupCode: 'quick_order',
      valueType: 'number',
      defaultValue: 2000,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'quick_order',
  name: 'Quick Order',
  description:
    'Bulk Cart / Quote Request import (CSV + Excel, with variants), quick product search, reorder, default ordering preferences, and one-click buy.',
  version: '2.0.0',
  dependencies: [],
  settings,
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'open-quick-order',
      labelKey: 'actions.openQuickOrder.label',
      descriptionKey: 'actions.openQuickOrder.description',
      icon: 'FileUp',
      targetRoute: '/orders/quick-order',
      // The admin quick-order routes are gated on orders:write.
      requiredPermission: 'orders:write',
      keywords: ['quick order', 'import', 'csv', 'szybkie zamówienie', 'import csv'],
      weight: 226,
    },
  ],
});
