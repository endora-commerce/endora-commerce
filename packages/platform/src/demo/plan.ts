/**
 * The half of the demo runner that has no database in it (feature 113 Phase 0,
 * `specs/113-module-owned-demo-data/contracts/module-demo-data-layer.md` §3.5,
 * §3.6 and §4).
 *
 * Which modules contribute, in what order, and which are reported as skips —
 * all of it decided from the resolved manifest set and a presence oracle, so
 * the three properties that are easiest to get quietly wrong are testable with
 * no services at all.
 *
 * It is deliberately separate from `runner.ts`, which is the half that calls
 * things: **presence is decided here, before a context exists**, which is what
 * §3.5 asks for and what `backend/src/cli/module-commands.ts` already does for a
 * module-declared command. A plan that had already built contexts would have
 * done the work the gate is meant to prevent.
 */
import type { ModuleDemoManifest } from '@endora-commerce/contracts';
import {
  moduleDependencyCycles,
  orderModulesByDependencies,
} from '../lifecycle/services/dep-graph.js';

/** Seed or withdraw — the two directions the whole layer is written in. */
export type DemoMode = 'seed' | 'reset';

/**
 * The minimum of a resolved manifest entry the demo layer reads.
 *
 * Structural rather than `RegisteredManifestEntry`, for the reason
 * `CommandDeclaringEntry` gives: the three origins the platform resolves —
 * core, this deployment's overlay and an installed package — reach here as one
 * array and none of them is more this file's business than the others.
 */
export interface DemoManifestEntry {
  readonly id: string;
  readonly dependencies: readonly string[];
  /** `undefined` — nobody decided; `false` — nothing to demonstrate; an object — a body (§1.2). */
  readonly demo?: ModuleDemoManifest<never> | false;
}

/** One module the run will invoke. */
export interface DemoPlanStep {
  readonly moduleId: string;
  readonly demo: ModuleDemoManifest<never>;
}

/**
 * One module the run will not invoke, and why.
 *
 * The population is deliberately narrow: a module that **declares a body** and
 * is not effectively present. That is §3.7's *"an absent module is a reported
 * skip, never an error and never a silence"*. A module that declares `false`
 * and a module nobody has decided about are counted rather than listed — 57
 * lines saying "this module has nothing to demonstrate" is a report nobody
 * reads, and neither state is a skip: there was nothing to run.
 */
export interface DemoPlanSkip {
  readonly moduleId: string;
  readonly reason: 'not-present';
}

/** The two quiet states of §1.2, counted so the report can account for them. */
export interface DemoPlanCounts {
  /** Modules declaring `demo: false` — a decision that owes nothing. */
  readonly declaredNone: number;
  /** Modules declaring nothing at all — nobody has decided. */
  readonly undecided: number;
}

export interface DemoPlan {
  readonly mode: DemoMode;
  readonly steps: readonly DemoPlanStep[];
  readonly skipped: readonly DemoPlanSkip[];
  readonly counts: DemoPlanCounts;
  /** Reported, never fatal (§4.5). */
  readonly diagnostics: readonly string[];
}

export interface PlanDemoRunInput {
  readonly mode: DemoMode;
  /** The set the composition was actually built from. */
  readonly entries: readonly DemoManifestEntry[];
  /**
   * Effective presence — platform-available **and** operator-activated
   * (Constitution XVII, §3.6). Injected rather than reached for, so the plan is
   * decidable without a registry cache and so the host stays the one place that
   * knows what "present" means here.
   */
  readonly isPresent: (moduleId: string) => boolean;
}

/**
 * Which modules contribute, in what order.
 *
 * ## The order is the platform's, not this file's (§4.1)
 *
 * `orderModulesByDependencies` is the walk the migration order builds its own
 * order from, so a demo run and a migration run cannot come to disagree about
 * what "after" means. What this file adds is the **advisory** `after` edges
 * (§4.3): they go into the same graph, are read by the same walk, and put no
 * module in anyone's `dependencies`. The measured case is `megamenu`, whose demo
 * menu mirrors `catalog`'s demo categories and which does not declare `catalog`
 * — and must not begin to for the sake of a fixture (D-209).
 *
 * The graph is built over **every** entry, not only the declaring ones, so a
 * module that ships no demo data still orders the two that do through it. Only
 * the declaring, present ones become steps.
 *
 * An `after` entry naming a module that is not in the run orders nothing and is
 * not a finding (§4.4) — that falls out of `orderModulesByDependencies` skipping
 * an edge into a node the map does not hold, and it is the ordinary case in a
 * partial install rather than an exception to be reported. §4.4's *"MAY be
 * reported"* for an id the vocabulary does not hold is deliberately not taken:
 * from inside a client's instance the two states are one, and the diagnostic
 * would fire on every correct partial install.
 *
 * A cycle is a **reported diagnostic and never a throw** (§4.5), on
 * `migration-order.ts`' reasoning: a manifest can arrive from an installed
 * package, and one stranger's declaration must not stop a shop's own demo from
 * seeding. Its members come out contiguous, in id order.
 */
export function planDemoRun(input: PlanDemoRunInput): DemoPlan {
  const declaring = new Map<string, ModuleDemoManifest<never>>();
  let declaredNone = 0;
  let undecided = 0;

  for (const entry of input.entries) {
    if (entry.demo === undefined) undecided += 1;
    else if (entry.demo === false) declaredNone += 1;
    else declaring.set(entry.id, entry.demo);
  }

  // Presence, once per declaring module, before anything is built. It is asked
  // about the **declaring** module and never about a dependency: that answer is
  // the owner's own gate's, and asking it twice is how the two come to disagree
  // (D-157.5).
  const skipped: DemoPlanSkip[] = [];
  const running = new Map<string, ModuleDemoManifest<never>>();
  for (const [moduleId, demo] of declaring) {
    if (input.isPresent(moduleId)) running.set(moduleId, demo);
    else skipped.push({ moduleId, reason: 'not-present' });
  }

  const graph = new Map<string, readonly string[]>();
  for (const entry of input.entries) {
    const after = running.get(entry.id)?.after ?? [];
    graph.set(entry.id, [...entry.dependencies, ...after]);
  }

  const diagnostics = moduleDependencyCycles(graph).map(
    (members) =>
      `[demo] modules [${members.join(', ')}] order each other in a loop, counting ` +
      `\`demo.after\`. Their demo data runs as one block in module-id order, because ` +
      `the declarations contain no order.`,
  );

  const ordered = orderModulesByDependencies(graph).filter((id) => running.has(id));
  const sequence = input.mode === 'reset' ? [...ordered].reverse() : ordered;

  return {
    mode: input.mode,
    steps: sequence.map((moduleId) => ({ moduleId, demo: running.get(moduleId)! })),
    skipped: skipped.sort((left, right) => left.moduleId.localeCompare(right.moduleId)),
    counts: { declaredNone, undecided },
    diagnostics,
  };
}
