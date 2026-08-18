/**
 * Cross-module reaches still standing in `audit_logs` (feature 075, FR-022…FR-026;
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
 * The 6 `sql:` entries below were seeded by D-87, on the day the second predicate
 * landed. They are not new couplings — they are couplings the check could not see, because
 * raw SQL names no import specifier. Each says which port retires it.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/audit_logs/services/recent-activity-service.ts:sql:admin_users/admin_users':
    'D-87 seed — `audit_logs` reads `admin_users`\'s `admin_users` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `adminUserReadPort`, resolved through `lazyPort` with ' +
    '`admin_users` declared in this module\'s manifest dependencies.',
  'modules/audit_logs/services/recent-activity-service.ts:sql:catalog/products':
    'D-87 seed — `audit_logs` reads `catalog`\'s `products` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `catalogProductReadPort`, resolved through `lazyPort` with ' +
    '`catalog` declared in this module\'s manifest dependencies.',
  'modules/audit_logs/services/recent-activity-service.ts:sql:customer_accounts/customer_accounts':
    'D-87 seed — `audit_logs` reads `customer_accounts`\'s `customer_accounts` table in ' +
    'raw SQL. The statement names no import specifier, so the boundary it crosses ' +
    'compiles and returns rows. Retired by: `customerAccountReadPort`, resolved through ' +
    '`lazyPort` with `customer_accounts` declared in this module\'s manifest dependencies.',
  'modules/audit_logs/services/recent-activity-service.ts:sql:inventory/warehouses':
    'D-87 seed — `audit_logs` reads `inventory`\'s `warehouses` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `inventoryStockReadPort`, resolved through `lazyPort` with ' +
    '`inventory` declared in this module\'s manifest dependencies.',
  'modules/audit_logs/services/recent-activity-service.ts:sql:organizations/organizations':
    'D-87 seed — `audit_logs` reads `organizations`\'s `organizations` table in raw SQL. ' +
    'The statement names no import specifier, so the boundary it crosses compiles and ' +
    'returns rows. Retired by: `organizationReadPort`, resolved through `lazyPort` with ' +
    '`organizations` declared in this module\'s manifest dependencies.',
  'modules/audit_logs/services/recent-activity-service.ts:sql:price_lists/price_lists':
    'D-87 seed — `audit_logs` reads `price_lists`\'s `price_lists` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `priceListReadPort`, resolved through `lazyPort` with ' +
    '`price_lists` declared in this module\'s manifest dependencies.',
};
