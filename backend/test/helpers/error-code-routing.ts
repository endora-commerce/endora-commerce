/**
 * The equality harness for feature 090's Phase 3 migration
 * (`specs/090-module-owned-error-codes/`, FR-041 / SC-002).
 *
 * The migration moves the routing answer out of a hard-coded prefix chain and
 * into each owning module's manifest, one merge request per module, and then
 * deletes the chain. Its whole safety property is that the answer does not
 * change: *"for every code in the platform's enumeration, the routing answer
 * after the migration equals the answer the deleted chain gave"*
 * (`contracts/error-code-declaration.md` §6.2), **with no exception list**.
 *
 * This file is the comparison that says so. It exists **before** anything moves,
 * because an assertion written after the fact can only compare a migration to
 * itself: the reference side has to be captured while the function that produces
 * it is still in the tree (§6.3). The frozen capture is
 * `test/fixtures/error-code-routing/chain-answers.ts`; this is the predicate that
 * reads it.
 *
 * **It compares whole maps, in both directions.** A per-code loop over the
 * reference alone answers "did every code the chain routed keep its answer" and
 * is silent about a code the candidate routes and the chain did not — which is
 * exactly the shape a stray declaration in a migrated manifest takes. Both
 * directions are one function so neither can be forgotten.
 */

/** A routing answer, flattened: the code, and the module id it reaches. */
export type RoutingAnswers = Readonly<Record<string, string>>;

/**
 * Why two routing answers differ.
 *
 * - `unrouted`  — the reference routes the code and the candidate does not.
 *                 After the migration this is a module that forgot to declare a
 *                 code it owns, and the operator sees a raw code.
 * - `unexpected` — the candidate routes a code the reference does not. A
 *                 declaration nobody asked for: harmless-looking, and the first
 *                 half of a collision once a second module reaches for it.
 * - `rerouted`  — both route it, to different modules. The sentence moves to
 *                 another bundle, which is the one difference an operator can
 *                 see immediately and the one a reviewer cannot see at all.
 */
export type RoutingDifferenceKind = 'unrouted' | 'unexpected' | 'rerouted';

export interface RoutingDifference {
  readonly code: string;
  readonly kind: RoutingDifferenceKind;
  /** The module the reference routes to, or `null` when it routes nowhere. */
  readonly expected: string | null;
  /** The module the candidate routes to, or `null` when it routes nowhere. */
  readonly actual: string | null;
}

/**
 * Refused rather than reported: a comparison over an empty side is vacuously
 * equal, which is issue #113's shape — a green that means "not looking". Both
 * sides are guarded independently because either can empty while the other is
 * full: the reference is a committed fixture and the candidate is derived from
 * the running tree, and a run that failed to load one of them must not read as
 * agreement.
 */
export class EmptyRoutingComparisonError extends Error {}

export function compareErrorCodeRouting(
  reference: RoutingAnswers,
  candidate: RoutingAnswers,
): RoutingDifference[] {
  if (Object.keys(reference).length === 0) {
    throw new EmptyRoutingComparisonError(
      'the reference routing answer is empty — refusing to report a vacuous equality',
    );
  }
  if (Object.keys(candidate).length === 0) {
    throw new EmptyRoutingComparisonError(
      'the candidate routing answer is empty — refusing to report a vacuous equality',
    );
  }

  const differences: RoutingDifference[] = [];
  for (const code of [...new Set([...Object.keys(reference), ...Object.keys(candidate)])].sort()) {
    const expected = reference[code] ?? null;
    const actual = candidate[code] ?? null;
    if (expected === actual) continue;
    const kind: RoutingDifferenceKind =
      expected === null ? 'unexpected' : actual === null ? 'unrouted' : 'rerouted';
    differences.push({ code, kind, expected, actual });
  }
  return differences;
}

/** One line per difference, in the words a migration reviewer needs. */
export function describeRoutingDifferences(differences: readonly RoutingDifference[]): string {
  return differences
    .map(
      (d) =>
        `  - [${d.kind}] ${d.code}: chain said ${d.expected ?? 'nothing'}, ` +
        `declarations say ${d.actual ?? 'nothing'}`,
    )
    .join('\n');
}

/**
 * Why a module's declaration and the frozen chain capture disagree **about that
 * module**.
 *
 * This is a different question from {@link compareErrorCodeRouting}, and the
 * difference is the one trap feature 090's Phase 3 has that nothing else can
 * see. The comparator above measures the map the composition roots inject, which
 * is `composeErrorTranslationTargets` — the declarations laid **over** the chain.
 * So a module that declares ten of the thirteen codes it owns produces a
 * composed map that is still exactly right: the chain answers for the other
 * three, and the comparator reports nothing. The migration is half done, the
 * merge request is green, and the shortfall surfaces on the merge request that
 * deletes the chain — eighteen merge requests later, as three codes that
 * suddenly route nowhere.
 *
 * So completeness is asserted per module, against the capture, on the merge
 * request that migrates it:
 *
 * - `undeclared` — the capture routes the code to this module and the manifest
 *                  does not declare it. The migration is incomplete.
 * - `not-owned`  — the manifest declares a code the capture routes somewhere
 *                  else, or nowhere. `chainAnswer` names where, because the
 *                  useful sentence is "`catalog` owns this", not "you should not
 *                  have it".
 */
export type MigrationGapKind = 'undeclared' | 'not-owned';

export interface MigrationGap {
  readonly code: string;
  readonly kind: MigrationGapKind;
  /** The module the frozen capture routes the code to, or `null` for none. */
  readonly chainAnswer: string | null;
}

/**
 * Refused rather than reported, for the same reason
 * {@link EmptyRoutingComparisonError} is: a module that owns no code in the
 * capture has nothing to be complete about, so "no gaps" would be a green
 * meaning "not looking" — which is what a misspelled roster entry produces.
 */
export class EmptyMigrationScopeError extends Error {}

export function findMigrationGaps(
  moduleId: string,
  declaredCodes: readonly string[],
  chainAnswers: RoutingAnswers,
): MigrationGap[] {
  const owned = Object.keys(chainAnswers).filter((code) => chainAnswers[code] === moduleId);
  if (owned.length === 0) {
    throw new EmptyMigrationScopeError(
      `the frozen chain capture routes no code to "${moduleId}" — refusing to report a ` +
        'vacuous completeness. Either the module id is misspelled, or it is not one of ' +
        'the modules feature 090 Phase 3 migrates.',
    );
  }

  const declared = new Set(declaredCodes);
  const gaps: MigrationGap[] = [];
  for (const code of owned) {
    if (!declared.has(code)) {
      gaps.push({ code, kind: 'undeclared', chainAnswer: moduleId });
    }
  }
  for (const code of declaredCodes) {
    if (chainAnswers[code] === moduleId) continue;
    gaps.push({ code, kind: 'not-owned', chainAnswer: chainAnswers[code] ?? null });
  }
  return gaps.sort((a, b) => a.code.localeCompare(b.code));
}

/** One line per gap, in the words the migrating merge request needs. */
export function describeMigrationGaps(
  moduleId: string,
  gaps: readonly MigrationGap[],
): string {
  return gaps
    .map((gap) =>
      gap.kind === 'undeclared'
        ? `  - [undeclared] ${gap.code}: the chain routes it to ${moduleId} and the ` +
          'manifest does not declare it'
        : `  - [not-owned] ${gap.code}: ${moduleId} declares it and the chain routes it ` +
          `to ${gap.chainAnswer ?? 'nothing'}`,
    )
    .join('\n');
}
