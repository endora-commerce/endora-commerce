/**
 * Cross-module reaches still standing in `languages` (feature 075, FR-022…FR-026;
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
 * The 5 `sql:` entries below were seeded by D-87, on the day the second predicate
 * landed. They are not new couplings — they are couplings the check could not see, because
 * raw SQL names no import specifier. Each says which port retires it.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/languages/services/language-service.ts:sql:blog/blog_category_languages':
    'D-87 seed — `languages` reads `blog`\'s `blog_category_languages` table in raw SQL. ' +
    'The statement names no import specifier, so the boundary it crosses compiles and ' +
    'returns rows. Retired by: `blog` publishing a port for it, resolved through ' +
    '`lazyPort` with `blog` declared in this module\'s manifest dependencies.',
  'modules/languages/services/language-service.ts:sql:blog/blog_post_languages':
    'D-87 seed — `languages` reads `blog`\'s `blog_post_languages` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `blog` publishing a port for it, resolved through `lazyPort` with ' +
    '`blog` declared in this module\'s manifest dependencies.',
  'modules/languages/services/language-service.ts:sql:cms/cms_pages':
    'D-87 seed — `languages` reads `cms`\'s `cms_pages` table in raw SQL. The statement ' +
    'names no import specifier, so the boundary it crosses compiles and returns rows. ' +
    'Retired by: `cmsPageReadPort`, resolved through `lazyPort` with `cms` declared in ' +
    'this module\'s manifest dependencies.',
  'modules/languages/services/language-service.ts:sql:kernel/sales_channels':
    'D-87 seed — `languages` reads the kernel\'s `sales_channels` table in raw SQL, so the ' +
    'read is invisible to the import predicate and to the request-channel resolver alike. ' +
    'Retired by: the resolved request channel plus `salesChannelsCache` / ' +
    '`salesChannelsService`, whichever the statement is actually asking for.',
  'modules/languages/services/language-service.ts:sql:megamenu/megamenu_bindings':
    'D-87 seed — `languages` reads `megamenu`\'s `megamenu_bindings` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `megamenu` publishing a port for it, resolved through `lazyPort` ' +
    'with `megamenu` declared in this module\'s manifest dependencies.',
};
