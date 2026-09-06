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
 * Every symbol of the platform's lifecycle half that a first-party source
 * outside the platform reaches **today** — which is the fourteen files
 * `RELATIVE_HOST_REACHES` records the application reaching: the twelve shims,
 * plus `backend.ts` and `manifest.ts`, which the two generated artefacts name.
 * Nothing else. `routes.storefront.ts` and `commands/activation.commands.ts` are
 * reached by no application file and are absent for that reason.
 *
 * So the barrel is derived from the ledger rather than curated, and
 * `test/unit/kernel/published-surface.test.ts` holds the two to each other in
 * both directions: a name here whose file no ledgered reach names is surface
 * parked against a future need, and a ledgered reach whose file contributes no
 * name is an entry that cannot retire — because retiring it means writing this
 * specifier instead, and there would be nothing here to write.
 *
 * A symbol **graduates** to a public barrel in the merge request that first
 * gives it a module-package production consumer, and leaves this one in the same
 * merge request (§5, R5.5). Two homes would be two answers to "is this public
 * API?". There is no such consumer today and none is anticipated.
 *
 * ## The second population, from Phase 3 on
 *
 * That derivation was the whole of it for exactly as long as the host reached
 * this surface only by relative path. Phase 3 moves the manifest registry's
 * derivation here (`manifest-registry.ts`, D115-2) and the module-id collision
 * rule with it (`services/module-id-claims.ts`), and the host names both through
 * **this specifier** — so their files are on the barrel and are named by no
 * ledgered reach, correctly. `published-surface.test.ts` therefore asks two
 * questions rather than one: every name a ledger-reached file exports is here,
 * so a shim can still retire onto it; and every other name here is one a
 * first-party source outside the platform actually imports from
 * `@endora-commerce/platform/lifecycle`, so the subpath is still not a place to
 * park surface against a future need. The second question is `./composition`'s
 * own ratchet, and it became non-vacuous in the same merge request that gave
 * this subpath its first consumer.
 */

// --- the module itself, as the generated artefacts name it ----------------
export { registerModule, type LifecycleCradle } from './backend.js';
export { manifest } from './manifest.js';
export {
  lifecycleModule,
  lifecycleModuleFromStaticEntries,
  type LifecycleModule,
  type LifecycleModuleDeps,
  type LifecycleModuleHandle,
} from './plugin.js';
export {
  registerApiInterceptorAdminRoutes,
  registerLifecycleAdminRoutes,
  registerModulePresenceRoutes,
  type ApiInterceptorAdminDeps,
  type LifecycleAdminDeps,
  type ModulePresenceAdminDeps,
} from './routes.admin.js';

// --- the orchestrator, and the lock every write takes ---------------------
export {
  LifecycleError,
  ModuleLifecycleOrchestrator,
  type DisableResult,
  type EnableResult,
  type InstallResult,
  type OrchestratorDeps,
  type UninstallResult,
} from './services/orchestrator.js';
export {
  acquireLifecycleLock,
  LifecycleLockError,
  LOCK_KEY,
  LOCK_REFRESH_INTERVAL_MS,
  LOCK_TTL_SECONDS,
  type LifecycleLeaseHandle,
} from './services/lock.js';

// --- the two graphs a presence decision is computed over ------------------
export {
  ModuleDepGraph,
  moduleDependencyCycles,
  orderModulesByDependencies,
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
  type AcknowledgedPortEdge,
  type NonBindingPortEdge,
  type PresencePredicate,
} from './services/gating-graph.js';
export {
  buildDeactivationLedger,
  deactivationConsequencesFor,
  type ConsequenceRow,
  type CrossModuleRead,
  type DeactivationLedger,
  type DeactivationOutcome,
  type LedgerEntry,
  type LedgerInput,
  type UnassignedEdge,
  type UnassignedShape,
} from './services/deactivation-ledger.js';

// --- discovering manifests, and what a build ships ------------------------
export {
  collectLifecycleParticipants,
  discoverManifests,
  folderNameFromPath,
  isLoadError,
  loadProjectManifests,
  ManifestLoadError,
  resolveFromFile,
  type DiscoverOptions,
  type LoadedLifecycleParticipant,
  type LoadedManifestRegistry,
  type LoadedModuleEntry,
} from './services/manifest-loader.js';
export {
  deploymentShippedEntries,
  type ModuleIdClaimOrigin,
  type OriginatedManifestEntry,
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
export { buildStaticRegistry, type StaticRegistryEntry } from './services/static-registry.js';
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
  type NeededBy,
  type ReducedDeploymentFinding,
  type ShippedModuleEntry,
} from './services/presence-load.js';
