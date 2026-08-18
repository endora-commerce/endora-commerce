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
 * The shard exists because of issue #187: all four reaches below are knex query builders,
 * which name their table as a call argument, so neither the import predicate nor D-87's
 * statement path could see them. They are not new couplings — they are couplings the check
 * could not see, and three of the four sit beside a `catalogCategoryReadPort` call that
 * already asks `catalog` the next question.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/inventory/routes.ts:sql:catalog/product_categories':
    'Issue #187 seed — the availability route reads `catalog`\'s `product_categories` with ' +
    '`knex(\'product_categories\').where(\'product_id\', …)` to find the categories a ' +
    'product belongs to, and then hands the ids straight to `catalogCategories.findByIds`. ' +
    'The port is already resolved on the line below the builder and `catalog` is already ' +
    'declared in this module\'s manifest; what is missing is the first half of the ' +
    'question. Retired by: `catalogCategoryReadPort` answering "which categories does this ' +
    'product belong to?" itself, so the join table stays inside its owner.',
  'modules/inventory/services/stock-level-service.ts:sql:catalog/product_categories':
    'Issue #187 seed — the same read as the route\'s, twice: the stock list and the ' +
    'low-stock report each page `catalog`\'s `product_categories` with ' +
    '`knex(\'product_categories\').whereIn(\'product_id\', …)` and then resolve the ' +
    'category rows through `catalogCategories.findByIds`. Retired by: the batch form of ' +
    'the same port method the route needs — "the category ids of these products" — so both ' +
    'sites lose the builder together.',
  'modules/inventory/services/stock-level-service.ts:sql:catalog/products':
    'Issue #187 seed — the stock list pages with `knex({ p: \'products\' }).innerJoin({ ' +
    'sl: \'stock_levels\' }, …)`, joining `catalog`\'s `products` to this module\'s ' +
    '`stock_levels` so the SKU/name search and the low/out filters are pushed into SQL ' +
    'rather than post-filtered in JS (the comment above the query says exactly that). It ' +
    'is the one reach in this shard with a performance reason, and the aliasing object ' +
    'form is why the D-94 grep missed it. Retired by: `catalog` publishing the paged ' +
    'product-id read this list needs (search term plus id filter, ordered), leaving the ' +
    'stock join to run over ids `catalog` returned.',
  'modules/inventory/services/warehouse-channel-reconciler.ts:sql:kernel/sales_channels':
    'Issue #187 seed — the boot reconciler lists every channel with ' +
    '`knex<ChannelRow>(\'sales_channels\').select(\'id\')` before backfilling the default ' +
    'warehouse assignment each one is missing. The kernel owns `sales_channels`, and this ' +
    'is the only place in the module that reads it without the resolver. Retired by: the ' +
    'kernel\'s sales-channel service listing the channels, which is the same accessor ' +
    'Principle XII names for every other channel read.',
};
