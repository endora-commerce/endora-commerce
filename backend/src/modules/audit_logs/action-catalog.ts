/**
 * Feature 024 — Dashboard "Recent Activity".
 *
 * Server-side allowlist (curated set of audit action tokens) that the new
 * `/api/v1/admin/audit-log/recent-activity` endpoint surfaces on the
 * admin home dashboard. Anything not listed here is invisible to the card.
 *
 * Curation lives here (not on the client) so a typo or a future audit
 * token cannot accidentally leak onto the dashboard until it is
 * intentionally added to this file.
 *
 * Source modules: Catalog, Inventory, Price Lists, and (feature 043) the
 * prompt assistant's execution summaries.
 */

export const RECENT_ACTIVITY_ACTIONS = [
  // catalog
  'product.create',
  'product.update',
  'product.archive',
  'product.delete',
  'product.unarchive',
  'product.bulk_update',
  // inventory
  'warehouse.create',
  'warehouse.update',
  'warehouse.deactivate',
  'warehouse.reactivate',
  'low_stock_threshold.create',
  'low_stock_threshold.update',
  'low_stock_threshold.delete',
  'stock_level.adjust',
  'stock_level.bulk_import',
  // price lists
  'price_list.create',
  'price_list.update',
  'price_list.activate',
  'price_list.draftify',
  'price_list.duplicate',
  'price_list.expire',
  'price_list.products_replace',
  'price_list.bracket_update',
  // prompt assistant (feature 043)
  'prompt_action.execute',
] as const;

export type RecentActivityAction = (typeof RECENT_ACTIVITY_ACTIONS)[number];

export type RecentActivityModule = 'catalog' | 'inventory' | 'price_lists' | 'prompt_actions';

const PREFIX_TO_MODULE: ReadonlyArray<readonly [string, RecentActivityModule]> = [
  ['product.', 'catalog'],
  ['warehouse.', 'inventory'],
  ['stock_level.', 'inventory'],
  ['low_stock_threshold.', 'inventory'],
  ['price_list.', 'price_lists'],
  ['prompt_action.', 'prompt_actions'],
];

/**
 * Classify a recent-activity action by its source module. Pure function,
 * no DB lookup. Used both by the server resolver (to set the response
 * `module` field) and by tests (to assert every token in the allowlist
 * maps to exactly one of the three in-scope modules).
 */
export function moduleForAction(action: RecentActivityAction): RecentActivityModule {
  for (const [prefix, mod] of PREFIX_TO_MODULE) {
    if (action.startsWith(prefix)) return mod;
  }
  // Defensive: unreachable as long as the allowlist and the prefix table
  // stay aligned. Throwing here surfaces the misalignment in tests.
  throw new Error(`No module mapping for recent-activity action: ${action}`);
}

/**
 * Whether the given raw action string is part of the curated allowlist.
 * Useful when we have an `action: string` from the DB and want to know
 * whether to surface it on the dashboard.
 */
export function isRecentActivityAction(action: string): action is RecentActivityAction {
  return (RECENT_ACTIVITY_ACTIONS as ReadonlyArray<string>).includes(action);
}
