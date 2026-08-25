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
    'not a lookup, and the aliasing object form is why the D-94 grep missed it.\n\n' +
    '**Read again for the T077 SQL sweep, and the seed\'s retiring condition does not hold.** ' +
    'It proposed "`catalog` publishing the paged product-id read this list needs". There is ' +
    'no such read, because the thing being pushed into SQL is not a *read* — it is a ' +
    '**predicate whose two operands have different owners**: ' +
    '`HAVING "p"."manage_stock" IS NOT FALSE AND COALESCE(SUM("sl"."on_hand"), 0) <= 0`, and ' +
    'the low variant comparing that same aggregate against `"p"."low_stock_threshold"`. One ' +
    'operand is this module\'s aggregate over its own rows, the other is a column of the ' +
    'owner\'s, and they are compared once per group. No port signature carries a per-row ' +
    'comparison between two owners\' columns; a port that returned the columns so the caller ' +
    'could do the comparing is the join with an extra hop, and a port that took the aggregate ' +
    'so the owner could do it is this module shipping its rows into someone else\'s query. ' +
    'That is the design finding, and it is why forcing a port here would be worse than the ' +
    'reach.\n\n' +
    '**The search term is a second, independent obstacle, and it was not noticed before.** ' +
    'The `q` filter is `LOWER("p"."name"::text) LIKE ?` — and `Product.name` is JSONB ' +
    '(`Record<string, string>`, one entry per language). Cast to text it matches every ' +
    'language\'s value, the language codes and the JSON punctuation alike. That is an ' +
    'implementation accident, not a contract, so `catalog` publishing "search products by ' +
    'sku, name or id" either publishes the accident or quietly changes what the operator\'s ' +
    'search box matches. Whichever it is, it is a product decision about the search, not a ' +
    'boundary repair.\n\n' +
    '**One exit does exist and is priced here rather than left to be rediscovered.** Group ' +
    '`stock_levels` alone (`product_id`, `SUM(on_hand)`, `MAX(updated_at)` — all this ' +
    'module\'s), ask `catalog` for the governance facts of the candidates, then filter, order ' +
    'and page in memory. **Correctness is preserved exactly**, which the seed reason denied: ' +
    'the filter runs over the complete candidate set before `total` is counted and before the ' +
    'page is cut, so the count an operator is shown keeps matching the list under it, and the ' +
    'ordering column is this module\'s. What it costs is that the two filtered paths stop ' +
    'stopping at `LIMIT` and load one row per tracked product. Worth knowing before pricing ' +
    'that as prohibitive: `listLandingKpis`, forty lines up in this same file, already does ' +
    'exactly that unconditionally — every `stock_levels` group plus `findByIds` over all of ' +
    'them — on the screen this roster is reached from. So it is a cost this surface already ' +
    'carries, which is as much an argument for repairing that method as for taking this ' +
    'exit.\n\n' +
    'Retired by: `catalog`\'s owner choosing between that exit and a published product search ' +
    'with a stated matching rule. The seed said "feature 086 holds that module while this ' +
    'shard is drained"; that hold has lifted — the viewer-price listing work merged — so what ' +
    'is left is the design call above and not a scheduling one.',
};
