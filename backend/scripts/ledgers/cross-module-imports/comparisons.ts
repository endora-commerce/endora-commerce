/**
 * Cross-module reaches still standing in `comparisons` (feature 075, FR-022…FR-026;
 * feature 077, D-87).
 *
 * Keyed `<path under src/>:<target module>/<target path>` for an import and
 * `<path under src/>:sql:<owner>/<table>` for a raw SQL statement, so moving code inside a
 * file does not invalidate an entry and re-opening a hole does not silently inherit one.
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer describes one
 * fails it too. Delete this file when the last entry goes; an empty shard is refused,
 * because a done signal that says nothing is not one.
 *
 * **The three entries are one statement**, and that is the thing to know before touching
 * any of them. `loadBaseImageUrls` is a single three-table join —
 * `gallery_item_labels` → `gallery_items` → `assets` — that answers one question: the base
 * image url of each product on a comparison. Two of the tables are `catalog`'s and the
 * third is `assets_library`'s, so the *same* statement is three reaches. Retiring it
 * retires all three at once; retiring two of them separately is not possible, because a
 * join cannot be half replaced.
 *
 * The reasons below were D-87's seed text and named ports that do not, in fact, answer
 * this — corrected here so the next author does not start down that path (feature 075).
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

const BASE_IMAGE_JOIN =
  'D-87 seed, corrected — `ComparisonService.loadBaseImageUrls` runs one statement joining ' +
  '`catalog`\'s `gallery_item_labels` and `gallery_items` to `assets_library`\'s `assets`, ' +
  'to put a base-image url on each product column of a comparison. The statement names no ' +
  'import specifier, so the boundary it crosses compiles and returns rows. ' +
  '**`catalogGalleryPort` does not retire it as it stands**, and the seed text saying it ' +
  'would was wrong three ways: the port is `list(productId)`, so a 16-product comparison ' +
  'costs 16 calls where one statement runs today; `GalleryItem` carries `assetId` and no ' +
  'url, so the `assets` reach would survive the conversion it was supposed to remove; and ' +
  '`list` asserts the product exists first, so a comparison holding a product that has ' +
  'since been removed — a row this service deliberately still renders as ' +
  '`(removed product)` — would answer 404 for the whole view. The label semantics differ ' +
  'too: this service wants `base_image` **only** (spec FR-006 names it), where `catalog`\'s ' +
  'own `resolvePrimaryAssetUrls` walks thumbnail → base_image → first. ' +
  'Retired by: a batch method on `catalogGalleryPort` — the base-image url of each of these ' +
  'products, tolerating ids that no longer resolve — which `catalog` can answer without a ' +
  'join leaving its own tables, since it already holds `assetReadPort` for the url. That is ' +
  'a `catalog`-side addition and belongs in a `catalog` merge request; feature 086 holds ' +
  'that module while this shard is drained.';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/comparisons/services/comparison-service.ts:sql:assets_library/assets': BASE_IMAGE_JOIN,
  'modules/comparisons/services/comparison-service.ts:sql:catalog/gallery_item_labels':
    BASE_IMAGE_JOIN,
  'modules/comparisons/services/comparison-service.ts:sql:catalog/gallery_items': BASE_IMAGE_JOIN,
};
