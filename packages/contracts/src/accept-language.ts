/** Bound on the header read — the parse half of the security bound (D-139 § 8.1). */
const MAX_HEADER_LENGTH = 512;
/** Bound on how many tags are considered, applied **after** q-sorting. */
const MAX_TAGS = 10;

/**
 * `Accept-Language` as an ordered list of tags, heaviest `q` first.
 *
 * RFC 9110 makes the header a q-weighted list, so `split(',')[0]` reads
 * `en;q=0.2,pl;q=0.9` as English. This is the one parse: the platform's
 * prose-language ladder (`kernel/i18n/request-language.ts`) and the channel
 * content-language rule (`requestScopeLanguage`, `product-scopes.ts`) both read
 * the header through it (feature 083 R9; moved here from the kernel by
 * issue #397 so a module can reach it).
 *
 * Bounded twice, because the header is attacker-controlled on every request:
 * to {@link MAX_HEADER_LENGTH} characters and, after weighting, to
 * {@link MAX_TAGS} tags. Exceeding either is not an error — the remainder is
 * simply not read. A malformed `q` drops its tag rather than guessing a weight.
 *
 * A tag at `q=0` or below is dropped too (issue #1315): RFC 9110 § 12.4.2 makes
 * `q=0` "not acceptable", so a refused language is never a candidate, and it does
 * not count towards {@link MAX_TAGS}. `*` with a positive `q` is returned as an
 * ordinary tag; no consumer matches it to a language. A refused `*` is dropped
 * like any other refused tag, so it never matches either.
 */
export function parseAcceptLanguage(header: string | readonly string[] | undefined): string[] {
  return weightedAcceptLanguage(header).map((entry) => entry.tag);
}

/** One element of a parsed `Accept-Language` header: the tag and its weight. */
export interface WeightedLanguageTag {
  tag: string;
  /**
   * The `q` parameter as written, `1` when absent. Always above `0`: a refused tag is not
   * answered at all (issue #1315).
   */
  q: number;
}

/**
 * {@link parseAcceptLanguage} with the weights kept, in the same order, under the same bounds
 * and the same exclusion of refused (`q=0`) tags. For a consumer that needs the weight itself;
 * every reader that only needs the order takes {@link parseAcceptLanguage}.
 */
export function weightedAcceptLanguage(header: string | readonly string[] | undefined): WeightedLanguageTag[] {
  const raw = typeof header === 'string' ? header : header?.[0];
  if (!raw) return [];
  const weighted: Array<{ tag: string; weight: number; order: number }> = [];
  for (const part of raw.slice(0, MAX_HEADER_LENGTH).split(',')) {
    const [tagPart, ...parameters] = part.split(';');
    const tag = tagPart?.trim() ?? '';
    if (tag.length === 0) continue;
    const weight = readWeight(parameters);
    // Malformed, or refused: `q=0` is "not acceptable" (RFC 9110 § 12.4.2, issue #1315).
    if (weight === null || weight <= 0) continue;
    weighted.push({ tag, weight, order: weighted.length });
  }
  weighted.sort((a, b) => b.weight - a.weight || a.order - b.order);
  return weighted.slice(0, MAX_TAGS).map((entry) => ({ tag: entry.tag, q: entry.weight }));
}

/** The `q` parameter of one list element: its weight, `1` by default, or `null` if malformed. */
function readWeight(parameters: string[]): number | null {
  for (const parameter of parameters) {
    const separator = parameter.indexOf('=');
    if (separator < 0) continue;
    if (parameter.slice(0, separator).trim().toLowerCase() !== 'q') continue;
    const value = parameter.slice(separator + 1).trim();
    const parsed = Number(value);
    if (value.length === 0 || !Number.isFinite(parsed)) return null;
    return parsed;
  }
  return 1;
}
