/**
 * *"A path carrying a module's id"* — FR-011(d)'s predicate, with **one** home
 * (`specs/129-github-canonical-migration/spec.md` FR-011(d) as amended by
 * **D-272** clause 2; owner rulings **D-263** clause 1 and **D-262** clause 1).
 *
 * ## Why this is its own file
 *
 * Two instruments were written to ask this question of two different
 * histories. The extraction deriver (`derive-extraction-path-set.ts`, 134 E3p)
 * asked it to refuse **losing** a module's path, and retired with the last
 * extraction (`specs/136-open-source-publication/` W3.3). The one-time
 * publication filter (`public-history-filter.ts`, 129 T025) asks it to
 * withhold or refuse **publishing** a withheld module's path
 * (`specs/134-paid-module-extraction/` T091 case 6 and T094a). D-262 clause 1 is the shape
 * where two instruments answered one question two ways, and D-263 clause 1
 * point 1 names the repair in the same words: *"share the predicate, do not
 * copy it."* So it is neither instrument's private function, and it outlived
 * the one that retired. FR-011(d) is the statement of the rule and is not
 * restated here.
 *
 * ## What the predicate deliberately is not
 *
 * It is **not** a substring match. The shortest ids in the population (`blog`,
 * `cms`) would match hundreds of paths that are nobody's — `blogger.ts`,
 * `cmsk/` — so the predicate reads **tokens** instead (owner ruling **D-272**
 * clause 2, which widened it from *"a whole segment or a filename stem"*). A
 * segment is split into lower-case tokens on every non-alphanumeric character
 * and every lower-to-upper camel-case boundary, and a path carries an id when
 * some segment holds the id's tokens as a contiguous run, or holds a token
 * **distinctive** to the id: one no other id of the population carries. That
 * reaches `PayuPayForm.tsx`, `scripted-<vendor>-client.ts` and
 * `AppShell.ergonode-nav.test.tsx`, which the old predicate could not see, and
 * it is a strict superset of it, because a whole segment is its own token run.
 * The population is always a **parameter** — the ids every historical manifest
 * declared, derived on the day (D-100) — never a constant of this file.
 *
 * A path whose name carries **no** token of its module is not this predicate's
 * to find. The filter finds those through its **rename closure**
 * (`resolveModuleExclusions` in `public-history-filter.ts`, D-272 clause 3),
 * which follows a first-parent rename into a withheld path back to the name it
 * had before, and through the closed per-path residue
 * `moduleExclusions.withheldPaths` (D-272 clause 5) for the few no name reaches.
 */

/** `snake_case` and `kebab-case`, deduplicated for an id that has no underscore. */
export function moduleIdSpellings(moduleId: string): readonly string[] {
  const kebab = moduleId.replace(/_/g, '-');
  return kebab === moduleId ? [moduleId] : [moduleId, kebab];
}

/**
 * The part of a basename a module id is compared against: everything before the
 * first dot. `demo_mod.md`, `demo-mod.test.ts` and
 * `demo-mod.surface.test.tsx` all carry the id; `demo-mod-webhook.ts` does not.
 */
export function filenameStem(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.indexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

/**
 * One path segment as lower-case tokens: split on every non-alphanumeric
 * character and on every lower-to-upper camel-case boundary.
 * `PayuPayForm.tsx` is `payu pay form tsx`.
 */
export function segmentTokens(segment: string): string[] {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');
}

/** An id's own tokens: `pim_akeneo` is `pim akeneo`. */
function idTokens(moduleId: string): string[] {
  return moduleId
    .toLowerCase()
    .split('_')
    .filter((token) => token !== '');
}

/**
 * The tokens of a multi-token id that **no other id** of `population` carries
 * (D-272 clause 2). `pim_akeneo` against a population holding `pim_connector`
 * has `akeneo` and not `pim`; a single-token id has none, because its one token
 * is already its whole run.
 */
export function distinctiveTokens(moduleId: string, population: readonly string[]): string[] {
  const own = idTokens(moduleId);
  if (own.length < 2) return [];
  const others = new Set(
    population.filter((id) => id !== moduleId).flatMap((id) => idTokens(id)),
  );
  return [...new Set(own)].filter((token) => !others.has(token));
}

function containsRun(tokens: readonly string[], run: readonly string[]): boolean {
  if (run.length === 0 || run.length > tokens.length) return false;
  for (let start = 0; start + run.length <= tokens.length; start += 1) {
    if (run.every((token, offset) => tokens[start + offset] === token)) return true;
  }
  return false;
}

/**
 * FR-011(d)'s predicate as amended by D-272, over one path, one module id and
 * the population of ids the distinctive tokens are derived against.
 */
export function pathCarriesModuleId(
  path: string,
  moduleId: string,
  population: readonly string[],
): boolean {
  return moduleIdMatcher(moduleId, population)(path);
}

/**
 * The same predicate with the id's tokens and its distinctive tokens derived
 * once, for a caller that asks it of tens of thousands of historical paths.
 */
export function moduleIdMatcher(
  moduleId: string,
  population: readonly string[],
): (path: string) => boolean {
  const run = idTokens(moduleId);
  const distinctive = distinctiveTokens(moduleId, population);
  return (path) =>
    path.split('/').some((segment) => {
      const tokens = segmentTokens(segment);
      return containsRun(tokens, run) || distinctive.some((token) => tokens.includes(token));
    });
}
