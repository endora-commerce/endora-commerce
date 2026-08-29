import type { ModuleManifest } from '@endora-commerce/contracts';

/**
 * Dependency graph derived from a snapshot of every loaded manifest.
 *
 * Built once at boot and rebuilt on every state-changing lifecycle
 * operation. Pure in-memory; no I/O. The orchestrator drives every
 * lifecycle command through this graph for validation.
 */
export class ModuleDepGraph {
  /** moduleId → set of ids it directly depends on. */
  private readonly forward = new Map<string, Set<string>>();
  /** moduleId → set of ids that directly depend on it. */
  private readonly reverse = new Map<string, Set<string>>();
  /** Full manifest set, for callers that want metadata, not just edges. */
  private readonly manifests = new Map<string, ModuleManifest>();

  constructor(manifests: Iterable<ModuleManifest>) {
    for (const m of manifests) {
      this.manifests.set(m.id, m);
      this.forward.set(m.id, new Set(m.dependencies));
      if (!this.reverse.has(m.id)) this.reverse.set(m.id, new Set());
    }
    for (const [id, deps] of this.forward) {
      for (const dep of deps) {
        if (!this.reverse.has(dep)) this.reverse.set(dep, new Set());
        this.reverse.get(dep)!.add(id);
      }
    }
  }

  has(id: string): boolean {
    return this.manifests.has(id);
  }

  manifest(id: string): ModuleManifest | undefined {
    return this.manifests.get(id);
  }

  ids(): string[] {
    return [...this.manifests.keys()].sort();
  }

  /**
   * Detect a cycle. Returns a representative cycle (path of ids) when
   * the graph is cyclic, `null` when it is a DAG. Uses iterative DFS so
   * graphs with thousands of nodes don't blow the stack.
   */
  hasCycle(): { cycle: string[] } | null {
    type Color = 0 | 1 | 2; // 0 = white, 1 = grey, 2 = black
    const color = new Map<string, Color>();
    for (const id of this.manifests.keys()) color.set(id, 0);

    for (const start of this.manifests.keys()) {
      if (color.get(start) !== 0) continue;
      const stack: { id: string; iter: Iterator<string> }[] = [
        { id: start, iter: (this.forward.get(start) ?? new Set()).values() },
      ];
      const path: string[] = [start];
      color.set(start, 1);

      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        const next = top.iter.next();
        if (next.done) {
          color.set(top.id, 2);
          path.pop();
          stack.pop();
          continue;
        }
        const child = next.value;
        if (!this.manifests.has(child)) {
          // Dependency points to a non-existent module — caller handles
          // (different validation step); skip for cycle detection.
          continue;
        }
        const c = color.get(child);
        if (c === 1) {
          // Found a back-edge → cycle. Slice `path` from `child` to top.
          const startIdx = path.indexOf(child);
          return { cycle: [...path.slice(startIdx), child] };
        }
        if (c === 0) {
          color.set(child, 1);
          path.push(child);
          stack.push({
            id: child,
            iter: (this.forward.get(child) ?? new Set()).values(),
          });
        }
      }
    }
    return null;
  }

  /**
   * Topological order (dependency-first). Throws if the graph contains a
   * cycle — callers should call `hasCycle()` first when they want to
   * surface a friendly error.
   */
  topologicalOrder(): string[] {
    const cycle = this.hasCycle();
    if (cycle) {
      throw new Error(
        `[dep-graph] cannot topologically sort: cycle detected ` +
          `[${cycle.cycle.join(' → ')}]`,
      );
    }
    // Kahn's algorithm: indegree[X] = number of X's unmet deps. Start
    // from nodes with no deps (indegree 0); each pop removes that node
    // from the dependents' indegree counts. Result is dependency-first.
    const indegree = new Map<string, number>();
    for (const id of this.manifests.keys()) {
      indegree.set(id, this.forward.get(id)?.size ?? 0);
    }
    const queue: string[] = [];
    for (const [id, deg] of indegree) if (deg === 0) queue.push(id);
    queue.sort();
    const out: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      out.push(id);
      for (const dependent of this.reverse.get(id) ?? []) {
        const next = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, next);
        if (next === 0) {
          queue.push(dependent);
          queue.sort();
        }
      }
    }
    return out;
  }

  /**
   * Reverse topological order (dependents first). Useful for cascade
   * disable / hard-uninstall ordering.
   */
  reverseTopologicalOrder(): string[] {
    return this.topologicalOrder().slice().reverse();
  }

  /** Direct dependents of `id` (one-hop reverse edges). */
  dependentsOf(id: string): string[] {
    return [...(this.reverse.get(id) ?? new Set())].sort();
  }

  /** Transitive closure of dependents (all who reach `id` through reverse edges). */
  transitiveDependentsOf(id: string): string[] {
    const seen = new Set<string>();
    const stack = [...(this.reverse.get(id) ?? [])];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of this.reverse.get(cur) ?? []) stack.push(next);
    }
    return [...seen].sort();
  }

  /** Direct deps of `id` not present in `installed`. */
  unresolvedDependenciesOf(id: string, installed: ReadonlySet<string>): string[] {
    const out: string[] = [];
    for (const dep of this.forward.get(id) ?? []) {
      if (!installed.has(dep)) out.push(dep);
    }
    return out.sort();
  }
}

/**
 * Strongly connected components of a directed graph (Tarjan), iterative so a
 * large graph cannot blow the stack.
 *
 * **The platform owns this walk because two of its readers must not be able to
 * disagree about what a cycle is** (feature 080, D-160.11). It was
 * `backend/src/db/migration-order.ts`'s private helper, which made the
 * orchestrator's install refusal — *"with this module, [a, b] depend on each
 * other in a loop"* — a reach out of the platform into the host application,
 * for a pure graph walk. The host still reads it: `migration-order.ts` builds
 * the ordering graph's condensation from exactly this function, so the member
 * list an operator reads in a refused install is the member list the migration
 * order reports, by construction and not by two implementations agreeing.
 *
 * `neighboursOf` is the caller's, so an edge into a node the caller did not
 * declare is the caller's decision to skip or to keep.
 */
export function stronglyConnectedComponents(
  nodes: readonly string[],
  neighboursOf: (id: string) => readonly string[],
): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const discover = (id: string): void => {
    index.set(id, counter);
    lowLink.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
  };

  for (const root of nodes) {
    if (index.has(root)) continue;
    discover(root);
    // `edge` is how far through the node's neighbour list the walk has got.
    const work: { id: string; edge: number }[] = [{ id: root, edge: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const neighbours = neighboursOf(frame.id);
      if (frame.edge < neighbours.length) {
        const next = neighbours[frame.edge]!;
        frame.edge += 1;
        if (!index.has(next)) {
          discover(next);
          work.push({ id: next, edge: 0 });
        } else if (onStack.has(next)) {
          lowLink.set(frame.id, Math.min(lowLink.get(frame.id)!, index.get(next)!));
        }
        continue;
      }

      work.pop();
      if (lowLink.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
          if (member === frame.id) break;
        }
        components.push(component.sort());
      }
      const parent = work[work.length - 1];
      if (parent) lowLink.set(parent.id, Math.min(lowLink.get(parent.id)!, lowLink.get(frame.id)!));
    }
  }

  return components;
}

/**
 * Every dependency cycle in a module dependency map — one strongly connected
 * component of more than one module per entry, members sorted.
 *
 * The one derivation behind three reactions (feature 081, FR-012): a red unit
 * test for a cycle in this repository's own manifests, a `warn` at boot for one
 * on a running platform, and the orchestrator refusing an install whose arrival
 * closes a loop. An edge naming a module the map does not hold is skipped — a
 * *migration* claiming such a module is refused by the ordering's own step 1,
 * and a dependency on a module that is not there is not a cycle.
 */
export function moduleDependencyCycles(
  moduleDependencies: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const nodes = [...moduleDependencies.keys()];
  const neighboursOf = (id: string): readonly string[] =>
    (moduleDependencies.get(id) ?? []).filter((dependency) => moduleDependencies.has(dependency));
  return stronglyConnectedComponents(nodes, neighboursOf).filter(
    (members) => members.length > 1,
  );
}
