/**
 * Issue #1495 (UX audit CONTENT-13, DEC-17) — how a duplicated CMS page, block
 * or template is named. Pure, so the sequence is held without a database.
 *
 * The suffix sequence is catalog's `product.duplicate` one — `-copy`, then
 * `-copy-2`, `-copy-3`, … — so an operator meets one rule across the admin
 * (Jakob's law). It is restated here rather than shared: catalog's lives inside
 * its admin service, and moving it would refactor a module this change has no
 * other reason to touch.
 *
 * A copy of a copy appends again (`about-copy-copy`). Parsing and incrementing
 * an existing `-copy-n` was rejected: `x-copy` may be an operator's own slug.
 */

/** The longest slug or code `cmsSlugRe` / `cmsCodeRe` allow. */
export const CMS_COPY_MAX_LENGTH = 180;

/** The last suffix tried (`-copy-1000`); past it the copy is refused as a conflict. */
export const CMS_COPY_LIMIT = 1000;

/** The longest name a page, block or template takes. */
const CMS_NAME_MAX_LENGTH = 200;

/** What neither regex allows as a last character, and a cut may leave there. */
const TRAILING_SEPARATORS = /[-_/.]+$/;

function suffix(n: number): string {
  return n === 1 ? '-copy' : `-copy-${n}`;
}

/**
 * The `n`th candidate derived from `base`: the base cut to leave room for the
 * suffix — the base and never the suffix, or every long base would collapse
 * onto one candidate — with any separator the cut leaves at its end trimmed,
 * so the result still matches `cmsSlugRe` / `cmsCodeRe`.
 */
export function copyCandidate(base: string, n: number): string {
  const tail = suffix(n);
  const head = base.slice(0, CMS_COPY_MAX_LENGTH - tail.length).replace(TRAILING_SEPARATORS, '');
  return `${head}${tail}`;
}

/**
 * A prefix every candidate of `base` starts with, for the one `like` query that
 * reads the taken set: the base cut for the longest suffix, trimmed the same way.
 */
export function copyPrefix(base: string): string {
  return copyCandidate(base, CMS_COPY_LIMIT).slice(0, -suffix(CMS_COPY_LIMIT).length);
}

/**
 * The smallest `n` for which the candidate of **every** base is free — one `n`
 * for a page's slug and all its language slugs, so "the copy of X" is one
 * recognisable family across languages. `null` once the range is used up.
 * Deterministic: the same taken set always answers the same number.
 */
export function pickCopyNumber(bases: readonly string[], taken: ReadonlySet<string>): number | null {
  for (let n = 1; n <= CMS_COPY_LIMIT; n += 1) {
    if (bases.every((base) => !taken.has(copyCandidate(base, n)))) return n;
  }
  return null;
}

/**
 * The copy's name: the one the caller sent (the admin sends it in the
 * operator's language), otherwise `"<source> (copy)"` cut to the column's
 * length, as catalog's `suffixCopyName` does. Names are not unique, so a name
 * never clashes.
 */
export function copyName(sourceName: string, requested?: string): string {
  if (requested !== undefined) return requested;
  return `${sourceName} (copy)`.slice(0, CMS_NAME_MAX_LENGTH);
}

/** `value` as a literal inside a PostgreSQL `like` pattern (backslash is the default escape). */
export function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
