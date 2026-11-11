/**
 * When module W may change, or in a `down()` destroy, what module O owns: when
 * O cannot be present while W's statement runs (`specs/178-extensible-columns/`
 * D-291 R-A7; `specs/134-paid-module-extraction/` T118 / D14 §6).
 *
 *   - **(a) `owner-depends-on-writer`** — W is in O's dependency closure, so
 *     `dependents-block` removes O before W can be reverted, and a `down()` of W
 *     only clears O's residue;
 *   - **(b) `writer-is-core`** — the platform is always present;
 *   - **(c) `both-required`** — W and O are both in the required set derived
 *     from `activation.nonDeactivatable`, which D-69 never lets go, so W's revert
 *     is unreachable.
 *
 * **One implementation, three readers**: the runtime foreign-schema guard,
 * `composer:generate`'s `derived-down` exemption entries, and
 * `backend/test/unit/db/foreign-column-ddl.test.ts`. Every clause is derived,
 * so a site that passes because both modules are locked turns red on its own
 * the day a lock is withdrawn.
 */

export type ReverseEdgeClause = 'owner-depends-on-writer' | 'writer-is-core' | 'both-required';

/** The module id the platform's own migrations are filed under. */
const CORE = 'core';

/** Every module `moduleId` reaches through `dependencies`, itself excluded. */
export function dependencyClosureOf(
  moduleId: string,
  dependencies: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...(dependencies.get(moduleId) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(dependencies.get(next) ?? []));
  }
  seen.delete(moduleId);
  return seen;
}

/** The required set, derived from the manifests — never written down. */
export function requiredModulesOf(
  manifests: ReadonlyArray<{ readonly id: string; readonly manifest: { readonly activation?: unknown } }>,
): Set<string> {
  return new Set(
    manifests
      .filter((entry) => (entry.manifest.activation as { nonDeactivatable?: unknown } | undefined)?.nonDeactivatable === true)
      .map((entry) => entry.id),
  );
}

/** Which clause lets W act on what O owns, or `null` when none does. */
export function reverseEdgeClause(input: {
  readonly writer: string;
  readonly owner: string;
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
  readonly required: ReadonlySet<string>;
}): ReverseEdgeClause | null {
  if (input.writer === CORE) return 'writer-is-core';
  if (dependencyClosureOf(input.owner, input.dependencies).has(input.writer)) return 'owner-depends-on-writer';
  if (input.required.has(input.writer) && input.required.has(input.owner)) return 'both-required';
  return null;
}
