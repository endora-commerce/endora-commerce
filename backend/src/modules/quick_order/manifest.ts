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
  // Feature 072 (T139) — the six edges the module actually resolves, declared
  // now that it composes itself rather than being mounted by `shopping_lists`.
  // `carts`, `catalog`, `orders`, `organizations` and `quote_requests` were all
  // reached before through options the host passed down, which is why none of
  // them appeared here.
  dependencies: [
    'addresses',
    'carts',
    'catalog',
    'delivery_methods',
    'orders',
    'organizations',
    'payment_methods',
    'quote_requests',
    'settings',
  ],
  // Feature 073 (Constitution XVII) — its own activation control at last.
  // Until T139 this module had no presence of its own: `shopping_lists` mounted
  // its routes, so `shopping_lists.enabled` switched both off together and
  // there was no way to run CSV import without shopping lists, or the reverse.
  // Deactivatable, and not close to the line — bulk import, reorder and
  // one-click buy are a convenience layer over ordering, and a deployment whose
  // buyers order line by line is an ordinary one.
  activation: { settingCode: 'quick_order.enabled', default: true },
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
