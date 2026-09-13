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
 * ## `./demo`, a host-internal subpath of its own
 *
 * `specs/110-instance-repository/` T119b. This barrel had **no `exports` subpath
 * at all**, and its own header said it was reached through
 * `@endora-commerce/platform/composition` while the shim above it said the
 * opposite in as many words — *"it is deliberately not on `./composition` … so
 * this is the ordinary host-internal reach the other platform shims are, naming
 * the built file directly"*. What was true of neither sentence: five application
 * consumers reached `packages/platform/dist/demo/index.js` through a re-export
 * shim, a specifier that resolves in this checkout and in no client's, which is
 * the state `check:platform-surface`'s application half exists to refuse.
 *
 * The shim's reasoning — *"widening a ruling's table to save a shim would be a
 * self-certified exemption issued by the party being measured"* — was right
 * about `./composition`, and is answered by giving this directory an address of
 * its own instead. It is **host-internal**, for `./composition`'s own reason: a
 * module *declares* demo data through `@endora-commerce/contracts` and never
 * names the runner, while the thing that runs one has already composed the
 * platform. `PUBLISHED_SUBPATHS` is unchanged at five, and a module naming
 * `@endora-commerce/platform/demo` is `host-internal-subpath` — refused.
 *
 * ## Why it carries less than it used to export
 *
 * What is on it is a **consequence**, not a ruling, so it is held to its
 * consumers by `test/unit/kernel/published-surface.test.ts` in `./lifecycle`'s
 * shape rather than `./composition`'s written table: *a name on the barrel that
 * no first-party source outside the platform imports is surface parked against a
 * future need*. Eighteen names were in exactly that state and left in the merge
 * request that gave the directory an address — `planDemoRun`,
 * `classifySeedTarget`, `createDemoPackageResolver`, the plan and run-result
 * shapes among them. They were unreachable while there was no subpath, so
 * nothing had ever asked for one of them by name; publishing them on the day the
 * address arrives would park the directory's internals against a need nobody
 * has. Adding one back is not a breaking change and belongs to the merge request
 * that gives it a consumer.
 *
 * Nothing here imports a module, and the composition that does is a **parameter**
 * (`DemoComposition`), which is what lets the runner live in the platform at all
 * (§5.3, D-52/D-53).
 *
 * ## What `specs/123-oss-install-experience/` G2 took off it, and why that is
 * the ratchet working rather than a regression
 *
 * Six names went — `formatDemoReport`, `unwrapDemoFailure`, `DemoManifestEntry`
 * and `DemoMode`, and the whole of what `host-command.ts` would have added. G2
 * moved the demo **dispatch** into `../cli/dispatch.ts`, so the files that used
 * to import those six from outside the package — `backend/src/cli.ts` and
 * `backend/src/cli/demo-command.ts` — either no longer name them or are in this
 * package now. A name whose last first-party consumer outside the platform went
 * with the move is surface parked against a future need, which is exactly what
 * the paragraph above says a subpath is not a place for, and
 * `test/unit/kernel/published-surface.test.ts` holds the barrel to it in both
 * directions.
 *
 * `host-command.ts` is therefore reachable from outside at three names and not
 * thirteen: the notice and the two composition-loader shapes, which
 * `backend/src/demo/composition-loader.ts` imports because locating a tree's own
 * composition stays that tree's (`operator-half.md` §1.1). `DEMO_HOST_COMMANDS`,
 * `demoEntriesFrom`, `parseDemoVerb` and the rest have one consumer and it is
 * `../cli/dispatch.ts`, one directory over inside this package, which reaches
 * them by relative path and needs no address for them at all.
 *
 * Adding one back is not a breaking change and belongs to the merge request that
 * brings it a consumer.
 */
export { mustBeNonProduction, TEST_DATABASE_NAME_PATTERN } from './guard.js';
export { DEMO_RESET_SCOPE_REASON, DEMO_SEED_SCOPE_REASON } from './scope.js';
export { runDemo, type DemoComposition, type DemoCompositionResult } from './runner.js';
export {
  NO_DEMO_COMPOSITION_NOTICE,
  type DemoCompositionInput,
  type DemoCompositionLookup,
} from './host-command.js';
