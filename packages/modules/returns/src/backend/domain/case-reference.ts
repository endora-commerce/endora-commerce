/**
 * The case's readable reference (`specs/180-off-platform-complaints/` FR-A44, D-4,
 * research R-20).
 *
 * The RMA number once assigned; until then `#` plus the first eight hex characters
 * of the id, upper-cased and without hyphens (`#3F9A21C0`). Computed on read and
 * never stored: it is a display aid, not a key — two cases sharing the first eight
 * characters of a v4 UUID is a 1-in-2³² coincidence a human comparing two cases
 * will not meet, and every link carries the id itself.
 *
 * Shown wherever the RMA number is: the admin and customer lists (as the link
 * text), the page titles, and every e-mail of feature 180 as `caseReference`.
 */
export function caseReference(rc: { readonly id: string; readonly rmaNumber?: string | null }): string {
  if (rc.rmaNumber) return rc.rmaNumber;
  return `#${rc.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/**
 * The eight hex characters a search term names as a derived reference — `#3F9A21C0`
 * or `3f9a21c0` — or `null` when the term is not one. The admin list's `q` matches
 * it as an id prefix (FR-A44).
 */
export function derivedReferencePrefix(term: string): string | null {
  const match = /^#?([0-9a-f]{8})$/i.exec(term.trim());
  return match ? match[1]!.toLowerCase() : null;
}
