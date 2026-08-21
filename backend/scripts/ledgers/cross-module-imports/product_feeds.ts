/**
 * Cross-module reaches still standing in `product_feeds` (feature 075, FR-022…FR-026;
 * feature 077, D-87).
 *
 * Keyed `<path under src/>:<target module>/<target path>` for an import and
 * `<path under src/>:sql:<owner>/<table>` for a raw SQL statement, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 *
 * The `product_categories` reach is gone: `catalogCategoryReadPort` has answered "which
 * categories are these products in?" since D-87, and the hydration batch asks it. The
 * gallery read below is the harder half of the same file, and it says why.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/product_feeds/services/feed-generation.service.ts:sql:catalog/gallery_items':
    'D-87 seed — a feed item\'s `imageUrls` are the product\'s gallery in position order, ' +
    'read as `select product_id, asset_id, position from gallery_items where product_id in ' +
    '(…)` over a whole hydration batch. The statement names no import specifier, so the ' +
    'boundary it crosses compiles and returns rows. `catalogGalleryPort` exists and is not ' +
    'the answer as it stands: it is `list(productId)`, which validates the product and then ' +
    'runs two queries per call, so a batch of 500 products would cost 1500 round-trips in ' +
    'place of one — and a feed run walks the whole sellable catalogue. The asset **ids** are ' +
    'also all this caller wants, because the urls come from `resolvePublicImageUrls`, which ' +
    'already asks `assets_library`. Retired by: a batch method on `catalogGalleryPort` — the ' +
    'gallery items of these products, ordered — which is a `catalog`-side addition and ' +
    'belongs in a `catalog` merge request; feature 086 holds that module while this shard is ' +
    'drained.',
};
