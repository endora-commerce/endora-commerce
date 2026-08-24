/**
 * CI check — a module reaches the platform only through what the platform
 * publishes (feature 080, T042d; ruling **D-160.8**).
 *
 * ## Why it exists
 *
 * `specs/080-f4-real-scope/contracts/host-package.md` §1 classifies all 53
 * platform files a module reaches as **P** (published API), **A** (accidental
 * reach — host-internal, harness-only or orchestrator-only) or **O** (the
 * module is reaching for a class where a sanctioned port exists). Three
 * delivered rows now build on that classification, and **nothing in the
 * repository enforced it**: `check:module-boundary` is module→module,
 * `check:kernel-boundary` is ORM relations, and the `exports` map D-160.7 rules
 * enforces nothing at all for the modules still in `backend/src` — which is all
 * of them. A classification with no ratchet rots at the speed of the tree, and
 * this one is load-bearing for the package split.
 *
 * ## The population, and what it misses
 *
 * Every **relative import specifier** written in a module's own sources — core
 * under the application's module roots, overlay under `src/apps` — that
 * resolves to a file outside the module tree. "Outside the module tree" is the
 * whole predicate: the host is everything that is not a module, so a reach into
 * `src/seeds` or `src/composition.ts` is judged by the same rule as one into
 * `src/kernel`, with no directory list to keep current. Every specifier shape
 * `scripts/lib/specifiers.ts` knows is read, `import type` and the one
 * type-position `import('…')` included (§0b: a `from '…'`-only scan does not see
 * it, and a module would move with an unrewritten specifier that `tsc` resolves
 * and `node` never sees).
 *
 * **What that misses, stated rather than discovered later.** A specifier is not
 * the only way to reach something, and `check:module-boundary` learned it the
 * expensive way — it had to grow a SQL-table predicate for 121 reaches that name
 * no specifier at all. The same three doors are open here and none of them is
 * this check's:
 *
 *   * **A container name.** `lazyPort('settingsReadPort')` reaches the platform
 *     through a string. That edge is `check:port-dependencies`' and
 *     `check:port-shape`'s, which between them own the port surface;
 *     `PLATFORM_OWNED_NAMES` is where a platform-owned name is declared.
 *   * **A platform-owned table.** `settings`, `audit_logs`,
 *     `module_registrations` and `sales_channels` are the host's, and SQL naming
 *     one names no specifier. `check:module-boundary`'s SQL predicate reads
 *     module-owned tables only, so a module→**platform** table reach is
 *     currently nobody's — the honest statement of the hole, and the natural
 *     second signal here once the host package exists to make it mean something.
 *   * **A bare specifier into the host package.** There is no host package yet
 *     (D-160.5 keeps everything private through Wave 4). When there is, its
 *     `exports` map refuses a deep path at resolution time and this check's
 *     relative-specifier population shrinks to nothing on its own. Nothing here
 *     names a package scope, deliberately: the five `@b2b/*` packages are being
 *     renamed to `@endora-commerce/*` (D-161) and a hard-coded scope is a check
 *     that breaks on a rename.
 *
 * ## The granularity: per symbol, of a named file
 *
 * A finding is a **(module file, platform file, symbol)** triple, and the
 * verdict is "does that platform file's barrel publish that name". Not per file,
 * and the difference is not academic — !883 measured it: sixteen symbols of
 * **P** files are reached by nobody and are deliberately unpublished, so
 * "the file is P" licenses `SettingsCache`, `decryptSecretValue` and the LRU
 * tuning constants along with the symbols the classification actually names.
 *
 * **What per-*file* granularity would catch that this will not.** A per-file
 * check would refuse every reach into an **A** or **O** file outright, symbol or
 * no symbol — so it would flag `SettingNotRegistered` imported from
 * `settings.service.ts` (row 8, **O**), `parseHostMap` from
 * `sales-channel-resolver.service.ts` (row 24, **O**) and
 * `MembershipMutationResult` from `sales-channel-membership.service.ts` (row 15,
 * **O**). Eight such symbols stand today and §8 rules every one of them
 * *published* on purpose — a `@throws` a caller cannot name is a method a caller
 * cannot call. So the per-file verdict would be eight false findings, and its
 * one genuine catch is a different question: *is this symbol rightly on the
 * barrel at all?* That question belongs to
 * `test/unit/kernel/published-surface.test.ts`, which holds each barrel to
 * §1.3's own symbol column in both directions. The two are deliberately not
 * duplicates: that test asks whether the barrel is right, this check asks
 * whether the tree obeys it, and both read the barrel through
 * `scripts/lib/platform-surface.ts` so they cannot disagree about what it says.
 *
 * **That gap is closed** (T042f). It read, until then: `!883` prunes and
 * ratchets three of the five barrels, and `tenancy/index.ts` and
 * `commands/index.ts` are published surface by D-160.7 with no expected set at
 * all — so for two of this check's five subpaths its authority was a barrel
 * nothing held to §1.3. Both are now pruned to their **P** columns (§1.3 rows
 * 2, 5, 12, 21, 28, 30, 33) and ratcheted two-way, and
 * `published-surface.test.ts` derives its own population from
 * {@link PUBLISHED_SUBPATHS} rather than a list, so a sixth published directory
 * cannot arrive unratcheted the way these two did.
 *
 * Worth recording, because a green that moves nothing is the outcome most
 * likely to be misread: closing it moved **no** ledger key and no finding. The
 * 37 names the two barrels shed are reached by no module, and every name a
 * module reaches stayed published — so nothing had been hiding behind the
 * unratcheted barrels. The value bought is prospective: a 38th name added to
 * either now has to move an expected set.
 *
 * ## Four findings
 *
 *   * `unpublished-symbol` — the rule itself.
 *   * `whole-file-reach` — `import * as`, a side-effect import, `export *`, a
 *     `require()` or a dynamic `import()` with no named binding, at a file that
 *     is not a barrel. The symbol set is not knowable from the specifier, so the
 *     reach is the file's *whole* surface, internals included.
 *   * `unresolvable-reach` — a relative specifier that names no file the walk
 *     found. It is a finding and not a skip: !879 found #215 one layer in, where
 *     a walk of the right length had its *result* discarded downstream and
 *     reported clean behind a full-length `read:` line.
 *   * `unattributed-source` — a file under a module walk root that no module
 *     owns. Same reason: a file walked and not judged is worse than one not
 *     walked, because the `read:` line counts it.
 *
 * ## One key space, and it is the repository's
 *
 * Every path here — a module source, a platform file, a barrel, a ledger key —
 * is written relative to the **repository root**. That is more verbose than the
 * `modules/blog/x.ts` shape the other ledgers use, and it is not a style
 * choice: this check *resolves* specifiers, and a specifier resolves in exactly
 * one namespace. `layout.keyOf` deliberately has two bases — an application
 * file is keyed inside `backend/src`, a packaged module's file relative to the
 * checkout, because there is no application prefix that would be true of the
 * second — and a resolver straddling both is wrong for every reach that crosses
 * between them. Measured on the split-tree fixture, where six modules live in
 * `packages/modules/<id>/src`: 90 reaches resolved to nothing, and the whole
 * point of that fixture is that a check keeps working while the layout moves.
 *
 * Plus one **refusal**: a barrel this parse cannot read in full (an `export *`,
 * a namespace re-export, an `export { … }` with no `from`) is exit 2, never a
 * narrower published set. A short surface turns correct reaches into findings,
 * and the obvious "repair" for one of those is to widen the barrel.
 *
 * Usage: `tsx scripts/check-platform-surface.ts [--list]`
 * Exit 0 = every module reach into the platform is published or ledgered;
 * exit 1 = at least one is not, or a ledger entry is stale;
 * exit 2 = the walk, the index or a barrel could not be read.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { moduleIdOf, refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import {
  barrelKeyOf,
  publishedSurface,
  PUBLISHED_SUBPATHS,
  resolutionCandidates,
  resolveRelative,
  type BarrelUnreadable,
  type PlatformSurface,
} from './lib/platform-surface.js';
import { reportReadSize } from './lib/read-size.js';
import { namedSpecifiers } from './lib/specifiers.js';

/** The symbol token recorded for a reach that names no symbol at all. */
export const WHOLE_FILE = '*';

/** The symbol token recorded for a finding that is about the file, not a name. */
export const NO_SYMBOL = '?';

/** The target token recorded for a source file no module owns. */
export const NO_MODULE = '(unattributed)';

export type PlatformSurfaceFindingKind =
  | 'unpublished-symbol'
  | 'whole-file-reach'
  | 'unresolvable-reach'
  | 'unattributed-source';

export interface PlatformSurfaceFinding {
  readonly kind: PlatformSurfaceFindingKind;
  /** The module file, keyed relative to the source root. */
  readonly file: string;
  readonly line: number;
  /** The module that owns {@link file}, or `null` when nothing does. */
  readonly moduleId: string | null;
  /**
   * The platform file reached, keyed relative to the source root — or, for an
   * `unresolvable-reach`, the specifier as written, and for an
   * `unattributed-source`, {@link NO_MODULE}.
   */
  readonly target: string;
  /** The name reached, {@link WHOLE_FILE}, or {@link NO_SYMBOL}. */
  readonly symbol: string;
  /** The specifier as written, for the failure message. */
  readonly specifier: string;
}

/**
 * One ledgered reach: which unpublished names this file may take from that
 * platform file, and why.
 *
 * **The symbols are named rather than counted**, which is where this ledger
 * differs from `check:module-boundary`'s omittable `{ sites, reason }`. There a
 * count is enough because the verdict is per *target* — a file either may name
 * another module's directory or it may not, and how often says nothing a
 * reviewer needs. Here the verdict is per *symbol*: a **P** file publishes some
 * of its exports and withholds others, so an entry that did not name the symbol
 * could not be checked against the barrel it disagrees with, and a reach that
 * swapped one unpublished name for another would inherit the entry in silence.
 */
export interface LedgeredReach {
  /** Every unpublished name this file takes from that target. Order is not read. */
  readonly symbols: readonly string[];
  /** Why it stands, and what would retire it. */
  readonly reason: string;
}

/**
 * The reaches into unpublished platform surface that stand today.
 *
 * Keyed `<module file>|<platform file>`, both relative to the repository root —
 * so moving code inside a file does not invalidate an entry, and re-opening a
 * closed reach does not silently inherit one.
 *
 * The platform half is spelled at `packages/platform/src/…` since the
 * relocation, which is where the file is. A module still writes the old relative
 * specifier and still lands on a re-export shim at `backend/src/<subpath>/…`;
 * {@link PlatformSurfaceInput.canonicalTargetOf} follows the shim, because a
 * shim publishes nothing and judging one would refuse every reach in the tree.
 * Forty of these keys were re-spelled by the move and not one entry, symbol or
 * count moved with them.
 *
 * **Two-way and draining**, in the idiom of `PORT_CATCHES_TO_DRAIN`: an
 * unledgered reach fails the build, a key that no longer describes one fails it,
 * and a listed symbol the walk no longer sees fails it too. Every entry names
 * the contract paragraph that classified it and the event that retires it — an
 * entry is debt with a due date, not a permission.
 *
 * Four of the five groups below are `_lifecycle`'s or a `scripts/` entry
 * point's, and both are already routed: D-160.11 merges `_lifecycle` into the
 * host package (it *is* the platform's operator half wearing a module's
 * directory layout, and it reaches twelve distinct unpublished targets for that
 * reason), and D-160.9 moves a container-less CLI entry point wholesale, as a
 * manifest-declared command the host runs. Neither retires by editing the import.
 */
/**
 * §1.4f — the host cannot export the ORM bootstrap, and this is the hardest
 * constraint in the contract. `db/index.ts` imports `mikro-orm.config.js` →
 * `configured-entities.js` → `entities-registry.generated.ts`, which carries 219
 * references into `src/modules/`: publishing it would make the host package
 * import every module package, which is a dependency cycle at the package
 * manager and unresolvable at install time.
 *
 * Every consumer is a container-less CLI entry point — the `scripts/` residue
 * §1.5 routes to **Q1** — and **D-160.9 has since drained the ordinary ones**:
 * `admin_users`, `audit_logs`, `carts`, `search`, `settings` and `_i18n` now
 * declare their commands in their manifests and the host runs them with the
 * container already built. What is left is `_lifecycle`'s own `module:*`
 * scripts, which are the platform's operator half and retire with D-160.11's
 * merge rather than with a conversion, and one un-converted backfill.
 */
const ORM_BOOTSTRAP =
  '§1.4f — `db/index.ts` reaches the ORM config and through it 219 module-owned entity ' +
  'references, so the host package cannot export it. A container-less CLI entry point has no ' +
  'other way to boot; D-160.9 drained the ordinary ones, and these retire with D-160.11 or ' +
  'with their own conversion.';

/**
 * §1.5 and D-160.11 — `_lifecycle` is not on the same axis as the other
 * fourteen non-clean modules. It is the platform's operator half wearing a
 * module's directory layout: it owns the manifest index the whole check estate
 * derives its population from, and it reaches twelve distinct unpublished
 * targets because it is the only consumer of each. As a package like the other
 * 65, the host would have to publish those twelve for it alone — a public API
 * with one consumer forever. It merges into the host instead, and every entry
 * under this reason retires with that merge.
 */
const LIFECYCLE_HOST_HALF =
  '§1.5, D-160.11 — `_lifecycle` merges into the host package: it owns the manifest index ' +
  'and is the only consumer of each target, so publishing them would be a public API with ' +
  'one consumer forever. Retires with the merge, not by editing the import.';

/**
 * §1.4g and D-103 — a composed module ships `backend.ts` and registers routes
 * through `ctx.routes`; `ModulePlugin` is not published and a module still
 * carrying a `plugin.ts` converts before it can be packaged.
 *
 * **Eight of the nine drained in T051, and the retiring condition the entry
 * used to name was not the one that retired them.** It read *"retires when this
 * module's `plugin.ts` is gone"*, which conflated the reach with the file: what
 * a packaged module cannot do is **name an unpublished symbol**, and the attach
 * function's type is `(app: FastifyInstance) => Promise<void>` whether or not
 * the body still lives in a `plugin.ts`. The already-packaged `quote_requests`
 * ships one and types it exactly that way (`src/backend/plugin.ts:124`), which
 * is the precedent the eight followed. Converting the file is a separate and
 * larger piece of work; it was never what this reach was waiting for.
 *
 * The survivor is `_lifecycle`'s, which retires with D-160.11's merge like its
 * eleven siblings.
 */
const MODULE_PLUGIN =
  '§1.4g, D-103 — a composed module ships `backend.ts` and uses `ctx.routes`; `ModulePlugin` ' +
  'is not published, and the attach function types on `fastify`\'s own `FastifyInstance` ' +
  'instead. This one is `_lifecycle`\'s and retires with D-160.11.';

/**
 * §1.4j — the clearest **A** on the list. The file's own header says it exists
 * to narrow `test/helpers/test-actors.ts`' Fastify augmentation out of
 * production code; an installed package has no relationship to this
 * repository's test harness, and a bare specifier into it would be a harness
 * dependency wearing a type's clothes.
 */
const TEST_ACTOR_CARRIER =
  '§1.4j — the file narrows this repository\'s test-harness Fastify augmentation out of ' +
  'production code. An installed package has no relationship to that harness. Retires with ' +
  'the call site.';

/**
 * §1.4b, §8 step 4 and D-160.9 — a CLI entry point that deliberately composes
 * no container, so `new AuditLogService(em)` is the only construction available
 * and "take the port" is not.
 *
 * D-160.9 took the six that could be converted. The five that remain are
 * `_lifecycle`'s `module:*` scripts, and they are the case the conversion
 * cannot reach: they are what *runs* the lifecycle, so a manifest-declared
 * command the host collects would be the orchestrator asking itself to
 * orchestrate. They retire with D-160.11.
 */
const CONTAINERLESS_CLI =
  '§1.4b, §8 step 4 — a CLI entry point that deliberately composes no container, so the ' +
  'construction is the only one available and taking the port is not. D-160.9 converted the ' +
  'six that could be; these run the lifecycle itself and retire with D-160.11.';

/**
 * §1.4c — the **A** half of `plugin-helpers`' by-symbol split. A composed module
 * uses `ctx.worker` / `ctx.subscribe`; publishing the wrappers directly would
 * re-open by bare specifier the seam `check:subscribe-seam` closed by relative
 * path. `_lifecycle`'s `pauseWorkersFor` / `resumeWorkersFor` pair is the
 * orchestrator's own and retires with D-160.11.
 */
const WORKER_WRAPPERS =
  '§1.4c — the A half of `plugin-helpers`\' by-symbol split: a composed module uses ' +
  '`ctx.worker` / `ctx.subscribe`, and publishing the wrappers would re-open by bare ' +
  'specifier the seam `check:subscribe-seam` closed. Retires when the registration moves ' +
  'to `backend.ts`.';

/**
 * §1.4h — a packaged module reads presence through `effectiveState` (§1.3 row
 * 11, **P**), never through the cache the combiner is built on or the Redis
 * channel it is invalidated over.
 */
const REGISTRY_CACHE =
  '§1.4h — presence is read through `effectiveState` (row 11, P), not through the cache the ' +
  'combiner is built on. Retires when the invalidation is an event the module subscribes to ' +
  'through `ctx.subscribe`.';

/**
 * §1.4l and §1.5 — `overlay/*` is how the platform *discovers* overlays. A
 * package reading it would be an installed artefact enumerating its own
 * siblings, which is the cycle O3 identifies for the manifest index.
 */
const OVERLAY_ROOTS =
  '§1.4l, §1.5 — `overlay/*` is how the platform discovers overlays; an installed artefact ' +
  'enumerating its own siblings is O3\'s cycle. Retires when the inventory reads the ' +
  'deployment\'s modules through the lifecycle\'s resolved set.';

/**
 * Not a module's file at all.
 *
 * `src/apps/<deployment>/` holds a deployment's decorations, its
 * reduced-deployment declaration and its generated override manifest **beside**
 * its overlay modules, and the walk covers that root whole. The rule is about
 * modules, and a deployment's own files are never packaged (D-104).
 *
 * They are ledgered rather than filtered out on purpose: a filter would make
 * every file the attribution loses invisible, and a *module* file that stopped
 * resolving to its id would hide among them behind a full-length `read:` line
 * — which is #215 one layer in (!879).
 */
const DEPLOYMENT_FILE =
  'a per-deployment file, not a module\'s: `src/apps/<deployment>/` holds decorations, the ' +
  'reduced-deployment declaration and the generated override manifest beside its overlay ' +
  'modules, and none of them is ever packaged (D-104). Ledgered rather than filtered so a ' +
  'module file the attribution loses cannot hide among them.';

/**
 * **A correction to §1.3 row 38, found by writing this check — say so loudly.**
 *
 * The row records `kernel/crypto/totp` as **P** and its "symbols modules take"
 * as `enroll` and `verifyTotp`, and !883 published exactly those two. A module
 * takes **five**. `auth/services/totp-service.ts` is a re-export shim (feature
 * 075 Phase P, kept "for the length of Phase P" by its own header), so the
 * reach is an `export … from` rather than an `import` — which is why T042a's
 * per-symbol pass did not see three of them.
 *
 * Two of the three are publishable on the contract's own rules and the third is
 * a judgement: `EnrolmentResult` is `enroll`'s return type, and §8's "the errors
 * and parameter types stay published" makes a published function's return shape
 * published with it; `hashBackupCode` and `matchBackupCode` are pure functions
 * of the same **P** file, which `mfa` calls through this shim. Whether the
 * barrel gains the three or the shim is deleted is the owner's call and not this
 * merge request's — the entry stands so the question is asked rather than
 * answered by whoever touches the file next.
 */
const TOTP_SHIM =
  'corrects §1.3 row 38: the row names two symbols and a module takes five, because this ' +
  'file is a re-export shim (feature 075 Phase P) and the reach is an `export … from` that ' +
  'T042a\'s symbol pass did not read. `EnrolmentResult` is `enroll`\'s return type and is ' +
  'publishable on §8\'s own rule; the two backup-code functions are pure functions of the ' +
  'same P file. Retires when the shim is deleted or the barrel gains them — the owner\'s call.';

export const UNPUBLISHED_PLATFORM_REACHES: Readonly<Record<string, LedgeredReach>> = {
  // === CONTAINERLESS_CLI (5) ===
  'backend/src/modules/_lifecycle/scripts/disable.ts|packages/platform/src/kernel/audit/audit-log-service.ts': { symbols: ['AuditLogService'], reason: CONTAINERLESS_CLI },
  'backend/src/modules/_lifecycle/scripts/enable.ts|packages/platform/src/kernel/audit/audit-log-service.ts': { symbols: ['AuditLogService'], reason: CONTAINERLESS_CLI },
  'backend/src/modules/_lifecycle/scripts/install.ts|packages/platform/src/kernel/audit/audit-log-service.ts': { symbols: ['AuditLogService'], reason: CONTAINERLESS_CLI },
  'backend/src/modules/_lifecycle/scripts/status.ts|packages/platform/src/kernel/audit/audit-log-service.ts': { symbols: ['AuditLogService'], reason: CONTAINERLESS_CLI },
  'backend/src/modules/_lifecycle/scripts/uninstall.ts|packages/platform/src/kernel/audit/audit-log-service.ts': { symbols: ['AuditLogService'], reason: CONTAINERLESS_CLI },

  // === DEPLOYMENT_FILE (3) ===
  'backend/src/apps/example/decorations/pricing-service.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },
  'backend/src/apps/example/override-manifest.generated.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },
  'backend/src/apps/example/reduced-deployment.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },

  // === LIFECYCLE_HOST_HALF (16) ===
  'backend/src/modules/_lifecycle/backend.ts|packages/platform/src/http/interceptors/index.ts': { symbols: ['ApiInterceptorRegistry'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/commands/activation.commands.ts|packages/platform/src/kernel/lifecycle/registry-cache.ts': { symbols: ['registryCache'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/plugin.ts|packages/platform/src/kernel/lifecycle/registry-cache.ts': { symbols: ['ModuleRegistryCache', 'registryCache'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/registered-manifests.ts|backend/src/overlay/overlay-runtime.ts': { symbols: ['discoverOverlayModuleManifests'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/registered-manifests.ts|backend/src/packages/module-id-claims.ts': { symbols: ['ModuleIdClaim', 'ModuleIdClaimOrigin', 'assertNoPackageModuleIdCollisions'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/registered-manifests.ts|backend/src/packages/package-runtime.ts': { symbols: ['discoverPackageModuleManifests'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/routes.admin.ts|packages/platform/src/http/interceptors/index.ts': { symbols: ['ApiInterceptorRegistry'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/services/orchestrator.ts|backend/src/db/configured-migrations.ts': { symbols: ['MigrationOwnership', 'coreMigrationOwnership'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/services/orchestrator.ts|backend/src/db/migration-order.ts': { symbols: ['findModuleCycles'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/services/orchestrator.ts|packages/platform/src/kernel/lifecycle/module-registration.entity.ts': { symbols: ['ModuleRegistration'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/services/orchestrator.ts|packages/platform/src/kernel/lifecycle/registry-cache.ts': { symbols: ['publishStateChanged', 'registryCache'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/services/orchestrator.ts|packages/platform/src/kernel/settings/manifest-reconciler.ts': { symbols: ['ManifestReconciler'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/services/presence-load.ts|packages/platform/src/kernel/lifecycle/activation-resolver.ts': { symbols: ['activationDeclarationsFrom'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/services/presence-load.ts|packages/platform/src/kernel/lifecycle/module-registration.entity.ts': { symbols: ['ModuleRegistration'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/services/presence-load.ts|packages/platform/src/kernel/lifecycle/registry-cache.ts': { symbols: ['registryCache'], reason: LIFECYCLE_HOST_HALF },
  'backend/src/modules/_lifecycle/services/reduced-deployment.ts|backend/src/overlay/overlay-roots.ts': { symbols: ['selectedDeployment'], reason: LIFECYCLE_HOST_HALF },

  // === MODULE_PLUGIN (1) ===
  'backend/src/modules/_lifecycle/plugin.ts|packages/platform/src/http/server.ts': { symbols: ['ModulePlugin'], reason: MODULE_PLUGIN },

  // === ORM_BOOTSTRAP (5) ===
  'backend/src/modules/_lifecycle/scripts/disable.ts|backend/src/db/index.ts': { symbols: ['closeOrm', 'initOrm'], reason: ORM_BOOTSTRAP },
  'backend/src/modules/_lifecycle/scripts/enable.ts|backend/src/db/index.ts': { symbols: ['closeOrm', 'initOrm'], reason: ORM_BOOTSTRAP },
  'backend/src/modules/_lifecycle/scripts/install.ts|backend/src/db/index.ts': { symbols: ['closeOrm', 'initOrm'], reason: ORM_BOOTSTRAP },
  'backend/src/modules/_lifecycle/scripts/status.ts|backend/src/db/index.ts': { symbols: ['closeOrm', 'initOrm'], reason: ORM_BOOTSTRAP },
  'backend/src/modules/_lifecycle/scripts/uninstall.ts|backend/src/db/index.ts': { symbols: ['closeOrm', 'initOrm'], reason: ORM_BOOTSTRAP },

  // === OVERLAY_ROOTS (1) ===
  'backend/src/modules/admin_roles/permission-inventory.ts|backend/src/overlay/overlay-roots.ts': { symbols: ['activeOverlayModulesRoot'], reason: OVERLAY_ROOTS },

  // === REGISTRY_CACHE (1) ===
  'backend/src/modules/admin_actions/services/admin-actions-service.ts|packages/platform/src/kernel/lifecycle/registry-cache.ts': { symbols: ['STATE_CHANGED_CHANNEL'], reason: REGISTRY_CACHE },

  // === TEST_ACTOR_CARRIER (4) ===
  'backend/src/modules/admin_users/routes.impersonation.ts|packages/platform/src/http/test-actor-carrier.ts': { symbols: ['TestActorCarrier'], reason: TEST_ACTOR_CARRIER },
  'backend/src/modules/api_keys/routes.ts|packages/platform/src/http/test-actor-carrier.ts': { symbols: ['testAdminUserId'], reason: TEST_ACTOR_CARRIER },
  'backend/src/modules/credit_limits/routes.ts|packages/platform/src/http/test-actor-carrier.ts': { symbols: ['testAdminUserId'], reason: TEST_ACTOR_CARRIER },
  'backend/src/modules/webhooks/routes.ts|packages/platform/src/http/test-actor-carrier.ts': { symbols: ['testAdminUserId'], reason: TEST_ACTOR_CARRIER },

  // === TOTP_SHIM (1) ===
  'backend/src/modules/auth/services/totp-service.ts|packages/platform/src/kernel/crypto/totp.ts': { symbols: ['EnrolmentResult', 'hashBackupCode', 'matchBackupCode'], reason: TOTP_SHIM },

  // === WORKER_WRAPPERS (10) ===
  'backend/src/modules/_lifecycle/services/orchestrator.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': { symbols: ['pauseWorkersFor', 'resumeWorkersFor'], reason: WORKER_WRAPPERS },
  'backend/src/modules/catalog/plugin.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': { symbols: ['defineModuleWorker'], reason: WORKER_WRAPPERS },
  'backend/src/modules/ksef/plugin.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': { symbols: ['defineModuleWorker', 'subscribeForModule'], reason: WORKER_WRAPPERS },
  'backend/src/modules/newsletter/plugin.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': { symbols: ['defineModuleWorker'], reason: WORKER_WRAPPERS },
  'backend/src/modules/pim_ergonode/workers/import-reaper-worker.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': { symbols: ['defineModuleWorker'], reason: WORKER_WRAPPERS },
  'backend/src/modules/pim_ergonode/workers/import-worker.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': { symbols: ['defineModuleWorker'], reason: WORKER_WRAPPERS },
  'backend/src/modules/product_feeds/workers/feed-delivery-worker.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': { symbols: ['defineModuleWorker'], reason: WORKER_WRAPPERS },
  'backend/src/modules/product_feeds/workers/feed-generation-worker.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': { symbols: ['defineModuleWorker'], reason: WORKER_WRAPPERS },
  'backend/src/modules/product_feeds/workers/feed-run-reaper-worker.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': { symbols: ['defineModuleWorker'], reason: WORKER_WRAPPERS },
  'backend/src/modules/product_feeds/workers/taxonomy-refresh-worker.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': { symbols: ['defineModuleWorker'], reason: WORKER_WRAPPERS },
};

export interface PlatformSurfaceInput {
  /**
   * The module sources to judge, keyed relative to the source root.
   *
   * Everything the walk opened, including a file no module owns — attributing
   * it is the analysis' job and failing to is a finding.
   */
  readonly sources: ReadonlyMap<string, string>;
  /** Every file key that exists under the source root, for resolving a specifier. */
  readonly files: ReadonlySet<string>;
  /** The published surface, from `lib/platform-surface.ts`. */
  readonly surface: PlatformSurface;
  /**
   * Which module a key belongs to. Defaults to the `modules/<id>/` segment,
   * which is what the application tree and an overlay tree both carry; a run
   * over a tree that holds module **packages** passes the layout's own
   * attribution, which reads a package's declared id instead.
   */
  readonly moduleIdOf?: (key: string) => string | null;
  /**
   * A resolved target's canonical key — the file a specifier really lands on.
   *
   * Identity for every reach but one: the platform relocation left a re-export
   * shim at each old `backend/src/{kernel,http,tenancy,commands,events}/…` path,
   * so a module's relative specifier resolves to a file whose whole content is
   * `export * from` the platform's own. Judging the shim would compare a module's
   * symbol against a barrel that lives one tree over and publish nothing, turning
   * all 1642 reaches into findings. Judging the file the shim forwards to is the
   * effective truth and keeps this check's answer the same across the move — the
   * ledger's platform half is spelled at the platform, which is where it is.
   */
  readonly canonicalTargetOf?: (key: string) => string;
}

/** `<module file>|<platform file>` — the ledger key and the identity of a reach. */
export function keyOf(finding: PlatformSurfaceFinding): string {
  return `${finding.file}|${finding.target}`;
}

/** The file a specifier names, or `null` when the walk found no such file. */
function resolveTarget(
  fromKey: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | null {
  const joined = resolveRelative(fromKey, specifier);
  if (joined === null) return null;
  for (const candidate of resolutionCandidates(joined)) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

export interface PlatformSurfaceScan {
  /** Every (specifier, symbol) reach into the platform the walk judged. */
  readonly reaches: number;
  readonly findings: readonly PlatformSurfaceFinding[];
}

/**
 * Every module reach into the platform, judged against the published surface.
 *
 * Pure over source text, file keys and barrel-derived surface, so a fixture
 * enters exactly where a run does — including the specifier extraction and the
 * `.js` → `.ts` resolution, which is where a resolution bug would hide (issue
 * #130).
 */
export function scanPlatformSurface(input: PlatformSurfaceInput): PlatformSurfaceScan {
  const attribute = input.moduleIdOf ?? moduleIdOf;
  const canonical = input.canonicalTargetOf ?? ((key: string): string => key);
  const findings: PlatformSurfaceFinding[] = [];
  let reaches = 0;

  for (const [file, text] of [...input.sources].sort(([a], [b]) => a.localeCompare(b))) {
    const moduleId = attribute(file);
    if (moduleId === null) {
      // A file the walk opened and could not attribute. Skipping it would leave
      // it counted in `read: files=` and judged by nothing, which is #215 one
      // layer in (!879).
      findings.push({
        kind: 'unattributed-source',
        file,
        line: 1,
        moduleId: null,
        target: NO_MODULE,
        symbol: NO_SYMBOL,
        specifier: '',
      });
      continue;
    }

    for (const specifier of namedSpecifiers(text, file)) {
      if (!specifier.text.startsWith('.')) continue;
      const resolved = resolveTarget(file, specifier.text, input.files);
      const target = resolved === null ? null : canonical(resolved);
      if (target === null) {
        findings.push({
          kind: 'unresolvable-reach',
          file,
          line: specifier.line,
          moduleId,
          target: specifier.text,
          symbol: NO_SYMBOL,
          specifier: specifier.text,
        });
        continue;
      }
      // Module → module is `check:module-boundary`'s rule, not this one's.
      if (attribute(target) !== null) continue;

      const named = specifier.bindings.filter((binding) => !binding.startsWith('* as'));
      const wholeFile = specifier.bindings.length === 0 || named.length < specifier.bindings.length;

      if (wholeFile) {
        reaches += 1;
        // Reaching a barrel *is* reaching the published surface, whole or not.
        if (!input.surface.barrels.has(target)) {
          findings.push({
            kind: 'whole-file-reach',
            file,
            line: specifier.line,
            moduleId,
            target,
            symbol: WHOLE_FILE,
            specifier: specifier.text,
          });
        }
      }

      const published = input.surface.published.get(target) ?? new Set<string>();
      for (const name of named) {
        reaches += 1;
        if (input.surface.barrels.has(target)) continue;
        if (published.has(name)) continue;
        findings.push({
          kind: 'unpublished-symbol',
          file,
          line: specifier.line,
          moduleId,
          target,
          symbol: name,
          specifier: specifier.text,
        });
      }
    }
  }

  findings.sort((a, b) =>
    a.file === b.file
      ? a.target === b.target
        ? a.symbol.localeCompare(b.symbol)
        : a.target.localeCompare(b.target)
      : a.file.localeCompare(b.file),
  );
  return { reaches, findings };
}

export interface CheckResult {
  /** (specifier, symbol) reaches into the platform judged — the `sites=` number. */
  readonly reaches: number;
  readonly findings: readonly PlatformSurfaceFinding[];
  readonly violations: readonly PlatformSurfaceFinding[];
  readonly ledgered: readonly PlatformSurfaceFinding[];
  /** Ledger keys that describe no reach at all. */
  readonly staleKeys: readonly string[];
  /** `<key>#<symbol>` an entry names and the walk no longer sees. */
  readonly staleSymbols: readonly string[];
  /** Barrels the parse could not read in full — a caller exits 2 on any. */
  readonly unreadable: readonly BarrelUnreadable[];
}

export function checkPlatformSurface(
  input: PlatformSurfaceInput,
  ledger: Readonly<Record<string, LedgeredReach>> = UNPUBLISHED_PLATFORM_REACHES,
): CheckResult {
  const scan = scanPlatformSurface(input);
  const seen = new Map<string, Set<string>>();
  for (const finding of scan.findings) {
    const symbols = seen.get(keyOf(finding)) ?? new Set<string>();
    symbols.add(finding.symbol);
    seen.set(keyOf(finding), symbols);
  }

  const covers = (finding: PlatformSurfaceFinding): boolean =>
    ledger[keyOf(finding)]?.symbols.includes(finding.symbol) === true;

  const staleKeys: string[] = [];
  const staleSymbols: string[] = [];
  for (const [key, entry] of Object.entries(ledger)) {
    const symbols = seen.get(key);
    if (symbols === undefined) {
      staleKeys.push(key);
      continue;
    }
    for (const symbol of entry.symbols) {
      if (!symbols.has(symbol)) staleSymbols.push(`${key}#${symbol}`);
    }
  }

  return {
    reaches: scan.reaches,
    findings: scan.findings,
    violations: scan.findings.filter((finding) => !covers(finding)),
    ledgered: scan.findings.filter(covers),
    staleKeys: staleKeys.sort(),
    staleSymbols: staleSymbols.sort(),
    unreadable: input.surface.unreadable,
  };
}

/**
 * Why this run may not judge a reach against the surface it read, or `null`.
 *
 * Pure over the two things that can be silently missing — a barrel that is not
 * there, and a re-export the parse cannot enumerate — because both fail in the
 * same direction and it is the wrong one: a **short** published set turns
 * correct reaches into findings, and the obvious repair for one of those is to
 * widen the barrel. So it is exit 2, in the idiom of `readSizeRefusal`, and a
 * proof enters where a run enters (issue #130).
 */
export function platformSurfaceRefusal(input: {
  readonly missingBarrels: readonly string[];
  readonly surface: PlatformSurface;
}): string | null {
  if (input.missingBarrels.length > 0) {
    return (
      `${input.missingBarrels.join(', ')} — a published subpath (D-160.7) whose barrel is ` +
      'not there. The published surface would come back short and every reach into that ' +
      'directory would read as a violation; refusing to report on it'
    );
  }
  if (input.surface.unreadable.length > 0) {
    const named = input.surface.unreadable
      .map((entry) => `\n  - ${entry.barrel}:${entry.line}  ${entry.reason}`)
      .join('');
    return (
      'a published barrel holds a re-export this parse cannot enumerate, so the published ' +
      'surface would come back short — and the obvious "repair" for a reach it wrongly ' +
      `refused is to widen the barrel:${named}`
    );
  }
  return null;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** The remedy sentence a finding gets, by kind. */
function remedyOf(finding: PlatformSurfaceFinding): string {
  switch (finding.kind) {
    case 'unpublished-symbol':
      return `\`${finding.symbol}\` is not published out of ${finding.target}`;
    case 'whole-file-reach':
      return `reaches every export of ${finding.target}, internals included`;
    case 'unresolvable-reach':
      return `\`${finding.specifier}\` resolves to no file the walk found`;
    case 'unattributed-source':
      return 'the walk opened this file and no module owns it';
  }
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const prefix = '[platform-surface]';
  const layout = await requireModuleLayout(prefix);

  // Every root a module's source can live in, derived (feature 080, T040a):
  // the application's own tree, the per-deployment overlay tree, and each
  // module that has become a workspace package.
  // Repo-relative, one namespace — see the header. `layout.keyOf` has two bases
  // and a resolver cannot straddle them.
  const repoKeyOf = (absolutePath: string): string =>
    relative(layout.repoRoot, absolutePath).split('\\').join('/');

  const moduleFiles = layout.moduleWalkRoots.flatMap((root) => walk(root));
  const sources = new Map<string, string>();
  for (const file of moduleFiles) sources.set(repoKeyOf(file), readFileSync(file, 'utf8'));

  // What a specifier can resolve to: the whole source tree, module files and
  // platform files alike. A relative specifier naming nothing in it is a
  // finding, never a skip.
  const files = new Set<string>(
    layout.sourceRoots.flatMap((root) => walk(root)).map((file) => repoKeyOf(file)),
  );
  for (const key of sources.keys()) files.add(key);

  // The published surface, read out of the barrels — the same parse
  // `published-surface.test.ts` holds those barrels to §1.3 with, resolved
  // against the same file list a module reach is resolved against.
  // The platform's own sources, wherever the workspace says they are. `null` is
  // a stop and not an empty surface: this check *is* the platform's barrels, so
  // a run without them would refuse every reach in the tree.
  const platformRoot = layout.platformRoot;
  if (platformRoot === null) {
    console.error(
      `${prefix} no workspace member declares \`endora.type: "platform"\` — there are no ` +
        'barrels to read and no published surface to judge a reach against',
    );
    process.exit(2);
  }
  // Shim key → the platform file it forwards to. Built from the platform tree,
  // so a shim with no counterpart is simply absent from it rather than mapped
  // to a file that is not there.
  const canonicalTargets = new Map<string, string>();
  for (const file of walk(platformRoot)) {
    const withinPlatform = relative(platformRoot, file).split('\\').join('/');
    canonicalTargets.set(`${repoKeyOf(layout.srcRoot)}/${withinPlatform}`, repoKeyOf(file));
  }
  const canonicalTargetOf = (key: string): string => canonicalTargets.get(key) ?? key;

  const barrelSources = new Map<string, string>();
  const missing: string[] = [];
  for (const subpath of PUBLISHED_SUBPATHS) {
    const absolute = join(platformRoot, barrelKeyOf(subpath));
    if (!existsSync(absolute)) {
      missing.push(barrelKeyOf(subpath));
      continue;
    }
    barrelSources.set(repoKeyOf(absolute), readFileSync(absolute, 'utf8'));
  }
  const surface = publishedSurface(barrelSources, (fromKey, specifier) =>
    resolveTarget(fromKey, specifier, files),
  );
  const refusal = platformSurfaceRefusal({ missingBarrels: missing, surface });
  if (refusal !== null) {
    console.error(`${prefix} ${refusal}`);
    process.exit(2);
  }

  // The population is the module tree, and the rest of `src/` is a small
  // fraction of it: a walk that read only the remainder would find no reach at
  // all and print the same green as a clean tree (issue #215). Derived from the
  // manifest index, so nothing here is a number anybody chose.
  const attribute = (key: string): string | null =>
    layout.moduleIdOfPath(join(layout.repoRoot, key));

  const coverage = await refuseVacuousModulePopulation({
    prefix,
    manifestIndexPath: layout.manifestIndexPath,
    files: [...sources.keys()],
    moduleIdOf: attribute,
  });

  const result = checkPlatformSurface({
    sources,
    files,
    surface,
    moduleIdOf: attribute,
    canonicalTargetOf,
  });

  if (listMode) {
    for (const finding of result.findings) {
      const tag =
        UNPUBLISHED_PLATFORM_REACHES[keyOf(finding)]?.symbols.includes(finding.symbol) === true
          ? 'LEDGERED'
          : 'REACH   ';
      console.log(
        `${tag} ${finding.file}:${finding.line}  [${finding.moduleId ?? '-'}] ` +
          `${finding.target}#${finding.symbol}  (${finding.kind})`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244). `files` is the module
  // sources opened; `sites` is the (specifier, symbol) reaches judged inside
  // them, which is the finer population and the one that moves when a barrel
  // changes. The two `sources=` derivations have different authors: the module
  // count comes from the generated manifest index, and the barrel count from
  // D-160.7's subpath list reconciled against the tree.
  reportReadSize({
    prefix,
    files: sources.size,
    sites: result.reaches,
    coverage: [
      coverage,
      {
        source: 'platform-barrels',
        expected: PUBLISHED_SUBPATHS.length,
        covered: surface.barrelsWithExports,
      },
    ],
  });
  console.log(
    `${prefix} module reaches into unpublished platform surface=${result.findings.length} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(UNPUBLISHED_PLATFORM_REACHES).length} ` +
      `stale=${result.staleKeys.length + result.staleSymbols.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA module reached platform surface the host does not publish (feature 080 §1,\n' +
        'D-160.8). Take the published symbol from the directory barrel, take the port\n' +
        'where the contract says the class is `O`, or repair the call site before the\n' +
        'module can be packaged — an `exports` map will refuse it at resolution time.\n',
    );
    for (const finding of result.violations) {
      console.error(
        `  - ${finding.file}:${finding.line}  [${finding.moduleId ?? '-'}] ` +
          `${remedyOf(finding)}  (${finding.kind})`,
      );
    }
  }
  if (result.staleKeys.length > 0) {
    console.error('\nStale ledger keys (no longer describe a reach — delete them):');
    for (const key of result.staleKeys) console.error(`  - ${key}`);
  }
  if (result.staleSymbols.length > 0) {
    console.error('\nStale ledger symbols (the reach no longer takes them — delete them):');
    for (const key of result.staleSymbols) console.error(`  - ${key}`);
  }

  const failed =
    result.violations.length > 0 ||
    result.staleKeys.length > 0 ||
    result.staleSymbols.length > 0;
  process.exit(failed ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
