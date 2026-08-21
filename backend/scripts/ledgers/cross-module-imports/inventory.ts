/**
 * Cross-module reaches still standing in `inventory` (feature 075,
 * FR-022…FR-026; feature 077, D-87; issue #187).
 *
 * Keyed `<path under src/>:<target module>/<target path>` for an import and
 * `<path under src/>:sql:<owner>/<table>` for a raw statement or a query builder, so
 * moving code inside a file does not invalidate an entry and re-opening a hole does not
 * silently inherit one.
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer describes one
 * fails it too. Delete this file when the last entry goes; an empty shard is refused,
 * because a done signal that says nothing is not one.
 *
 * Where a file reaches one target more than once, the entry is `{ sites, reason }` and the
 * number is checked both ways (issue #267); a plain string means one. The key does not
 * change with the count — that is what keeps it stable across a move inside the file.
 *
 * **Three of the four issue-#187 reaches are gone.** All three read
 * `product_categories`, and all three sat beside a `catalogCategoryReadPort` call that was
 * already asking the owner the *next* question — so retiring them needed nothing published:
 * `listAssignmentsForProducts` has answered "which categories are these products in?" since
 * D-87, and the three sites now ask it. What is left is the one reach in the shard that a
 * batch read cannot retire, because it is not a lookup at all.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/inventory/services/stock-level-service.ts:sql:catalog/products':
    'Issue #187 seed — the admin stock roster paginates with ' +
    '`knex({ p: \'products\' }).innerJoin({ sl: \'stock_levels\' }, …)`, joining `catalog`\'s ' +
    '`products` to this module\'s `stock_levels`. It is the one reach in this shard that is ' +
    'not a lookup: the join is what pushes the SKU/name/id search **and** the low/out ' +
    'filters into SQL, and both filters are predicates over `products.manage_stock` and ' +
    '`products.low_stock_threshold` evaluated in a `HAVING` against `SUM(sl.on_hand)` — a ' +
    'condition that spans one table each way, so neither side can answer it alone. Post-' +
    'filtering in JS is not the repair either: `total` and the page would then be computed ' +
    'over rows the filter later drops, so the count an operator is shown would stop matching ' +
    'the list under it. The aliasing object form is why the D-94 grep missed it. ' +
    'Retired by: `catalog` publishing the paged product-id read this list needs — a search ' +
    'term, an id filter, and the two stock-governing columns exposed so the predicate can be ' +
    'evaluated over ids the owner returned. That is a `catalog`-side decision and belongs in ' +
    'a `catalog` merge request; feature 086 holds that module while this shard is drained.',
};
