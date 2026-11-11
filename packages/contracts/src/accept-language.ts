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
 * `*` is returned as an ordinary tag; no consumer matches it to a language.
 */
export function parseAcceptLanguage(header: string | readonly string[] | undefined): string[] {
  const raw = typeof header === 'string' ? header : header?.[0];
  if (!raw) return [];
  const weighted: Array<{ tag: string; weight: number; order: number }> = [];
  for (const part of raw.slice(0, MAX_HEADER_LENGTH).split(',')) {
    const [tagPart, ...parameters] = part.split(';');
    const tag = tagPart?.trim() ?? '';
    if (tag.length === 0) continue;
    const weight = readWeight(parameters);
    if (weight === null) continue;
    weighted.push({ tag, weight, order: weighted.length });
  }
  weighted.sort((a, b) => b.weight - a.weight || a.order - b.order);
  return weighted.slice(0, MAX_TAGS).map((entry) => entry.tag);
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
