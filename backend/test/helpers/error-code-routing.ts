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
