/**
 * Cross-module reaches still standing in `sales_channels` (feature 075, FR-022…FR-026;
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
 * The 7 `sql:` entries below were seeded by D-87, on the day the second predicate
 * landed. They are not new couplings — they are couplings the check could not see, because
 * raw SQL names no import specifier. Each says which port retires it.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/sales_channels/scripts/backfill-quote-channel.ts:sql:kernel/sales_channels':
    'D-87 seed — `sales_channels` reads the kernel\'s `sales_channels` table in raw SQL, ' +
    'so the read is invisible to the import predicate and to the request-channel resolver ' +
    'alike. Retired by: the resolved request channel plus `salesChannelsCache` / ' +
    '`salesChannelsService`, whichever the statement is actually asking for.',
  'modules/sales_channels/scripts/backfill-quote-channel.ts:sql:quote_requests/quote_requests':
    'D-87 seed — `sales_channels` writes `quote_requests`\'s `quote_requests` table in raw ' +
    'SQL. The statement names no import specifier, so the boundary it crosses compiles ' +
    'and returns rows. Retired by: `quoteRequestReadPort`, resolved through `lazyPort` ' +
    'with `quote_requests` declared in this module\'s manifest dependencies.',
  'modules/sales_channels/services/sales-channels.service.ts:sql:currencies/currencies':
    'D-87 seed — `sales_channels` reads `currencies`\'s `currencies` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `currencyReadPort`, resolved through `lazyPort` with `currencies` ' +
    'declared in this module\'s manifest dependencies.',
  'modules/sales_channels/services/sales-channels.service.ts:sql:kernel/sales_channels':
    'D-87 seed — `sales_channels` reads the kernel\'s `sales_channels` table in raw SQL, ' +
    'so the read is invisible to the import predicate and to the request-channel resolver ' +
    'alike. Retired by: the resolved request channel plus `salesChannelsCache` / ' +
    '`salesChannelsService`, whichever the statement is actually asking for.',
  'modules/sales_channels/services/sales-channels.service.ts:sql:languages/languages':
    'D-87 seed — `sales_channels` reads `languages`\'s `languages` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `languageReadPort`, resolved through `lazyPort` with `languages` ' +
    'declared in this module\'s manifest dependencies.',
  'modules/sales_channels/services/sales-channels.service.ts:sql:orders/orders':
    'D-87 seed — `sales_channels` reads `orders`\'s `orders` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `orderReadPort`, resolved through `lazyPort` with `orders` ' +
    'declared in this module\'s manifest dependencies.',
  'modules/sales_channels/services/sales-channels.service.ts:sql:quote_requests/quote_requests':
    'D-87 seed — `sales_channels` reads `quote_requests`\'s `quote_requests` table in raw ' +
    'SQL. The statement names no import specifier, so the boundary it crosses compiles ' +
    'and returns rows. Retired by: `quoteRequestReadPort`, resolved through `lazyPort` ' +
    'with `quote_requests` declared in this module\'s manifest dependencies.',
};
