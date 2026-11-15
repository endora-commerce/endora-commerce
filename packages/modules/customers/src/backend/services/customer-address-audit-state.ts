/**
 * What an entry about a row of the retired personal address book may say (issue
 * #470, D-288; `specs/conventions/audit-state.md`).
 *
 * A `CustomerAddress` is `@CustomerScoped` and the platform audit log is one global
 * table read under `audit_log:read` without Organization reach, so the retirement
 * job's and the retention sweep's entries carry **names and structure**: the row's
 * kind, codes, booleans, dates and the id of the Organization address a row was moved
 * into. The recipient, street, city, postal code and phone stay out, and so do the
 * customer account the row belongs to (the tenant anchor) and the Organization it was
 * moved to — the entry is recorded against the row by id.
 *
 * No screen reads these values back out of the audit log, so the values are kept
 * nowhere else.
 */

/**
 * Every top-level key a `customer_address.*` audit state may hold. Anything else is a
 * value until somebody classifies it on purpose — `customer-address-audit-sentinels.test.ts`
 * holds every write's recorded state to this list.
 */
export const CUSTOMER_ADDRESS_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // The row's kind, a code: `delivery` or `billing`.
  'kind',
  // `customer_address.merge`: the Organization address the row went to (an id), whether it
  // was linked to an equal one, and whether the row was its account's default.
  'mergedIntoAddressId',
  'deduplicated',
  'wasDefault',
  // `customer_address.merge_refused`: the owner's error code.
  'mergeRefusal',
  // `customer_address.erased` / `.anonymized`: when, and whether the row was already deleted.
  'erasedAt',
  'anonymizedAt',
  'wasDeleted',
]);

/** The `stateBefore` of every `customer_address.*` entry: the row's kind, never its account. */
export function customerAddressAuditBefore(row: { readonly kind: string }): Record<string, unknown> {
  return { kind: row.kind };
}
