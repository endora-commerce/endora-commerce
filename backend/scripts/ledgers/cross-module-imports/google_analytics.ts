/**
 * Cross-module reaches still standing in `google_analytics` (feature 075, FR-022…FR-026;
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
 * Where a file reaches one target more than once, the entry is `{ sites, reason }` and the
 * number is checked both ways (issue #267); a plain string means one. The key does not
 * change with the count — that is what keeps it stable across a move inside the file.
 *
 * The 3 `sql:` entries below were seeded by D-87, on the day the second predicate
 * landed. They are not new couplings — they are couplings the check could not see, because
 * raw SQL names no import specifier. Each says which port retires it.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/google_analytics/services/cookie-consent-block-seeder.ts:sql:cms/cms_block_sales_channels':
    'D-87 seed — `google_analytics` writes `cms`\'s `cms_block_sales_channels` table in ' +
    'raw SQL. The statement names no import specifier, so the boundary it crosses ' +
    'compiles and returns rows. Retired by: `cms` publishing a port for it, resolved ' +
    'through `lazyPort` with `cms` declared in this module\'s manifest dependencies.',
  'modules/google_analytics/services/cookie-consent-block-seeder.ts:sql:cms/cms_blocks': {
    sites: 2,
    reason:
      'D-87 seed — `google_analytics` reads `cms`\'s `cms_blocks` table in raw SQL. The ' +
      'statement names no import specifier, so the boundary it crosses compiles and returns ' +
      'rows. Retired by: `cms` publishing a port for it, resolved through `lazyPort` with ' +
      '`cms` declared in this module\'s manifest dependencies.',
  },
};
