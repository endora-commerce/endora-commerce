/**
 * The transitive manifest `dependencies` closure — one traversal, two readers
 * (feature 097, `contracts/migration-cross-module-sql.md` §2).
 *
 * AGENTS.md § *Migrations* item 4 states one rule about a cross-module
 * reference in a migration: *"a new foreign key to another module's table
 * requires that module in your manifest's `dependencies` (transitively)"*. Two
 * instruments now enforce it over two disjoint populations —
 * `test/unit/db/fk-dependency-drift.test.ts` over **DDL** (`create table`,
 * `alter table`, `references "…"`) and `check-module-boundary.ts` over **DML**
 * (`select`, `insert`, `update`, `delete`, `with`) — and the closure they
 * compare against has to be the same closure or the two answer differently for
 * one edge.
 *
 * So the traversal lives here rather than in either of them. The contract says
 * it in as many words: *"if the implementer finds themselves writing a second
 * traversal, extract the first instead"*. This is that extraction; the FK test's
 * `closureOf` was the original and is now this function.
 *
 * **Transitive, not direct** (`specs/081-per-module-migration-order/contracts/ordering-algorithm.md`
 * Step 3): a module that declares `orders` inherits everything `orders`
 * declares, which is what the ordering algorithm itself walks, so a rule keyed
 * on the direct list alone would refuse edges the platform's own execution
 * order already guarantees.
 *
 * The pure half takes a declared map so a red proof can drive it from three
 * manifests rather than from the tree (issue #130); {@link loadManifestDependencies}
 * is the only part that knows where the generated index lives, and it reads it
 * with the same `DISCOVERED_MANIFESTS` import `switchable-modules.ts` and
 * `module-population.ts` use — three derivations of "which modules exist" that
 * cannot disagree.
 */
import { pathToFileURL } from 'node:url';

/** Module id → the ids its manifest declares in `dependencies`. */
export type DeclaredDependencies = ReadonlyMap<string, readonly string[]>;

/** Module id → every id reachable from it, itself excluded. */
export type DependencyClosures = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Every module transitively reachable from `moduleId`, itself excluded.
 *
 * A module that declares nothing, and a module the map has never heard of, both
 * answer with the empty set — which is the fail-**closed** direction for both
 * callers: an edge out of a module whose manifest could not be read is
 * undeclared, and is reported.
 */
export function closureOf(moduleId: string, dependencies: DeclaredDependencies): Set<string> {
  const reachable = new Set<string>();
  const stack = [...(dependencies.get(moduleId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next === moduleId || reachable.has(next)) continue;
    reachable.add(next);
    stack.push(...(dependencies.get(next) ?? []));
  }
  return reachable;
}

/**
 * {@link closureOf} for every module in the map, computed once.
 *
 * The per-access caller wants a lookup rather than a walk: `check-module-boundary`
 * asks the question once per cross-module table access, and re-walking the graph
 * 76 times is work nobody needs. The answer is identical to
 * {@link closureOf}'s by construction — it is that function.
 */
export function dependencyClosures(dependencies: DeclaredDependencies): DependencyClosures {
  const closures = new Map<string, ReadonlySet<string>>();
  for (const moduleId of dependencies.keys()) {
    closures.set(moduleId, closureOf(moduleId, dependencies));
  }
  return closures;
}

/**
 * Whether **any** manifest declared a dependency at all.
 *
 * The refusal `contracts/migration-cross-module-sql.md` §6.3 asks for: an empty
 * closure makes R1 fire on every cross-module access in the tree, so the failure
 * is loud rather than silent — but it is still a broken read, and reporting 59
 * findings that are all artefacts of it is worse than stopping. Exported as a
 * predicate rather than inlined so the proof enters where the caller does.
 */
export function declaresNoDependency(dependencies: DeclaredDependencies): boolean {
  for (const declared of dependencies.values()) {
    if (declared.length > 0) return false;
  }
  return true;
}

/** The generated manifest index could not be read as a dependency graph. */
export class ManifestDependenciesUnreadableError extends Error {}

/**
 * The declared graph, straight from the generated manifest index.
 *
 * Same artefact and same import shape as `loadManifestActivations` — an index
 * that will not import, and one that registers no module, are both errors rather
 * than an empty graph, because an empty graph is exactly what makes R1 fire on
 * everything.
 */
export async function loadManifestDependencies(
  indexPath: string,
): Promise<DeclaredDependencies> {
  let entries: ReadonlyArray<{ id: string; manifest: { dependencies?: readonly string[] } }>;
  try {
    const loaded = (await import(pathToFileURL(indexPath).href)) as {
      DISCOVERED_MANIFESTS?: ReadonlyArray<{
        id: string;
        manifest: { dependencies?: readonly string[] };
      }>;
    };
    entries = loaded.DISCOVERED_MANIFESTS ?? [];
  } catch (error: unknown) {
    throw new ManifestDependenciesUnreadableError(
      `${indexPath} could not be imported: ${String(error)}`,
    );
  }
  if (entries.length === 0) {
    throw new ManifestDependenciesUnreadableError(`${indexPath} declared no modules`);
  }
  return new Map(entries.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const));
}
