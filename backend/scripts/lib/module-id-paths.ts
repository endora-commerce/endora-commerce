/**
 * *"A path carrying a module's id as a **whole path segment or a filename
 * stem**, in either spelling."* — one predicate, with **one** home
 * (`specs/129-github-canonical-migration/spec.md` FR-011(d); owner rulings
 * **D-263** clause 1 and **D-262** clause 1).
 *
 * ## Why this is its own file
 *
 * Two instruments ask this question of two different histories. The one-time
 * publication filter (`public-history-filter.ts`, 129 T025) asks it to refuse
 * **publishing** a withheld module's path; the extraction deriver
 * (`derive-extraction-path-set.ts`, 134 E3p) asks it to refuse **losing** one.
 * D-262 clause 1 is the shape where two instruments answered one question two
 * ways, and D-263 clause 1 point 1 names the repair in the same words: *"share
 * the predicate, do not copy it."* So it is neither instrument's private
 * function. FR-011(d) is the statement of the rule and is not restated here.
 *
 * ## What the predicate deliberately is not
 *
 * It is **not** a substring match, and the temptation is real:
 * `backend/test/helpers/scripted-xl-client.ts` is `comarch_xl`'s and carries
 * `xl` in the middle of a filename. Widening the predicate to catch it would
 * make every `scripted-*` helper in the tree every module's, and one of the
 * shortest ids in the population (`xl`, `blog`, `cms`) would match hundreds of
 * paths that are nobody's. Those paths are found by a resolver instead — E3p's
 * R2, the rename closure — and this predicate's job is the complement: the
 * class a **convention** names, which is exactly a directory per module and a
 * file per module.
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

/** FR-011(d)'s predicate, over one path and one module id. */
export function pathCarriesModuleId(path: string, moduleId: string): boolean {
  const spellings = moduleIdSpellings(moduleId);
  const segments = path.split('/');
  if (segments.slice(0, -1).some((segment) => spellings.includes(segment))) return true;
  const last = segments[segments.length - 1] ?? '';
  return spellings.includes(last) || spellings.includes(filenameStem(path));
}
