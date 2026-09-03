import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

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

/**
 * The manifest default, exported so the read that has to degrade degrades to
 * *this* binding (feature 072, D-43). `backend.ts` kept its own `2000`; the two
 * agreed, which is the drift waiting to happen.
 */
export const DEFAULT_IMPORT_MAX_ROWS = 2000;

/**
 * Same binding, for the one-click gate (issue #99). The read that has to
 * degrade degrades to *this*, not to a `false` written a second time beside the
 * manifest's `defaultValue`.
 */
export const DEFAULT_ONE_CLICK_BUY_ENABLED = false;

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
      defaultValue: DEFAULT_ONE_CLICK_BUY_ENABLED,
    },
    {
      code: QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS,
      name: 'Import row limit',
      description:
        'Maximum number of data rows accepted by a single CSV / Excel quick-order import. Rows beyond the limit are rejected.',
      groupCode: 'quick_order',
      valueType: 'number',
      defaultValue: DEFAULT_IMPORT_MAX_ROWS,
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
  //
  // Feature 075, Phase C adds `customer_accounts`: the two preference surfaces
  // read `CustomerAccount` to work out whose defaults are being managed, out of
  // a table deactivation leaves in place, so an operator switching accounts off
  // still got an answer. It fails closed at `customerAccountReadPort` now, and
  // it belongs in `dependencies` rather than `nonBindingDependencies` — a set
  // of ordering defaults resolved without knowing whose they are is worse than
  // no defaults at all.
  dependencies: [
    'addresses',
    'carts',
    'catalog',
    'customer_accounts',
    'delivery_methods',
    'orders',
    'organizations',
    'payment_methods',
    'quote_requests',
    'settings',
  ],
  // D-44 — real to the container, binding on no operator.
  nonBindingDependencies: [
    {
      moduleId: 'customers',
      name: 'customerAddressReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'a personal (buyer-owned) address stops being an eligible ordering default; the ' +
        'organisation’s shared addresses still resolve, and one-click buy hides itself for ' +
        'buyers whose default was personal',
      reason:
        'Issue #216 — the personal-address branch of the default-eligibility check reads ' +
        '`customers`’ address book, and it is probed on every eligibility question. Failing ' +
        'closed would answer 503 for the whole preference resolution, and with it one-click ' +
        'buy for *every* buyer, because a CRM surface was switched off. The degrade is not ' +
        'invented for the occasion: Principle XVII says an absent module behaves as if never ' +
        'installed, and on a platform without `customers` there are no personal addresses — ' +
        'only org-shared ones are eligible. Dropping an ineligible default to null is what ' +
        'FR-020 already specifies. Reached through a presence probe ahead of the port, per ' +
        'call, because a closed gate throws rather than answering null and an operator ' +
        'switching the module back on must not need a restart.',
    },
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
  docs: { dir: 'docs' },
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
