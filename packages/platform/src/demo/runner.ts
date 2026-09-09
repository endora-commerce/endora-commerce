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
  /**
   * The **foundation**: rows every module's demo body already assumes, created
   * before the first `seed` (§5.5a, feature 113 T226).
   *
   * ## Why a second phase exists, measured rather than argued
   *
   * §5.5's single after-the-modules position is right for *wiring* — a step
   * that joins two modules' rows can only run once both exist. It is wrong for
   * a row a module's body **reads**, and this repository holds exactly one:
   * the demo's two sales channels. `sales_channels` is the kernel's table, so
   * no module may declare it as demo data (§2.1) and the kernel carries no
   * `demo` field; and `inventory`'s body does `em.find(SalesChannel, {})` and
   * assigns the demo warehouse to every channel it finds. Created in `apply`,
   * the second channel arrives after that read has happened and
   * `pl_b2b_vip` silently loses its `warehouse_channel_assignments` row.
   *
   * Measured before this phase existed: `inventory` reports
   * `WarehouseChannelAssignment 2` on a seed where the channels precede it and
   * would report 1 where they do not, with nothing failing.
   *
   * It is **optional**, and an instance that declares none is an ordinary
   * instance rather than a degraded one — §5.6's rule for a composition that is
   * absent entirely, one level down. A composition written against the
   * Phase-0 interface keeps working unchanged, which is §6.5's property applied
   * to this interface rather than to the hatch.
   */
  applyFoundation?(): Promise<DemoCompositionResult>;
  /**
   * The mirror of {@link DemoComposition.applyFoundation}: runs **after** the
   * last module's `reset` (§5.5a).
   *
   * The position is forced rather than chosen. A withdrawal is the reverse of
   * the sequence that built it, so the foundation goes last — and here that is
   * the difference between a filtered delete and a cascade: withdrawing the
   * demo's sales channels *before* `inventory`'s `reset` would take that
   * module's assignment rows with them through the database rather than
   * through the module that owns them, which is an unfiltered destruction by
   * another name.
   */
  withdrawFoundation?(): Promise<DemoCompositionResult>;
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
  /**
   * Sign-in details this composition created, merged into the run's own list
   * and formatted once by {@link formatDemoReport} (feature 113, T226).
   *
   * A composition creates accounts a module cannot: `customer_accounts.
   * organization_id` is `NOT NULL` under Principle XI, so the demo buyer is
   * created by a composition step and by nothing else, and until this field
   * existed the only thing that could print its password was the legacy seed
   * script — which this task deletes. Without it the composed path would have
   * printed three of the four pairs and said nothing about the fourth, which
   * is the silent half-report §3.7 is written against.
   */
  readonly credentials?: readonly DemoCredential[];
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
  /**
   * Absent when the caller supplied no composition.
   *
   * Both phases (§5.5a) are here, concatenated in the order they ran: the
   * foundation's steps and the wiring's are one list because an operator reads
   * a sequence, and the step name — the composition's own sentence — is what
   * says which is which.
   */
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
 * The phases of one run, as a single result.
 *
 * Concatenation in execution order, and it has one property worth naming: an
 * empty phase contributes nothing, so a composition that declares no foundation
 * produces exactly the result it produced before the phase existed. That is
 * what makes §5.5a additive rather than a change to what an operator reads.
 */
function mergePhases(phases: readonly DemoCompositionResult[]): DemoCompositionResult {
  const credentials = phases.flatMap((phase) => phase.credentials ?? []);
  return {
    applied: phases.flatMap((phase) => phase.applied),
    skipped: phases.flatMap((phase) => phase.skipped),
    ...(credentials.length === 0 ? {} : { credentials }),
  };
}

/**
 * Run one demo pass and report it.
 *
 * The sequence is §3's and §5.5a's, in full: plan (which decides presence),
 * then the foundation, then each module in order, then the wiring —
 *
 * ```
 * seed   applyFoundation? -> module seed  (dependency order) -> apply
 * reset  withdraw         -> module reset (reverse order)    -> withdrawFoundation?
 * ```
 *
 * — so `reset` is the exact reverse of `seed` at every position, which is the
 * property that lets a withdrawal be a filtered delete rather than a cascade.
 */
export async function runDemo(input: RunDemoInput): Promise<DemoRunResult> {
  const plan = planDemoRun({
    mode: input.mode,
    entries: input.entries,
    isPresent: input.isPresent,
  });

  // Every phase this run executes, in the order it executed them. The two
  // phases are reported as **one** result rather than as a pair, and that is a
  // decision rather than a shortcut: a step's name is the composition's own
  // sentence, an operator reads the list as a sequence, and §6.5's *"the
  // report's shape"* is a property this feature keeps. `phases` is what the
  // merge is built from so that the merge itself is one statement.
  const phases: DemoCompositionResult[] = [];
  const runPhase = async (
    phase: (() => Promise<DemoCompositionResult>) | undefined,
  ): Promise<void> => {
    if (phase === undefined) return;
    phases.push(await phase.call(input.composition));
  };

  if (input.mode === 'reset') {
    await runPhase(input.composition?.withdraw);
  } else {
    await runPhase(input.composition?.applyFoundation);
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

  if (input.mode === 'seed') {
    await runPhase(input.composition?.apply);
  } else {
    await runPhase(input.composition?.withdrawFoundation);
  }

  const composition = phases.length === 0 ? undefined : mergePhases(phases);
  return {
    mode: plan.mode,
    modules,
    skipped: plan.skipped,
    counts: plan.counts,
    // The modules' first and the composition's after, which is the order they
    // were created in. A module's own account is its own rows; the
    // composition's is the one no module could create.
    credentials: [...credentials, ...(composition?.credentials ?? [])],
    diagnostics: plan.diagnostics,
    ...(composition === undefined ? {} : { composition }),
  };
}
