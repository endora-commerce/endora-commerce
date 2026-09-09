/**
 * The platform's demo-data layer (feature 113 Phase 0, D-209).
 *
 * Four things, and the split is the design rather than tidiness:
 *
 *  - **`guard.ts`** — the production refusal, which must ship because a client
 *    running a demo seed against production is what it prevents (spec §7).
 *  - **`scope.ts`** — the reasons the one system scope carries (§3.4).
 *  - **`plan.ts`** — which modules contribute and in what order, decidable with
 *    no database, with presence answered before any context exists (§3.5).
 *  - **`runner.ts` / `report.ts`** — the invocation and what an operator reads.
 *
 * **This barrel has no `exports` subpath of its own.** It is reached through
 * `@endora-commerce/platform/composition`, the subpath D-160.14 created for host
 * composition surface that no module may name — which is exactly what this is: a
 * module *declares* demo data through `@endora-commerce/contracts` and never
 * names the runner, while the host CLI that composes the platform is the only
 * thing that runs it.
 *
 * Nothing here imports a module, and the composition that does is a **parameter**
 * (`DemoComposition`), which is what lets the runner live in the platform at all
 * (§5.3, D-52/D-53).
 */
export {
  classifySeedTarget,
  mustBeNonProduction,
  TEST_DATABASE_NAME_PATTERN,
  type SeedTargetVerdict,
} from './guard.js';
export { DEMO_RESET_SCOPE_REASON, DEMO_SEED_SCOPE_REASON } from './scope.js';
export {
  planDemoRun,
  type DemoManifestEntry,
  type DemoMode,
  type DemoPlan,
  type DemoPlanCounts,
  type DemoPlanSkip,
  type DemoPlanStep,
  type PlanDemoRunInput,
} from './plan.js';
export {
  DemoRunFailedError,
  runDemo,
  unwrapDemoFailure,
  type DemoComposition,
  type DemoCompositionResult,
  type DemoModuleOutcome,
  type DemoRunResult,
  type RunDemoInput,
} from './runner.js';
export { formatDemoReport } from './report.js';
