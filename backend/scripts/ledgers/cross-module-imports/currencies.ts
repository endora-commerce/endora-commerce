/**
 * Cross-module reaches still standing in `currencies` (feature 075, FR-022…FR-026;
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
 * The 4 `sql:` entries below were seeded by D-87, on the day the second predicate
 * landed. They are not new couplings — they are couplings the check could not see, because
 * raw SQL names no import specifier. Each says which port retires it.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/currencies/services/currency-service.ts:sql:dictionaries/countries':
    'D-87 seed — `currencies` reads `dictionaries`\'s `countries` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `dictionaries` publishing a port for it, resolved through ' +
    '`lazyPort` with `dictionaries` declared in this module\'s manifest dependencies.',
  'modules/currencies/services/currency-service.ts:sql:kernel/sales_channels':
    'D-87 seed — `currencies` reads the kernel\'s `sales_channels` table in raw SQL, so ' +
    'the read is invisible to the import predicate and to the request-channel resolver ' +
    'alike. Retired by: the resolved request channel plus `salesChannelsCache` / ' +
    '`salesChannelsService`, whichever the statement is actually asking for.',
  'modules/currencies/services/currency-service.ts:sql:price_lists/price_lists':
    'D-87 seed — `currencies` reads `price_lists`\'s `price_lists` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `priceListReadPort`, resolved through `lazyPort` with ' +
    '`price_lists` declared in this module\'s manifest dependencies.',
  'modules/currencies/services/currency-service.ts:sql:promotions/promotions':
    'D-87 seed — `currencies` reads `promotions`\'s `promotions` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `promotionService`, resolved through `lazyPort` with `promotions` ' +
    'declared in this module\'s manifest dependencies.',
};
