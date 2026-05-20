import {
  Activity,
  Archive,
  Box,
  CircleDollarSign,
  Edit,
  Plus,
  Tag,
  Truck,
  Upload,
  type LucideIcon,
} from 'lucide-react';

/**
 * Feature 024 — pure mapping from a Recent-Activity action token to the
 * lucide-react icon + the i18n key used to render its verb.
 *
 * Kept as a pure data table so it is trivial to unit-test (one entry per
 * token in the server-side allowlist) and trivial to extend when a new
 * token lands. Unknown tokens fall through to the `UNKNOWN_RENDERING`
 * fallback so a future audit-token shipped before the catalog updates
 * still renders without crashing the card (spec FR-024).
 */

export interface ActivityRendering {
  icon: LucideIcon;
  /** i18n key under scope `core`, e.g. `home.activity.verb.product.create`. */
  verbKey: string;
  module: 'catalog' | 'inventory' | 'price_lists';
}

export const ACTIVITY_RENDERING: Record<string, ActivityRendering> = {
  // ----- catalog -----
  'product.create': { icon: Plus, verbKey: 'home.activity.verb.product.create', module: 'catalog' },
  'product.update': { icon: Edit, verbKey: 'home.activity.verb.product.update', module: 'catalog' },
  'product.archive': { icon: Archive, verbKey: 'home.activity.verb.product.archive', module: 'catalog' },
  'product.unarchive': { icon: Box, verbKey: 'home.activity.verb.product.unarchive', module: 'catalog' },
  'product.bulk_update': { icon: Edit, verbKey: 'home.activity.verb.product.bulk_update', module: 'catalog' },
  // ----- inventory -----
  'warehouse.create': { icon: Truck, verbKey: 'home.activity.verb.warehouse.create', module: 'inventory' },
  'warehouse.update': { icon: Edit, verbKey: 'home.activity.verb.warehouse.update', module: 'inventory' },
  'warehouse.deactivate': { icon: Archive, verbKey: 'home.activity.verb.warehouse.deactivate', module: 'inventory' },
  'warehouse.reactivate': { icon: Truck, verbKey: 'home.activity.verb.warehouse.reactivate', module: 'inventory' },
  'stock_level.adjust': { icon: Box, verbKey: 'home.activity.verb.stock_level.adjust', module: 'inventory' },
  'stock_level.bulk_import': { icon: Upload, verbKey: 'home.activity.verb.stock_level.bulk_import', module: 'inventory' },
  'low_stock_threshold.create': { icon: Tag, verbKey: 'home.activity.verb.low_stock_threshold.create', module: 'inventory' },
  'low_stock_threshold.update': { icon: Edit, verbKey: 'home.activity.verb.low_stock_threshold.update', module: 'inventory' },
  'low_stock_threshold.delete': { icon: Archive, verbKey: 'home.activity.verb.low_stock_threshold.delete', module: 'inventory' },
  // ----- price lists -----
  'price_list.create': { icon: CircleDollarSign, verbKey: 'home.activity.verb.price_list.create', module: 'price_lists' },
  'price_list.update': { icon: Edit, verbKey: 'home.activity.verb.price_list.update', module: 'price_lists' },
  'price_list.activate': { icon: CircleDollarSign, verbKey: 'home.activity.verb.price_list.activate', module: 'price_lists' },
  'price_list.draftify': { icon: Edit, verbKey: 'home.activity.verb.price_list.draftify', module: 'price_lists' },
  'price_list.duplicate': { icon: Plus, verbKey: 'home.activity.verb.price_list.duplicate', module: 'price_lists' },
  'price_list.expire': { icon: Archive, verbKey: 'home.activity.verb.price_list.expire', module: 'price_lists' },
  'price_list.products_replace': { icon: Edit, verbKey: 'home.activity.verb.price_list.products_replace', module: 'price_lists' },
  'price_list.bracket_update': { icon: CircleDollarSign, verbKey: 'home.activity.verb.price_list.bracket_update', module: 'price_lists' },
};

export const UNKNOWN_RENDERING: ActivityRendering = {
  icon: Activity,
  verbKey: 'home.activity.verb.unknown',
  module: 'catalog',
};

/**
 * Resolve the icon + verb-i18n-key for an action token. Falls through to
 * UNKNOWN_RENDERING when the token is not in the static catalog, so the
 * UI never crashes if a future audit emission is unknown to the admin
 * (FR-024).
 */
export function renderActivity(action: string): ActivityRendering {
  return ACTIVITY_RENDERING[action] ?? UNKNOWN_RENDERING;
}

/**
 * Pure formatter — relative-time pill for an ISO 8601 timestamp.
 * Returns the i18n key + interpolation params for the caller's `t(...)`.
 * Separated from the component so it is unit-testable without a DOM.
 */
export function formatRelative(actedAtIso: string, now = Date.now()): {
  key: string;
  params?: Record<string, string | number>;
} {
  const acted = Date.parse(actedAtIso);
  if (!Number.isFinite(acted)) return { key: 'home.activity.time.justNow' };
  const deltaMs = Math.max(0, now - acted);
  if (deltaMs < 60_000) return { key: 'home.activity.time.justNow' };
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return { key: 'home.activity.time.minutesAgo', params: { count: minutes } };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: 'home.activity.time.hoursAgo', params: { count: hours } };
  const days = Math.floor(hours / 24);
  if (days === 1) return { key: 'home.activity.time.yesterday' };
  return { key: 'home.activity.time.daysAgo', params: { count: days } };
}
