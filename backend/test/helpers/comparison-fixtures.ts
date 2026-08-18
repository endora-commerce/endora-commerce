import { randomUUID } from 'node:crypto';

/**
 * Per-test owner identities for the comparisons module (issue #166).
 *
 * A comparison's anonymous owner *is* the `compare_token` cookie the caller
 * sends — `readOwner` reads nothing else — so a token no other test uses names a
 * comparison no other test can reach. That is what lets these files assert over
 * the row they created instead of emptying `comparisons` in a `beforeEach` and
 * then asserting over "the only row there is".
 *
 * The eight comparison test files did the latter, all of them, and four of them
 * carried the assertions it licenses (`expect(body.data).toHaveLength(1)`
 * against the admin list, `expect(rows).toHaveLength(1)` against
 * `em.find(Comparison, {})`). Those hold only while nobody else's row exists,
 * which is not a property a test can own.
 *
 * A token is 22 characters, matching `ShareTokenGenerator`'s output width, and
 * the columns behind both it and a share token are `varchar(32)`.
 */

const TOKEN_LENGTH = 22;

/** A token for `comparisons.anonymous_token` no other test holds. */
export function freshCompareToken(): string {
  return randomUUID().replaceAll('-', '').slice(0, TOKEN_LENGTH);
}

/** The same token, spelled as the `cookie` header a storefront request carries. */
export function freshCompareCookie(): string {
  return `compare_token=${freshCompareToken()}`;
}

/**
 * A token for `comparisons.share_token` no other test holds.
 *
 * Separate from the cookie helper because the column is unique: a file that
 * writes a Comparison row directly needs a share token that cannot collide with
 * one a previous run left behind, and a file that asks "what does an unknown
 * share token do?" needs one no row can be wearing.
 */
export function freshShareToken(): string {
  return freshCompareToken();
}
