/**
 * "Did the walk read the module tree, or a residue of it?" — the one derivation
 * (issue #215).
 *
 * Fourteen of the twenty `check-*` scripts are filesystem walks whose whole
 * population is `backend/src/modules`: 1364 of the 1469 `.ts` files under
 * `backend/src` live there. Eight of them guarded that walk with
 * `files.length === 0`, which is the wrong predicate. It catches only the case
 * where the walk finds **nothing at all**; it cannot catch the case that
 * actually happens when the tree moves, which is that the walk finds the
 * remaining 105 files — `src/kernel`, `src/db`, `src/apps`, `src/http` — reads
 * them, finds nothing wrong in them, and reports a clean tree. That is issue
 * #113's failure mode, in eight checks at once, at the moment the repository is
 * most disturbed.
 *
 * So the guard has to assert the walk found **the population it expects**, not
 * merely a non-empty list. The expectation is derived from the generated
 * manifest index, never written down: a hand-written count is a copy of a
 * derived fact and goes stale in silence, which is what D-100 was written
 * about. Two properties fall out of reading it, and the check needs both:
 *
 *   1. **The index is a path that must resolve.** Where it lives is
 *      `lib/module-roots.ts`' answer since feature 080's T040a — searched for
 *      over the workspace members rather than joined onto a source root — so a
 *      tree that moved without it is an error rather than an empty result, and
 *      the whole module directory going missing is refused before a single file
 *      is analysed.
 *   2. **Every module it registers must contribute a source.** A *partial*
 *      move — the one a package split actually performs, index regenerated and
 *      pointing at the new home — leaves the index readable and the walk
 *      short. Only a per-module floor sees that, and it sees it without
 *      anybody choosing a number.
 *
 * The pure half takes the file list and the ids, so a red proof can drive it
 * from a residue the tree does not contain, entering where a real run enters
 * (issues #113, #130). {@link loadRegisteredModuleIds} is the only part that
 * knows where the index lives, and it is `switchable-modules.ts`' reader — the
 * two derivations cannot disagree about which modules exist.
 */
import { loadManifestActivations } from './switchable-modules.js';

export { ManifestIndexUnreadableError } from './switchable-modules.js';

/** How many missing ids the message names before it counts the rest. */
const NAMED_IN_MESSAGE = 8;

export interface ModulePopulationInput {
  /** Module ids the generated manifest index registers. */
  readonly registered: readonly string[];
  /**
   * Every path the walk produced. Absolute or relative, either separator: the
   * module id is read out of the `modules/<id>/` segment, which every caller's
   * paths carry whichever root they were made relative to.
   */
  readonly files: readonly string[];
  /**
   * Registered modules this check excludes from its own scan by design, so its
   * floor asks for the population it actually reads. Every entry is a claim the
   * check makes in its header, not a convenience.
   */
  readonly excluded?: readonly string[];
  /**
   * How a path is attributed to a module, where the `modules/<id>/` segment is
   * not the answer (feature 080, T040a).
   *
   * A module that has become a **package** lives at a path of its own choosing
   * — `packages/modules/blog/src/…` today, whatever the workspace globs allow
   * tomorrow — and its id is read from its manifest's `endora.id` rather than
   * from a directory name. `lib/module-roots.ts` supplies the function; the
   * default is {@link moduleIdOf}, so a caller with only an application tree
   * gets exactly the behaviour it had before this field existed.
   */
  readonly moduleIdOf?: (path: string) => string | null;
}

/**
 * The module a path belongs to, or `null` for a file outside the module tree.
 *
 * Reads the **first** `modules/<id>/` segment, so an overlay module under
 * `apps/<deployment>/modules/<id>/` resolves to its own id rather than to the
 * deployment. `node_modules/` cannot match: the segment must start the path or
 * follow a separator.
 */
export function moduleIdOf(path: string): string | null {
  const match = /(?:^|\/)modules\/([^/]+)\//.exec(path.split('\\').join('/'));
  return match?.[1] ?? null;
}

/** Registered modules the walk produced no file for. */
export function modulesWithoutSources(input: ModulePopulationInput): string[] {
  const excluded = new Set(input.excluded ?? []);
  const idOf = input.moduleIdOf ?? moduleIdOf;
  const seen = new Set<string>();
  for (const file of input.files) {
    const id = idOf(file);
    if (id !== null) seen.add(id);
  }
  return input.registered.filter((id) => !excluded.has(id) && !seen.has(id)).sort();
}

/**
 * What the index expected of the walk and what the walk delivered, in the shape
 * `scripts/lib/read-size.ts` prints (issue #244).
 *
 * The floor below already computes both numbers to decide whether to refuse;
 * returning them is what lets the check *print* them, so a run that was never
 * short still says which population it covered. A number nothing prints is a
 * number nobody can see going wrong.
 */
export interface ModulePopulationCoverage {
  readonly source: 'manifest-index';
  /** Registered modules this check is expected to read, exclusions removed. */
  readonly expected: number;
  /** How many of them the walk produced at least one file for. */
  readonly covered: number;
}

/** The two numbers, without the refusal — the same derivation, printed. */
export function modulePopulationCoverage(
  input: ModulePopulationInput,
): ModulePopulationCoverage {
  const excluded = new Set(input.excluded ?? []);
  const expected = input.registered.filter((id) => !excluded.has(id)).length;
  return {
    source: 'manifest-index',
    expected,
    covered: expected - modulesWithoutSources(input).length,
  };
}

/**
 * The sentence a check prints before `process.exit(2)`, or `null` when the walk
 * covered every module the index registers.
 *
 * An index that registers nothing is refused too: "no module is registered" and
 * "the index did not load" would otherwise be the same answer, and the second
 * silently turns the floor off while looking like a normal run.
 */
export function vacuousModulePopulation(input: ModulePopulationInput): string | null {
  if (input.registered.length === 0) {
    return 'the manifest index registers no module — refusing to report a vacuous pass';
  }
  const missing = modulesWithoutSources(input);
  if (missing.length === 0) return null;
  const named = missing.slice(0, NAMED_IN_MESSAGE).join(', ');
  const rest = missing.length > NAMED_IN_MESSAGE ? `, +${missing.length - NAMED_IN_MESSAGE} more` : '';
  return (
    `the walk read ${input.files.length} file(s) but produced none for ` +
    `${missing.length} of the ${input.registered.length} registered modules ` +
    `(${named}${rest}) — it is reading a residue of the module tree, not the tree; ` +
    'refusing to report a vacuous pass'
  );
}

/**
 * Ids of every module the generated index at `indexPath` registers.
 *
 * Throws `ManifestIndexUnreadableError` when the index is missing or empty; a
 * caller turns that into exit 2, never into a pass.
 */
export async function loadRegisteredModuleIds(indexPath: string): Promise<readonly string[]> {
  return (await loadManifestActivations(indexPath)).map((manifest) => manifest.id);
}

/**
 * The CLI half: read the index, compare it against what the walk produced, and
 * exit 2 rather than report on a residue.
 *
 * One function rather than nine copies, because nine copies of an exit-2 guard
 * is nine chances to write the one that returns instead — and a check whose
 * guard is subtly wrong is invisible by construction, since it reports green
 * either way.
 *
 * Returns the coverage it just enforced, so the caller can hand it to
 * `reportReadSize` and print the corroboration rather than only its own count
 * of files (issue #244).
 */
export async function refuseVacuousModulePopulation(input: {
  /** The check's log prefix, e.g. `[subscribe-seam]`. */
  readonly prefix: string;
  /** The generated manifest index, as `lib/module-roots.ts` resolved it. */
  readonly manifestIndexPath: string;
  readonly files: readonly string[];
  readonly excluded?: readonly string[];
  readonly moduleIdOf?: (path: string) => string | null;
}): Promise<ModulePopulationCoverage> {
  let registered: readonly string[];
  try {
    registered = await loadRegisteredModuleIds(input.manifestIndexPath);
  } catch (error: unknown) {
    console.error(
      `${input.prefix} the module index at ${input.manifestIndexPath} could not be read ` +
        `(${String(error)}) — the expected population is derived from it, so there is ` +
        'nothing to compare the walk against; refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  const population: ModulePopulationInput = {
    registered,
    files: input.files,
    ...(input.excluded === undefined ? {} : { excluded: input.excluded }),
    ...(input.moduleIdOf === undefined ? {} : { moduleIdOf: input.moduleIdOf }),
  };
  const reason = vacuousModulePopulation(population);
  if (reason !== null) {
    console.error(`${input.prefix} ${reason}`);
    process.exit(2);
  }
  return modulePopulationCoverage(population);
}
