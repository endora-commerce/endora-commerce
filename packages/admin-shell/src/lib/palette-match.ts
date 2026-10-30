import { normalize } from '@endora-commerce/admin-kit/lib';

/**
 * The ⌘K palette's one matching rule, shared by every group the dialog renders
 * — the server-fed Actions group (`lib/admin-actions/useAdminActions.ts`) and
 * the static Navigate and Assistant rows (`components/AppShell.tsx`). Issue #233
 * is why there is exactly one: two rules for two groups the operator cannot
 * tell apart is how half the palette stopped answering.
 *
 * **Every word of the query must occur somewhere in the row** — in its label,
 * its description or any keyword, each folded by `normalize`. The rule used to
 * be "the whole folded query is a substring of one field", and that made a
 * multi-word query depend on one field carrying those words contiguously and in
 * that inflection: the owner's `kanał sprzedaży` did not find
 * `Kanały sprzedaży` (`kanal sprzedazy` is not a substring of `kanaly sprzedazy`), and
 * `sales channels` did not find it in a Polish admin, because the English words
 * live in two separate keywords. A single-word query matches exactly what it
 * matched before.
 */

/**
 * Fold a query into the words the row is matched against. Folded once per
 * keystroke by the caller, not once per row; an empty or whitespace-only query
 * yields no words, which {@link matchesSearchTerms} answers with "every row".
 */
export function searchTerms(query: string): string[] {
  return normalize(query)
    .split(/\s+/u)
    .filter((term) => term.length > 0);
}

/** Does every term occur, as a substring, in at least one of the haystacks? */
export function matchesSearchTerms(
  terms: readonly string[],
  haystacks: readonly (string | null | undefined)[],
): boolean {
  if (terms.length === 0) return true;
  const folded = haystacks.filter((h): h is string => typeof h === 'string' && h.length > 0).map(normalize);
  return terms.every((term) => folded.some((haystack) => haystack.includes(term)));
}
