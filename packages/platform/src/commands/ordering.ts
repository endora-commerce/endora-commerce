/**
 * The order of items contributed by modules to one Command Bus step, from the
 * manifest dependency graph — shared by command hooks
 * (`specs/176-command-hooks-outbox/` FR-013, FR-014) and `admit` command
 * middleware (`specs/189-command-middleware/` FR-030, FR-031, research R-9).
 *
 *  1. A module's items run after the items of every module it **transitively**
 *     depends on — the manifest graph is the order.
 *  2. Two modules the graph does not rank are ranked by the deployment's
 *     tie-break (first runs first) and refused otherwise — unless the caller
 *     says the pair needs no order (`requiresOrder`), which is how two `admit`
 *     middlewares with disjoint filters stay strangers. An entry that
 *     contradicts the graph is refused: the tie-break only breaks ties.
 *  3. One module's items keep the order it registered them in.
 *
 * The result is a topological order of those constraints, choosing the
 * smallest module id whenever more than one module is free, so it never
 * depends on the order the input arrived in (Principle XV: identical inputs,
 * identical order). Where every pair is ranked — always, for hooks — that order
 * is the only one.
 *
 * The errors are the caller's, so each step keeps its own error types and
 * messages.
 */

/** What every ordered item carries: its module and its global registration order. */
export interface ModuleGraphItem {
  readonly moduleId: string;
  readonly seq: number;
}

export interface ModuleGraphOrderOptions {
  /** Each module's **transitive** manifest dependencies. */
  readonly dependencies: Readonly<Record<string, readonly string[]>>;
  /** The deployment's tie-break, first runs first. */
  readonly tieBreak?: readonly string[] | undefined;
  /** Whether two modules the graph does not rank must be ranked. Defaults to always. */
  readonly requiresOrder?: ((a: string, b: string) => boolean) | undefined;
  /** The refusal for a pair that must be ranked and is not; `a` sorts before `b`. */
  readonly unordered: (a: string, b: string) => Error;
  /** The refusal for a tie-break that ranks `after` before `before`, which the graph forbids. */
  readonly contradiction: (before: string, after: string) => Error;
}

export function orderByModuleGraph<R extends ModuleGraphItem>(items: readonly R[], options: ModuleGraphOrderOptions): R[] {
  const byModule = new Map<string, R[]>();
  for (const entry of items) {
    const list = byModule.get(entry.moduleId) ?? [];
    list.push(entry);
    byModule.set(entry.moduleId, list);
  }
  for (const list of byModule.values()) list.sort((left, right) => left.seq - right.seq);

  const dependsOn = (module: string, other: string): boolean => (options.dependencies[module] ?? []).includes(other);
  const declared = options.tieBreak ?? [];
  const position = (module: string): number => declared.indexOf(module);
  const requiresOrder = options.requiresOrder ?? ((): boolean => true);

  // `before.get(m)` — the modules that must run before `m`.
  const modules = [...byModule.keys()].sort();
  const before = new Map<string, Set<string>>(modules.map((module) => [module, new Set<string>()]));

  // Ask every pair once, so a refusal is raised however the input arrived —
  // and in one deterministic order, so the same deployment always reports the
  // same pair first.
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      const a = modules[i]!;
      const b = modules[j]!;
      const aFirst = dependsOn(b, a);
      const bFirst = dependsOn(a, b);
      const pa = position(a);
      const pb = position(b);
      const ranked = pa >= 0 && pb >= 0;
      if (aFirst || bFirst) {
        if (ranked && aFirst !== pa < pb) {
          throw options.contradiction(aFirst ? a : b, aFirst ? b : a);
        }
        before.get(aFirst ? b : a)!.add(aFirst ? a : b);
        continue;
      }
      if (ranked) {
        before.get(pa < pb ? b : a)!.add(pa < pb ? a : b);
        continue;
      }
      if (requiresOrder(a, b)) throw options.unordered(a, b);
    }
  }

  // Kahn's algorithm, smallest free module id first. The constraints are
  // acyclic: dependency edges are a strict partial order, tie-break edges
  // follow positions, and a tie-break edge against a dependency path was
  // refused above.
  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < modules.length) {
    const next = modules.find((module) => !done.has(module) && [...before.get(module)!].every((m) => done.has(m)));
    if (next === undefined) {
      throw new Error('[commands/ordering] the module order has a cycle; the dependency closure is not acyclic.');
    }
    done.add(next);
    ordered.push(next);
  }
  return ordered.flatMap((module) => byModule.get(module)!);
}
