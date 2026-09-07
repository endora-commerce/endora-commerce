/**
 * `./lifecycle` — the platform's operator surface, and the third subpath that is
 * **declared and not published** (`specs/115-lifecycle-container-move/`, D115-4;
 * `contracts/operator-half.md` §5).
 *
 * ## Why it exists at all
 *
 * `_lifecycle` is one module whose sources sit in two artefacts. The manifest,
 * the routes, the Commands, the orchestrator and eight services are in
 * `packages/platform/src/lifecycle/`; the manifest registry, the divergence
 * loader and the five `module:*` commands are still in the application. The
 * application reaches the first half through twelve re-export shims, and each of
 * those shims forwards to `../../../../packages/platform/dist/lifecycle/…` — a
 * relative path into a sibling package's build output, which resolves in this
 * checkout and in **no client instance**. `manifest-index.generated.ts` carries
 * the same reach for `_lifecycle`'s manifest, which is the sharpest form of it:
 * the artefact whose whole job is to register the modules a build ships cannot
 * register `_lifecycle` anywhere but here.
 *
 * This barrel is the address those reaches are drained onto. It is one subpath
 * for one surface, deliberately — a second, `./lifecycle/commands`, would be a
 * second address for one thing, and a consumer that wants one symbol imports one
 * symbol.
 *
 * ## The rule it carries: no module may name it, ever
 *
 * D-160.11 refused to make `_lifecycle` its own package on the ground that it
 * would be *"a public API with one consumer forever"*. That is an argument
 * against **publishing** a surface and not against giving it an address, which
 * is the distinction this subpath is built on: it is declared by the `exports`
 * map, so `node` and `tsc` resolve it for the host, its five entry points and
 * the test kit, and it is carried by no *published* barrel, so
 * `check:platform-surface` reports a module naming it as `host-internal-subpath`
 * — with no change to that check, because `declaredSubpaths` is read off the
 * manifest rather than written down.
 *
 * `PUBLISHED_SUBPATHS` therefore stays at five, and that is not an omission to
 * be tidied later. `PlatformSurface.published` is keyed by target file with no
 * subpath dimension, so a sixth entry there would publish
 * `ModuleLifecycleOrchestrator` and `installGatingGraph` for a module's
 * *relative* reach at those files too, and — the check reporting `violations=0`
 * — would change nothing it prints. A blindness that arrives green.
 *
 * The rule the class encodes is one sentence: this surface **drives** the
 * platform's own presence axis, so a module that could name it could install,
 * uninstall, enable or disable its siblings. That is `./composition`'s reason
 * with one noun changed.
 *
 * ## What is on it, and why exactly this
 *
 * Exactly the names a first-party source outside the platform imports through
 * `@endora-commerce/platform/lifecycle`, and nothing else. It is a
 * **consequence** rather than a ruling — unlike `./composition`, whose 27
 * symbols D-160.14 names one by one — so writing the set down anywhere would be
 * a derived fact copied into a second place (D-100).
 * `test/unit/kernel/published-surface.test.ts` derives it from the consumers on
 * every run and holds the two to each other in both directions: a name here
 * that nobody imports is surface parked against a future need, and a name
 * imported that is not here is a consumer that cannot compile.
 *
 * A symbol **graduates** to a public barrel in the merge request that first
 * gives it a module-package production consumer, and leaves this one in the same
 * merge request (§5, R5.5). Two homes would be two answers to "is this public
 * API?". There is no such consumer today and none is anticipated.
 *
 * ## The population it was derived from until Phase 7, and why that ended
 *
 * The consumer rule could not be the rule while the application reached this
 * surface through fifteen re-export shims: nothing outside the platform named
 * the specifier, so the ratchet would have been green over nothing — issue
 * #113's shape. What stood in its place was a *ledger*-derived rule. Each shim
 * spells `export * from '<target>'`, so the application holds that file's whole
 * namespace, and a reach could retire onto this barrel only if every name it
 * yielded were here; the expected set was therefore a function of
 * `RELATIVE_HOST_REACHES` and the fourteen files it named.
 *
 * Phase 3 gave the subpath its first consumers, Phase 5 and Phase 6 added the
 * five command bodies and the two generated artefacts, and Phase 7 re-pointed
 * the 112 reaches in `backend/test/**` and deleted the last nine shims. So the
 * ledger derivation has no population left — no ledgered reach names a platform
 * lifecycle file, and none will again, because the address exists — and 28
 * names left with it: symbols that were here only because some shim's
 * `export *` yielded them and that nobody had ever asked for by name.
 * `routes.storefront.ts` and `commands/activation.commands.ts` were absent for
 * that same reason all along.
 */

// --- the five `module:*` command bodies, and the seam they take -----------
// D115-1: the argv grammar, the exit-code table, the orchestrator wiring and
// the operator's output moved here in Phase 5; five ~20-line entry points stay
// at their application paths and build the runtime. They were the first names
// here that no shim ever yielded — the host names them through this specifier —
// and since Phase 7 that is the only way any name earns its place.
export {
  type OperatorResources,
  type OperatorRuntime,
} from './commands/operator-runtime.js';
export { runInstallCommand } from './commands/install.js';
export { runUninstallCommand } from './commands/uninstall.js';
export { runEnableCommand } from './commands/enable.js';
export { runDisableCommand } from './commands/disable.js';
export { runStatusCommand } from './commands/status.js';

// --- the module itself, as the generated artefacts name it ----------------
// Phase 6 made this comment literally true: `composition.generated.ts` and
// `manifest-index.generated.ts` name **this specifier** for `_lifecycle`, so
// `backend.ts`, `manifest.ts` and `plugin.ts` are reached by nothing relative
// any more and are here because a consumer asks for these three names.
//
// Which is why five names left in that same merge request. `LifecycleCradle`,
// `lifecycleModule`, `LifecycleModule`, `LifecycleModuleDeps` and
// `LifecycleModuleHandle` were here only because the ledger rule then in force
// demanded **every** name a reached file exports, and with the reach gone
// nobody asks for them: the generated composition reads `registerModule` off
// its namespace import and `composition.ts` takes
// `lifecycleModuleFromStaticEntries`, and that is the whole of it. Parking a
// name against a future need is what R5.4 refuses, and
// `published-surface.test.ts` is what said so — in the phase that changed the
// specifier, not in the one that would later have wondered why they were here.
// Phase 7 repeated the exercise across the whole barrel, for 28 more.
export { registerModule } from './backend.js';
export { manifest } from './manifest.js';
export { lifecycleModuleFromStaticEntries } from './plugin.js';
export {
  registerLifecycleAdminRoutes,
} from './routes.admin.js';

// --- the orchestrator, and the lock every write takes ---------------------
export {
  LifecycleError,
  ModuleLifecycleOrchestrator,
} from './services/orchestrator.js';
export {
  acquireLifecycleLock,
  LifecycleLockError,
  LOCK_KEY,
} from './services/lock.js';

// --- the two graphs a presence decision is computed over ------------------
export {
  ModuleDepGraph,
  moduleDependencyCycles,
  sortComponentsTopologically,
  stronglyConnectedComponents,
} from './services/dep-graph.js';
export {
  acknowledgedPortEdgesFrom,
  gatingGraph,
  installGatingGraph,
  ModuleGatingGraph,
  nonBindingPortEdgesFrom,
  provideDefaultGatingManifests,
  type NonBindingPortEdge,
} from './services/gating-graph.js';
export {
  buildDeactivationLedger,
  deactivationConsequencesFor,
  type CrossModuleRead,
  type DeactivationLedger,
  type LedgerEntry,
  type LedgerInput,
  type UnassignedEdge,
} from './services/deactivation-ledger.js';

// --- discovering manifests, and what a build ships ------------------------
export {
  discoverManifests,
  folderNameFromPath,
  ManifestLoadError,
  type LoadedLifecycleParticipant,
  type LoadedManifestRegistry,
} from './services/manifest-loader.js';
// `module-origin.ts`'s shim had no importer left once Phase 6 re-pointed the
// application, which cost it `OriginatedManifestEntry` — a name nothing outside
// the platform asks for.
export {
  deploymentShippedEntries,
  type ModuleIdClaimOrigin,
} from './services/module-origin.js';
export {
  assertNoModuleIdCollisions,
  moduleIdCollisions,
  ModuleIdCollisionError,
  type ModuleIdClaim,
  type ModuleIdCollision,
} from './services/module-id-claims.js';
export {
  coreManifestEntries,
  ManifestPathMissingError,
  resolveManifestEntries,
  type DiscoveredManifestEntry,
  type ManifestSources,
  type OverlayModuleFound,
  type PackageModuleFound,
  type RegisteredManifestEntry,
} from './manifest-registry.js';
export { buildStaticRegistry } from './services/static-registry.js';
export { type MigrationOwnership } from './services/migration-ownership.js';

// --- what a deployment declares about differing from core -----------------
// The shape half only. The locator is `backend/src/overlay/divergence-loader.ts`
// and may not follow it here (D115-3): it composes a path in the tree that
// installs the platform, and the platform receives the parsed value as a field
// of `ComposeModulesOptions`, which is the seam it already had.
export {
  emptyDivergenceDeclaration,
  parseDivergenceDeclaration,
} from './divergence-declaration.js';

// --- reading presence out of the registry at boot -------------------------
export {
  assertLockedModulesPresent,
  firstBootInsertPopulation,
  loadModulePresence,
  ReducedDeploymentError,
  type ShippedModuleEntry,
} from './services/presence-load.js';
