/**
 * Cross-module imports still standing in `product_feeds` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/product_feeds/services/feed-generation.service.ts:sql:catalog/gallery_items':
    'D-87 seed — `product_feeds` reads `catalog`\'s `gallery_items` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `catalogGalleryPort`, resolved through `lazyPort` with `catalog` ' +
    'declared in this module\'s manifest dependencies.',
  'modules/product_feeds/services/feed-generation.service.ts:sql:catalog/product_categories':
    'D-87 seed — `product_feeds` reads `catalog`\'s `product_categories` table in raw SQL. ' +
    'The statement names no import specifier, so the boundary it crosses compiles and ' +
    'returns rows. Retired by: `catalogCategoryReadPort`, resolved through `lazyPort` ' +
    'with `catalog` declared in this module\'s manifest dependencies.',
};
