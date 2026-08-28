/**
 * Per-locale label resolver (feature 012 / R-3).
 *
 * Reads `label[locale]` from the per-locale JSONB map; falls back to
 * `labelDefault` when the active locale is missing or the per-locale
 * value is empty. Locale tags are normalised so `pl_PL` matches a map
 * keyed `pl-PL` (and vice-versa) and the region tag is matched
 * case-insensitively.
 *
 * The resolver is pure — given the same inputs it returns the same
 * output. No I/O, no clock, no globals. Used by every storefront +
 * admin reader that needs the rendered label of an attribute or
 * option.
 */
export function resolveLabel(
  label: Record<string, string> | null | undefined,
  labelDefault: string,
  locale: string,
): string {
  if (!label) return labelDefault;
  const wantedKeys = normaliseLocaleVariants(locale);
  const lookup = buildKeyLookup(label);
  for (const key of wantedKeys) {
    const hit = lookup.get(key);
    if (hit !== undefined && hit !== '') return hit;
  }
  return labelDefault;
}

function normaliseLocaleVariants(locale: string): string[] {
  if (!locale) return [];
  const lower = locale.toLowerCase();
  // Generate the four common spellings: as-is, lower-case, dash↔underscore variants.
  const variants = new Set<string>([locale, lower, lower.replace('_', '-'), lower.replace('-', '_')]);
  return [...variants];
}

function buildKeyLookup(label: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(label)) {
    out.set(key, value);
    out.set(key.toLowerCase(), value);
  }
  return out;
}
