/**
 * The one canonical form of an e-mail address the platform stores and compares.
 *
 * ## The defect it ends
 *
 * The account table's writes folded the address to lower case and its reads did
 * not. Postgres' `=` on `text` is case-sensitive, so a buyer who registered as
 * `Jan.Kowalski@example.pl` had `jan.kowalski@example.pl` on record and every
 * login attempt with the address they had typed matched no row — answered with
 * the generic anti-enumeration `INVALID_CREDENTIALS`, which tells neither the
 * buyer nor support what happened. Two entrances reached it: organisation
 * registration (a public storefront path) and the member admin surface.
 *
 * ## The decision
 *
 * **Stored folded, compared folded.** RFC 5321 makes the local part technically
 * case-sensitive; no mail provider in practice treats it that way, and the tree
 * had already chosen to fold on write. So the reads move to meet the writes.
 *
 * ## Why a function here rather than a `.toLowerCase()` in the Zod schemas
 *
 * A transform on `customerRegistrationSchema` and its siblings would normalise
 * only the callers that went through that particular schema. Three entrances
 * into the same table go through none of them: federated sign-in takes the
 * address from an OIDC claim, the admin "send a reset link" action passes an
 * address already on record, and the invitation flow re-reads the address off
 * its own row. The invariant belongs to whoever owns the table, so it is
 * applied at that module's own seam — every service and port method that
 * accepts an address folds it as its first act — and a helper is what lets the
 * eleven of them share one spelling of "the same address".
 *
 * It lives in `@b2b/contracts` rather than inside `customer_accounts` because
 * `organizations` writes an invitation row keyed by the same address and has to
 * fold it the same way; a module may not import another module's internals, and
 * a second private copy is exactly how `foldDiacritics` came to have six.
 *
 * Not a port: it is pure over its argument, so it cannot answer differently
 * depending on which modules are switched on, and a gated port answering 503
 * `MODULE_DISABLED` to "fold this address" would be a bug rather than a safety
 * property.
 */

/**
 * Fold an e-mail address to the form the platform stores and compares.
 *
 * Two steps, and only two:
 *
 * 1. **Trim.** Surrounding whitespace is never part of an address. Zod's
 *    `.email()` already rejects it at every HTTP entrance, so this bites only
 *    where the address arrives from somewhere else — an identity provider's
 *    claim, an importer, a seed.
 * 2. **Lowercase.** The whole point: `Jan.Kowalski@Example.PL` and
 *    `jan.kowalski@example.pl` are one account.
 *
 * Deliberately **not** a validator: an address that is not one comes back
 * unchanged apart from those two steps, because rejecting it is the schema's
 * job at the boundary and this function is also applied to addresses already
 * persisted. And deliberately **not** a normaliser of provider-specific
 * aliasing — Gmail's dots and `+tags` are still distinct addresses here, since
 * collapsing them would silently merge accounts on some domains and not others.
 */
export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}
