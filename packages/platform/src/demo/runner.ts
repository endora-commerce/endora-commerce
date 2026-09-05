/**
 * The demo runner (feature 113 Phase 0,
 * `specs/113-module-owned-demo-data/contracts/module-demo-data-layer.md` §3 and
 * §5.5).
 *
 * Given a plan, invoke each module's body with that module's own context, run
 * the instance's composition at the one point in the sequence where it belongs,
 * and return a report. Everything decidable without a database is `plan.ts`'s;
 * this file is the part that calls things.
 *
 * ## What it deliberately does not do
 *
 * It does not open a scope and it does not call the production guard. Both are
 * the **entry point's** (§3.3, §3.4): the guard runs first, before anything is
 * composed, outside every `try`, and the scope is opened once for the whole run
 * over the composition's own container. A runner that opened its own would be a
 * second entry point, which is exactly the property §3.4 buys by taking the
 * responsibility off every module's body.
 *
 * It also holds no module list of its own and imports from no module. It is
 * handed the resolved manifest set, a presence oracle and a context factory —
 * which is what lets it live in the platform at all (D-52/D-53).
 */
import type {
  DemoCredential,
  DemoEntityCount,
  ModuleDemoContext,
  ModuleDemoManifest,
} from '@endora-commerce/contracts';
import {
  planDemoRun,
  type DemoManifestEntry,
  type DemoMode,
  type DemoPlanCounts,
  type DemoPlanSkip,
} from './plan.js';

/**
 * The cross-module wiring, supplied by whoever owns the instance (§5, D-209).
 *
 * It is a **parameter** and never an import: a composition names `megamenu` and
 * `catalog`, and a platform root that named a module would be D-52/D-53's one
 * rule with an exception. In this repository the host passes its own; in a
 * client's instance the scaffold writes one into their tree and their entry
 * point passes that.
 */
export interface DemoComposition {
  /** Runs after every module's `seed` and before the summary (§5.5). */
  apply(): Promise<DemoCompositionResult>;
  /** Runs before any module's `reset` (§5.5). */
  withdraw(): Promise<DemoCompositionResult>;
}

/**
 * What a composition reports.
 *
 * `skipped` is not an afterthought — it is FR-011 and US2's first acceptance
 * scenario. Every step is guarded by an effective-presence question about every
 * module it touches, and a step whose modules are not all present is a reported
 * skip carrying the reason (§5.4): never a throw, never a silence.
 */
export interface DemoCompositionResult {
  readonly applied: readonly string[];
  readonly skipped: readonly { readonly step: string; readonly reason: string }[];
}

/** What one module contributed. */
export interface DemoModuleOutcome {
  readonly moduleId: string;
  readonly summary: string;
  readonly entities: readonly DemoEntityCount[];
  readonly notes: readonly string[];
}

export interface DemoRunResult {
  readonly mode: DemoMode;
  readonly modules: readonly DemoModuleOutcome[];
  readonly skipped: readonly DemoPlanSkip[];
  readonly counts: DemoPlanCounts;
  readonly credentials: readonly DemoCredential[];
  readonly diagnostics: readonly string[];
  /** Absent when the caller supplied no composition. */
  readonly composition?: DemoCompositionResult;
}

/**
 * A module's demo body failed, and the run failed with it (§3.8).
 *
 * *"A demo seed that half-succeeded silently is worse than one that failed: the
 * operator cannot tell a partial demo from a complete one."* So the throw is
 * unconditional and nothing is swallowed — the original error is the `cause`,
 * unmodified, which is what keeps the entry point's `ModuleDisabledError`
 * discrimination working through one `unwrapDemoFailure` call rather than
 * through a `catch` that decides anything.
 */
export class DemoRunFailedError extends Error {
  constructor(
    readonly moduleId: string,
    readonly mode: DemoMode,
    override readonly cause: unknown,
  ) {
    super(
      `[demo] module '${moduleId}' failed while the demo ${mode} was running: ` +
        `${cause instanceof Error ? cause.message : String(cause)}. Nothing after it ran; ` +
        `the rows it wrote before failing are still there. Run the demo reset before ` +
        `trying again.`,
    );
    this.name = 'DemoRunFailedError';
  }
}

/**
 * The error a demo run really failed with.
 *
 * Not a `catch` and not a decision: it unwraps one known wrapper so that an
 * entry point's existing discrimination — `err instanceof ModuleDisabledError`
 * — sees what it saw before this layer existed. Everything else passes through.
 */
export function unwrapDemoFailure(error: unknown): unknown {
  return error instanceof DemoRunFailedError ? error.cause : error;
}

export interface RunDemoInput {
  readonly mode: DemoMode;
  readonly entries: readonly DemoManifestEntry[];
  readonly isPresent: (moduleId: string) => boolean;
  /** The composition's own context factory — `ComposeAppHandle.contextFor`. */
  readonly contextFor: (moduleId: string) => unknown;
  readonly composition?: DemoComposition;
}

async function invoke(
  mode: DemoMode,
  demo: ModuleDemoManifest<never>,
  context: ModuleDemoContext<never>,
): Promise<{
  entities: readonly DemoEntityCount[];
  result: { notes?: readonly string[]; credentials?: readonly DemoCredential[] };
}> {
  if (mode === 'seed') {
    const result = await demo.seed(context);
    return { entities: result.created, result };
  }
  const result = await demo.reset(context);
  return { entities: result.removed, result };
}

/**
 * Run one demo pass and report it.
 *
 * The sequence is §3's, in full: plan (which decides presence), then each
 * module in order, with the composition applied after the last `seed` or
 * withdrawn before the first `reset` (§5.5).
 */
export async function runDemo(input: RunDemoInput): Promise<DemoRunResult> {
  const plan = planDemoRun({
    mode: input.mode,
    entries: input.entries,
    isPresent: input.isPresent,
  });

  let composition: DemoCompositionResult | undefined;
  if (input.composition && input.mode === 'reset') {
    composition = await input.composition.withdraw();
  }

  const modules: DemoModuleOutcome[] = [];
  const credentials: DemoCredential[] = [];
  for (const step of plan.steps) {
    // The context is built here and nowhere earlier: §3.5's gate is upstream of
    // it, in `planDemoRun`.
    const context = { ctx: input.contextFor(step.moduleId) } as ModuleDemoContext<never>;
    try {
      const { entities, result } = await invoke(input.mode, step.demo, context);
      modules.push({
        moduleId: step.moduleId,
        summary: step.demo.summary,
        entities,
        notes: result.notes ?? [],
      });
      if ('credentials' in result && result.credentials) credentials.push(...result.credentials);
    } catch (error) {
      // Unconditional, and the only statement in the block: nothing is
      // swallowed and no error is classified here. `DemoRunFailedError` adds
      // the module's name, which is the whole of §3.8, and keeps the original
      // as its `cause`.
      throw new DemoRunFailedError(step.moduleId, input.mode, error);
    }
  }

  if (input.composition && input.mode === 'seed') {
    composition = await input.composition.apply();
  }

  return {
    mode: plan.mode,
    modules,
    skipped: plan.skipped,
    counts: plan.counts,
    credentials,
    diagnostics: plan.diagnostics,
    ...(composition === undefined ? {} : { composition }),
  };
}
