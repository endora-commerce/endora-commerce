/**
 * Cross-module reaches still standing in `dictionaries` (feature 075, FR-022…FR-026;
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
 * The 16 `sql:` entries below were seeded by D-87, on the day the second predicate
 * landed. They are not new couplings — they are couplings the check could not see, because
 * raw SQL names no import specifier. Each says which port retires it.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/dictionaries/routes.admin.ts:sql:addresses/addresses':
    'D-87 seed — `dictionaries` reads `addresses`\'s `addresses` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `addressReadPort`, resolved through `lazyPort` with `addresses` ' +
    'declared in this module\'s manifest dependencies.',
  'modules/dictionaries/routes.admin.ts:sql:blog/blog_category_languages':
    'D-87 seed — `dictionaries` reads `blog`\'s `blog_category_languages` table in raw ' +
    'SQL. The statement names no import specifier, so the boundary it crosses compiles ' +
    'and returns rows. Retired by: `blog` publishing a port for it, resolved through ' +
    '`lazyPort` with `blog` declared in this module\'s manifest dependencies.',
  'modules/dictionaries/routes.admin.ts:sql:blog/blog_post_languages':
    'D-87 seed — `dictionaries` reads `blog`\'s `blog_post_languages` table in raw SQL. ' +
    'The statement names no import specifier, so the boundary it crosses compiles and ' +
    'returns rows. Retired by: `blog` publishing a port for it, resolved through ' +
    '`lazyPort` with `blog` declared in this module\'s manifest dependencies.',
  'modules/dictionaries/routes.admin.ts:sql:currencies/currencies':
    'D-87 seed — `dictionaries` reads `currencies`\'s `currencies` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `currencyReadPort`, resolved through `lazyPort` with `currencies` ' +
    'declared in this module\'s manifest dependencies.',
  'modules/dictionaries/routes.admin.ts:sql:inventory/warehouses':
    'D-87 seed — `dictionaries` reads `inventory`\'s `warehouses` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `inventoryStockReadPort`, resolved through `lazyPort` with ' +
    '`inventory` declared in this module\'s manifest dependencies.',
  'modules/dictionaries/routes.admin.ts:sql:kernel/sales_channels':
    'D-87 seed — `dictionaries` reads the kernel\'s `sales_channels` table in raw SQL, so ' +
    'the read is invisible to the import predicate and to the request-channel resolver ' +
    'alike. Retired by: the resolved request channel plus `salesChannelsCache` / ' +
    '`salesChannelsService`, whichever the statement is actually asking for.',
  'modules/dictionaries/routes.admin.ts:sql:languages/languages':
    'D-87 seed — `dictionaries` reads `languages`\'s `languages` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `languageReadPort`, resolved through `lazyPort` with `languages` ' +
    'declared in this module\'s manifest dependencies.',
  'modules/dictionaries/routes.admin.ts:sql:megamenu/megamenu_bindings':
    'D-87 seed — `dictionaries` reads `megamenu`\'s `megamenu_bindings` table in raw SQL. ' +
    'The statement names no import specifier, so the boundary it crosses compiles and ' +
    'returns rows. Retired by: `megamenu` publishing a port for it, resolved through ' +
    '`lazyPort` with `megamenu` declared in this module\'s manifest dependencies.',
  'modules/dictionaries/routes.admin.ts:sql:organizations/organizations':
    'D-87 seed — `dictionaries` reads `organizations`\'s `organizations` table in raw SQL. ' +
    'The statement names no import specifier, so the boundary it crosses compiles and ' +
    'returns rows. Retired by: `organizationReadPort`, resolved through `lazyPort` with ' +
    '`organizations` declared in this module\'s manifest dependencies.',
  'modules/dictionaries/routes.admin.ts:sql:promotions/promotions':
    'D-87 seed — `dictionaries` reads `promotions`\'s `promotions` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `promotionService`, resolved through `lazyPort` with `promotions` ' +
    'declared in this module\'s manifest dependencies.',
  'modules/dictionaries/routes.admin.ts:sql:taxes/taxes':
    'D-87 seed — `dictionaries` reads `taxes`\'s `taxes` table in raw SQL. The statement ' +
    'names no import specifier, so the boundary it crosses compiles and returns rows. ' +
    'Retired by: `taxService`, resolved through `lazyPort` with `taxes` declared in this ' +
    'module\'s manifest dependencies.',
  'modules/dictionaries/services/country-service.ts:sql:addresses/addresses':
    'D-87 seed — `dictionaries` reads `addresses`\'s `addresses` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `addressReadPort`, resolved through `lazyPort` with `addresses` ' +
    'declared in this module\'s manifest dependencies.',
  'modules/dictionaries/services/country-service.ts:sql:organizations/organizations':
    'D-87 seed — `dictionaries` reads `organizations`\'s `organizations` table in raw SQL. ' +
    'The statement names no import specifier, so the boundary it crosses compiles and ' +
    'returns rows. Retired by: `organizationReadPort`, resolved through `lazyPort` with ' +
    '`organizations` declared in this module\'s manifest dependencies.',
  'modules/dictionaries/services/country-service.ts:sql:taxes/taxes':
    'D-87 seed — `dictionaries` reads `taxes`\'s `taxes` table in raw SQL. The statement ' +
    'names no import specifier, so the boundary it crosses compiles and returns rows. ' +
    'Retired by: `taxService`, resolved through `lazyPort` with `taxes` declared in this ' +
    'module\'s manifest dependencies.',
  'modules/dictionaries/services/seed-reconciler.ts:sql:currencies/currencies':
    'D-87 seed — `dictionaries` reads `currencies`\'s `currencies` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `currencyReadPort`, resolved through `lazyPort` with `currencies` ' +
    'declared in this module\'s manifest dependencies.',
  'modules/dictionaries/services/seed-reconciler.ts:sql:languages/languages':
    'D-87 seed — `dictionaries` reads `languages`\'s `languages` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `languageReadPort`, resolved through `lazyPort` with `languages` ' +
    'declared in this module\'s manifest dependencies.',
};
