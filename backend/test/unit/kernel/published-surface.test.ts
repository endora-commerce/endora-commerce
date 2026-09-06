/**
 * The platform's published surface, as a two-way ratchet (feature 080, T042c
 * for `kernel` / `http` / `events`; T042f for `tenancy` and `commands`).
 *
 * `specs/080-f4-real-scope/contracts/host-package.md` §1.3 classifies every
 * platform file a module reaches as **P** (the host publishes it), **A**
 * (accidental reach — host-internal, harness-only or orchestrator-only) or
 * **O** (the module is reaching for a class where a port exists). §2.1 turns
 * that classification into an `exports` map with five subpaths, one per
 * publishable directory, each resolving to that directory's barrel. So the
 * barrels *are* the classification, and until the package exists nothing in the
 * repository holds them to it: a name added to `kernel/index.ts` becomes public
 * API of `@endora-commerce/platform` with no review step that knows it did.
 *
 * That is not hypothetical. `ManifestReconciler` sat on the kernel barrel from
 * feature 072 until T042c while §1.3 row 46 classified it **A**, and
 * `AuditLogService` sat there while Principle XIII routes every domain write
 * around it (D-160.10). Neither was noticed by a check, a type or a review.
 *
 * **T042c covered three of the five subpaths and T042f covers the other two.**
 * That gap was not cosmetic: `check:platform-surface` (T042d) judges every
 * module reach against these barrels, so for `tenancy` and `commands` its
 * authority was a barrel nothing held to §1.3 — it said so in its own header
 * and this file is the retiring condition. All five are here now, which is the
 * only reason a set comparison over any one of them means anything.
 *
 * **The ratchet is two-way and deliberately duplicates nothing.** The expected
 * sets below are the *only* place the published surface is written down — the
 * barrel is source, not a second copy — so a name that appears in one and not
 * the other fails, in both directions:
 *
 *  - a symbol exported by a barrel and absent from its set fails, which is what
 *    makes "`AuditLogService` came back" red;
 *  - a symbol in a set and absent from the barrel fails, so a set entry cannot
 *    outlive the export it describes.
 *
 * {@link NOT_PUBLISHED} is the other half and is the one a future author reads:
 * every name T042c took *off* a barrel, with the reason it is not published.
 * A name removed with no reason is a name someone re-adds.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  barrelKeyOf,
  HOST_INTERNAL_SUBPATHS as HOST_INTERNAL_SUBPATH_REASONS,
  parseBarrel,
  PUBLISHED_SUBPATHS,
} from '../../../scripts/lib/platform-surface.js';
import { nodeWorkspaceFs, workspaceMembers } from '../../../scripts/lib/workspace-packages.js';
import { platformSourceRootOf, platformSubpathsOf } from '../../../scripts/lib/platform-root.js';
import { RELATIVE_HOST_REACHES } from '../../../scripts/check-platform-surface.js';

/**
 * The platform's own sources, which since the relocation are
 * `@endora-commerce/platform`'s and not `backend/src`'s. The five barrels this
 * file holds to `host-package.md` §1.3 moved with them; `backend/src/<subpath>/`
 * now holds re-export shims, and reading one as a barrel would parse
 * `export * from` and report the published surface as unreadable.
 */
const SRC = fileURLToPath(new URL('../../../../packages/platform/src/', import.meta.url));

/**
 * Every name a barrel re-exports, from its source text.
 *
 * Deliberately a parse of the file rather than a dynamic `import()` of it:
 * `import()` cannot see a type-only export at all, and more than half of a
 * port-based surface is types. It would report a green over a surface it is
 * blind to.
 *
 * **The parse is `scripts/lib/platform-surface.ts`', not this file's** (feature
 * 080, T042d). It was a regular expression here until `check:platform-surface`
 * needed the same answer — and two independently written parses of "what does
 * `kernel/index.ts` export" are two answers, whose disagreement would be
 * invisible: this file would hold the barrel to §1.3 while the check judged
 * module reaches against a different reading of it. The shared parse is the
 * compiler's, so it also sees the three shapes the regular expression silently
 * dropped (`export *`, `export * as`, and an `export { … }` with no `from`),
 * and it reports them rather than returning a short list.
 */
function barrelExports(relativePath: string): string[] {
  const parsed = parseBarrel(readFileSync(join(SRC, relativePath), 'utf8'), relativePath);
  expect(parsed.unreadable, `${relativePath} holds a re-export the parse cannot enumerate`).toEqual(
    [],
  );
  return parsed.published.map((symbol) => symbol.name);
}

/**
 * `src/kernel/index.ts` — the `./kernel` subpath.
 *
 * Grouped by the source file, because that is the granularity §1.3 classifies
 * at and the granularity a reviewer can check. Every group cites its row, and a
 * group whose file is **P** still lists only the symbols a module takes plus
 * the parameter, return and error types of the port methods it publishes: a
 * published method whose thrown error or argument shape is unpublished is a
 * method a consumer cannot call (§8's "the errors and parameter types stay
 * published").
 */
const PUBLISHED_KERNEL_SURFACE: Readonly<Record<string, readonly string[]>> = {
  /** Row 6 — what 66 modules take through the barrel today. */
  'module-context.js': ['ModuleContext'],
  'lazy-port.js': ['lazyPort'],
  /**
   * Row 6's "+4" includes both readers; the error is what
   * `resolvePublicApiBaseUrl` throws in production (issue #218), so a caller
   * cannot handle the refusal without it.
   */
  'public-api-base-url.js': [
    'PublicApiBaseUrlNotConfiguredError',
    'configuredPublicApiBaseUrl',
    'resolvePublicApiBaseUrl',
  ],
  /** Row 11. */
  'lifecycle/effective-state.js': ['effectiveState', 'toModulePresenceDto'],
  /** Row 7, the **P** half of the by-symbol split (§1.4c). */
  'lifecycle/plugin-helpers.js': [
    'ModuleDisabledError',
    'rethrowIfModuleDisabled',
    'requireModuleEnabled',
  ],
  /**
   * The platform's structured-logger shape. It was published off
   * `lifecycle/plugin-helpers.js` as `WorkerLogger`, a second declaration of
   * this interface: same three methods, same signatures, and neither file knew
   * about the other. Publishing the shape from the file that documents and
   * produces it is what stopped the two from drifting a third time — the second
   * drift was an alias called `ModuleLifecycleLogger`, colliding with an
   * unrelated `@endora-commerce/contracts` export of that name.
   *
   * The type alone. `attachPlatformLogger`, `platformLogger`, `moduleLogger`
   * and `currentPlatformLogger` stay below: the destination and the attribution
   * are the host's, and `ctx.log` is the seam that gives a module the value.
   */
  'logging.js': ['PlatformLogger'],
  /** Row 13. */
  'scope.js': ['enterSystemScope'],
  /**
   * D-160.10 — the port replaces the class. `RecordAuditInput` and
   * `AuditLogFilter` are the argument shapes of its own methods.
   */
  'ports/audit.js': ['AuditPort', 'RecordAuditInput', 'AuditLogFilter'],
  /** Row 37 — the return shape of every {@link AuditPort} method. */
  'audit/audit-log-entry.entity.js': ['AuditLogEntry'],
  /** Row 44; `InProcessCacheLayer` is what a caller registers. */
  'cache/in-process-cache-registry.js': [
    'InProcessCacheRegistry',
    'inProcessCaches',
    'InProcessCacheLayer',
  ],
  /** Rows 20 and 38. */
  'crypto/password-hasher.js': ['hashPassword', 'verifyPassword'],
  /** Row 9 — the singleton case (§3). */
  'sales-channels/sales-channel.entity.js': ['SalesChannel'],
  /** Row 34 — the four symbols modules take. */
  'sales-channels/sales-channels-cache.js': [
    'SalesChannelsCache',
    'SalesChannelsCacheInvalidation',
    'SALES_CHANNELS_CACHE_KEY_PREFIX',
    'SALES_CHANNELS_CACHE_NAMESPACE',
  ],
  /** Row 24 is **O**; these two are not the class (§1.4e, §8). */
  'sales-channels/sales-channel-resolver.service.js': ['parseHostMap', 'ResolverError'],
  /** Row 52. */
  'sales-channels/no-system-default-channel.error.js': ['NoSystemDefaultChannel'],
  /** Row 15 is **O**; these two are `SalesChannelMembershipPort`'s own shapes. */
  'sales-channels/sales-channel-membership.service.js': [
    'MembershipMutationOptions',
    'MembershipMutationResult',
  ],
  /** Row 14. */
  'sales-channels/sales-channel-resolver.middleware.js': [
    'getResolvedChannel',
    'currentSalesChannel',
  ],
  /** Row 29. */
  'sales-channels/request-channel-assortment.js': [
    'productIdsInRequestChannel',
    'outOfRequestChannel',
  ],
  /** Rows 22, 36, 25. */
  'settings/setting.entity.js': ['Setting'],
  'settings/setting-group.entity.js': ['SettingGroup'],
  'settings/setting-value.entity.js': ['SettingValue'],
  /** Row 8 is **O**; the four errors are what a `settingsReadPort` caller catches. */
  'settings/settings.service.js': [
    'SettingNotRegistered',
    'SettingOutOfScopeForChannel',
    'SettingValueShapeMismatch',
    'SettingsChannelIdInvalid',
  ],
  /** Row 35 — the three symbols modules take. */
  'settings/settings-cache.js': [
    'SettingsCacheInvalidation',
    'SETTINGS_CACHE_KEY_PREFIX',
    'SETTINGS_CACHE_NAMESPACE',
  ],
  /** Row 39. */
  'settings/secret-value-codec.js': [
    'encryptSecretValue',
    'secretValueIsSet',
    'SecretKeyMissing',
    'SecretKeyInvalid',
  ],
  /** Rows 3, 27, 53, 8-as-a-port, 16 — the port types themselves. */
  'ports/require-admin.js': [
    'AdminPermissionChecker',
    'RequireAdminAnyFactory',
    'RequireAdminFactory',
  ],
  'ports/organizations.js': ['OrganizationReadPort', 'OrganizationSnapshot'],
  'ports/require-customer.js': ['RequireCustomerGuard'],
  'ports/settings.js': ['SettingsReadPort', 'SettingsReadResult'],
  'ports/sales-channel.js': [
    'ResolvedChannel',
    'SalesChannelMembershipPort',
    'SalesChannelResolutionPort',
  ],
};

/**
 * `src/tenancy/index.ts` — the `./tenancy` subpath (T042f).
 *
 * Every file of this directory that a module reaches is **P**: rows 2, 21, 28,
 * 30 and 45. So the classification's work here is entirely per *symbol*, which
 * is the shape !883 measured on the kernel and this directory reproduces at its
 * sharpest — the barrel carried 38 names over seven files and modules take six
 * across five, while the same directory is reached 237 times by relative path.
 * Two of the seven files, `resolve-tenant-context.ts` and `scoped-em.ts`, have
 * no §1.3 row at all: no module reaches either.
 */
const PUBLISHED_TENANCY_SURFACE: Readonly<Record<string, readonly string[]>> = {
  /**
   * Row 45 — `getTenantContext`. `TenantContext` is its return and every
   * derived-scope helper's parameter; `MissingTenantContextError` is what a
   * tenant-scoped query with no ambient context raises, which is the
   * fail-closed guarantee a packaged module's entities are subject to.
   */
  'tenant-context.js': ['TenantContext', 'MissingTenantContextError', 'getTenantContext'],
  /** Row 2 — 219 reaches from 59 modules, the largest single reach in §1.3. */
  'org-scoped.decorator.js': [
    'OrgScoped',
    'CustomerScoped',
    'GlobalEntity',
    'TransitivelyScoped',
    'RuleScoped',
  ],
  /** Row 21 — the one symbol of the escape hatch a module takes. */
  'escape-hatch.js': ['withSystemScope'],
  /** Row 28, plus `orgConstraintFor`'s return shape. */
  'derived-scope.js': ['orgConstraintFor', 'isOrgInScope', 'ruleVisibleForScope', 'OrgConstraint'],
};

/**
 * `src/commands/index.ts` — the `./commands` subpath (T042f).
 *
 * Rows 5, 12 and 33, all **P**. Ten distinct names are reached across them and
 * the other five here are the argument, return and actor shapes of those ten —
 * `Command` is an interface a module *implements*, so its members'
 * (`CommandContext`, `CommandOutcome`) types are as load-bearing as a
 * `@throws`.
 *
 * Three shapes a consumer needs are **not** here and that is the §2.6
 * constraint working: `AuditPort` is the kernel's, `TenantContext` is
 * `tenancy`'s and `EventBase` is `events`'. A barrel that re-exported them to
 * save an import line would spend the split option D-160.6 kept open.
 */
const PUBLISHED_COMMANDS_SURFACE: Readonly<Record<string, readonly string[]>> = {
  /** Row 12, plus the shapes `Command`'s own members name. */
  'command.js': [
    'Command',
    'CommandContext',
    'CommandOutcome',
    'CommandEvent',
    'AuditState',
    'CommandActor',
  ],
  /** Row 5's "+5" — two of the five. */
  'actor.js': ['resolveCommandActor', 'actorFromContext'],
  /** Row 5's second-largest symbol (51 reaches), plus its input shape. */
  'audit-from-context.js': ['recordAuditFromContext', 'AuditFromContextInput'],
  /** Rows 5 and 33 — the class 75 module files name. */
  'command-bus.js': ['CommandBus'],
  /** Row 5's "+5" — the undo helper, its parameters and its return. */
  'reversible.js': ['applyUndo', 'RevertRecord', 'RevertHandlers', 'UndoResult'],
};

/** `src/http/index.ts` — the `./http` subpath, as MR !880 built it. */
const PUBLISHED_HTTP_SURFACE: readonly string[] = [
  'HttpError',
  'productAudienceOf',
  'markPersonalisedPricing',
  'StorefrontRevalidator',
  'encodeCursor',
  'decodeCursor',
];

/** `src/events/index.ts` — the `./events` subpath, as MR !880 built it. */
const PUBLISHED_EVENTS_SURFACE: readonly string[] = ['EventBus', 'EventBase'];

/**
 * Every name T042c took off the kernel barrel and T042f off the other two, and
 * why it is not published.
 *
 * Four reasons, and the distinction is the point of writing them down:
 *
 *  - **composition** — the host's own composition root calls it, once, and a
 *    packaged module never does. D-45 gives a module one registration pass and
 *    one boot phase, both run by the host; there is no shape in which a module
 *    builds a container, composes a module list or opens the request scope.
 *  - **seam-superseded** — the module-facing spelling is a `ModuleContext`
 *    member (`ctx.worker`, `ctx.subscribe`, `ctx.di.providePort`, `ctx.log`).
 *    Publishing the underlying function re-opens by bare specifier a seam the
 *    context closed, which is §1.4c's argument for the worker wrappers and
 *    `check:subscribe-seam`'s for the subscription one.
 *  - **accidental-reach** — §1.3 classifies it **A** outright.
 *  - **unreached** — a symbol of a **P** file that no module takes. §1.3's
 *    verdict is per file and its symbol column is per symbol; publishing the
 *    rest of a P file's exports because the file is P would publish the
 *    internals of every one of them.
 *
 * **Where "the argument, return and thrown shapes travel too" stops: one hop.**
 * T042f is the first directory where the question had to be answered, because
 * `TenantContext` and `UndoResult` are published shapes whose own members are
 * named types. A direct argument, return or thrown type is published — a
 * `@throws` a caller cannot name is a method a caller cannot call. A type one
 * further in is `unreached` and stays off, because a consumer reads
 * `ctx.mode` and `res.undoStatus` structurally without naming either; the
 * evidence is in the tree, where the one `applyUndo` consumer declares its own
 * `BulkOperationUndoStatus` rather than importing `UndoStatus`. The line is
 * arbitrary in the way every line is, and it is the cheap direction to be wrong
 * in: adding a name to a barrel is not a breaking change, removing one is.
 *
 * The map is keyed by **name alone**, across all five barrels. That is sound
 * only while no two directories publish the same spelling, which is true today
 * and is the reason the per-barrel set comparisons above are the primary
 * ratchet and this is the named half.
 */
const NOT_PUBLISHED: Readonly<Record<string, string>> = {
  // --- composition ------------------------------------------------------
  createRootContainer: 'composition — the host builds the container, once.',
  registerOrm: 'composition — the ORM is a host input; §1.4f keeps `db/` unpublishable.',
  registerValues: 'composition — a root value no module defaults (D-45).',
  getRootContainer: 'composition — the ambient root is the host process, not a module.',
  setRootContainer: 'composition — as above.',
  disposeRootContainer: 'composition — shutdown belongs to the host process.',
  installShutdownDisposal: 'composition — as above.',
  KernelCradle: 'composition — the root container type, not a module context.',
  KernelContainer: 'composition — as above.',
  composeModules: 'composition — the host composes the module list (D-45).',
  ComposedModules: 'composition — the return of `composeModules`.',
  ComposeModulesOptions: 'composition — the argument of `composeModules`.',
  ModuleEntry: 'composition — an entry in the list the host composes.',
  ContributionWindowClosedError:
    'composition — thrown at the root that contributes after the window (D-45).',
  ModuleCompositionError: 'composition — the host attributes a failed boot hook with it.',
  createModuleContext: 'composition — the host constructs the context it hands a module.',
  createModuleRegistrationSink: 'composition — as above.',
  createRegistrationOwnership: 'composition — as above.',
  ModuleContextOptions: 'composition — the argument of `createModuleContext`.',
  ModuleRegistrationSink: 'composition — a `createModuleContext` input.',
  RegistrationOwnership: 'composition — a `createModuleContext` input.',
  requiredModulesFrom: 'composition — `composeModules` refuses before a module registers.',
  absentRequiredModules: 'composition — as above.',
  assertRequiredModulesPresent: 'composition — as above.',
  RequiredModuleAbsentError: 'composition — the refusal is the host’s, before boot.',
  RequiredModule: 'composition — a `requiredModulesFrom` shape.',
  RequiredModuleFinding: 'composition — a `requiredModulesFrom` shape.',
  RequiredModulePresence: 'composition — a `requiredModulesFrom` shape.',
  registerRequestScopeHook: 'composition — the host opens the request scope (FR-020).',
  RequestScopeHookOptions: 'composition — the argument of the above.',
  attachPlatformLogger: 'composition — the host attaches the logger to the app.',
  DefaultChannelReconciler: 'composition — root-composed at boot; a module reads the channel.',
  DefaultChannelReconciliationResult: 'composition — the return of the above.',
  registerSalesChannelResolverMiddleware: 'composition — the host registers the middleware.',
  assertPublicApiBaseUrlConfigured:
    'composition — the production refusal at the top of `composeApp()` (issue #218).',

  // --- seam-superseded --------------------------------------------------
  registerPort: 'seam-superseded — a module registers through `ctx.di.providePort`.',
  moduleLogger: 'seam-superseded — a module logs through `ctx.log`.',
  platformLogger: 'seam-superseded — as above.',
  currentPlatformLogger: 'seam-superseded — as above.',
  DuplicateRegistrationError: 'seam-superseded — raised *at* a module by `ctx.di.register`.',
  ForeignRegistrationError: 'seam-superseded — as above (issue #203).',
  EagerResolutionError: 'seam-superseded — raised at a module resolving during registration.',
  Registration: 'seam-superseded — built through `ctx.asFunction(...)`.',
  RegistrationBuilder: 'seam-superseded — as above.',
  ModuleBootHook: 'seam-superseded — passed to `ctx.onBoot`, whose signature declares it.',

  // --- accidental-reach -------------------------------------------------
  ManifestReconciler: 'accidental-reach — §1.3 row 46; a component does not reach itself.',
  ReconciliationResult: 'accidental-reach — the return of the above.',

  // --- unreached --------------------------------------------------------
  AuditLogService: 'superseded by `AuditPort` (D-160.10) — the class is not published.',
  enterPlatformScope: 'unreached — `enterSystemScope` is the module-facing entry (row 13).',
  getCurrentPlatformScope: 'unreached — no module asks which scope it is in.',
  openPlatformScopeCount: 'unreached — a harness assertion over scope balance.',
  EnterPlatformScopeOptions: 'unreached — the argument of `enterPlatformScope`.',
  PlatformScope: 'unreached — the return of `getCurrentPlatformScope`.',
  SharedDropMarks: 'unreached — the cross-process half of the cache registry.',
  toCachedChannel: 'unreached — how the cache is filled, not how it is read.',
  CachedChannel: 'unreached — as above.',
  SALES_CHANNELS_LRU_TTL_MS: 'unreached — a cache tuning constant no module reads.',
  SETTINGS_LRU_TTL_MS: 'unreached — as above.',
  SettingsCache: 'unreached — a module reads through `settingsReadPort` (§1.4d).',
  SETTING_VALUE_TYPES: 'unreached — the `Setting` column enum, read through the entity.',
  SettingValueTypeDb: 'unreached — as above.',
  decryptSecretValue: 'unreached — the store decrypts; a module writes and asks "is it set?".',
  isSecretEnvelope: 'unreached — as above.',
  SecretEnvelope: 'unreached — as above.',

  // --- tenancy (T042f) --------------------------------------------------
  // The request pipeline: a context is derived server-side from the
  // authenticated actor and established by the host. A module reads it or
  // widens it, and `enterSystemScope` (kernel, row 13) is the module-facing
  // entry for an execution that starts outside a request.
  resolveTenantContext: 'composition — the host derives the context from the authenticated actor.',
  systemTenantContext: 'composition — an input to the escape hatch and the CLI scope entry.',
  orgPinnedTenantContext: 'composition — as above.',
  TenantActorInput: 'composition — the argument of `resolveTenantContext`.',
  CustomerActorInput: 'composition — as above.',
  AdminActorInput: 'composition — as above.',
  AdminScopeInput: 'composition — as above.',
  runWithTenantContext: 'composition — the host establishes the ambient context for a request.',
  runInTenantContext: 'composition — the Fastify callback-style form of the above.',
  enterTenantContext: 'composition — the synchronous form, for a worker bootstrap the host owns.',
  runWithoutTenantContext: 'composition — clearing the context is a harness and host affordance.',
  forkScopedEm: 'composition — the host forks; a module gets `ctx.em` or `CommandContext.em`.',
  // The runtime classification registry: the decorators write into it and
  // attach the MikroORM filters; the host and
  // `check-entity-tenant-classification` read it. A module applies a decorator
  // and never names what it wrote.
  tenantClassifications: 'unreached — the decorators write the registry; the host reads it.',
  ClassificationMeta: 'unreached — a row of that registry.',
  ScopeClass: 'unreached — the `scope` field of a row of that registry.',
  ORG_FILTER: 'unreached — the decorators attach the filter; a module never names it.',
  CUSTOMER_FILTER: 'unreached — as above.',
  withOrgScope: 'unreached — every module reach into the escape hatch is `withSystemScope`.',
  setEscapeHatchAuditSink: 'composition — the host wires the escape hatch to the audit sink.',
  EscapeHatchAuditRecord: 'composition — the argument of that sink.',
  EscapeHatchAuditSink: 'composition — the type of that sink.',
  orgScopeWhere:
    'unreached — modules take `orgConstraintFor` and build their own `where`; ' +
    'publishing a MikroORM fragment builder would freeze that shape into the contract.',
  TenantScopeMode: 'unreached — a member of `TenantContext`, read as `ctx.mode`, never declared.',
  TenantActor: 'unreached — a member of `TenantContext`, read as `ctx.actor`.',
  TenantImpersonation: 'unreached — as above.',

  // --- commands (T042f) -------------------------------------------------
  CommandBusOptions: 'composition — a root builds the one bus and supplies its metadata resolver.',
  CommandRequestMeta: 'composition — the return of that resolver.',
  // The command registry is a host-owned allow-list of every module's actions,
  // read by `check:command-coverage` and by the undo affordance. No module
  // reaches any of it, and publishing the list would not answer the question a
  // packaged module raises about it — it would let a package read a table it
  // cannot appear in.
  COMMAND_REGISTRY: 'unreached — a host-owned allow-list of actions, not a module-facing API.',
  CommandRegistryEntry: 'unreached — a row of that allow-list.',
  KnownCommandAction: 'unreached — the key space of that allow-list.',
  isRegisteredCommand: 'unreached — read by `check:command-coverage` and the undo affordance.',
  isReversibleCommand: 'unreached — as above.',
  registeredCommandActions: 'unreached — as above.',
  UndoStatus:
    'unreached — a member of `UndoResult`; catalog, its one consumer, reads `res.undoStatus` ' +
    'and declares its own `BulkOperationUndoStatus` for the column.',
  RevertConflict: 'unreached — a member of `UndoResult`, read structurally.',
  RevertConflictReason: 'unreached — a member of `RevertConflict`.',
  shallowFieldEquals: 'unreached — the default for `RevertHandlers.equals`, applied by `applyUndo`.',
};

/**
 * `src/composition/index.ts` — the **`./composition`** subpath (D-160.14,
 * feature 109 T010; `host-package.md` §2.7).
 *
 * It is the sixth subpath the host's `exports` map declares and it is **not**
 * public API. The 27 names below are the platform symbols a composition root
 * needs and no public barrel carries; they were derived two independent ways
 * that agree — a parse of the five barrels' `ExportDeclaration` nodes, and a
 * `tsc` compile of 165 one-line consumers (33 names × 5 subpaths) against the
 * built package's `exports` map, which answers 159 errors and six resolutions.
 *
 * **Written down here for the same reason the five are**: this record and the
 * barrel are the only two statements of the subpath's contents, and the set
 * comparison below fails in both directions. Adding a symbol to the barrel and
 * not to this record fails; leaving a name here after its export goes fails too.
 * Without it, T010's *"the barrel exports the 27 and only the 27"* would be a
 * thing a reviewer looked at once.
 *
 * Grouped by the file each name is re-exported out of — the granularity §1.3
 * classifies at, and the granularity the ruling's own table uses.
 */
const HOST_COMPOSITION_SURFACE: Readonly<Record<string, readonly string[]>> = {
  'http/server.ts': ['buildServer', 'ModulePlugin'],
  'http/interceptors/index.ts': ['ApiInterceptorRegistry'],
  'kernel/container.ts': [
    'createRootContainer',
    'registerOrm',
    'registerValues',
    'KernelContainer',
  ],
  'kernel/compose.ts': ['composeModules', 'DecorationRecord'],
  'kernel/module-context.ts': ['createRegistrationOwnership'],
  'kernel/request-scope-hook.ts': ['registerRequestScopeHook'],
  'kernel/logging.ts': ['platformLogger'],
  'kernel/lifecycle/registry-cache.ts': ['registryCache', 'publishStateChanged'],
  'kernel/lifecycle/activation-resolver.ts': ['activationDeclarationsFrom'],
  'kernel/lifecycle/required-modules.ts': ['requiredModulesFrom'],
  'kernel/settings/compose.ts': ['composeSettingsKernel', 'SettingsKernel'],
  'kernel/settings/manifest-reconciler.ts': ['ManifestReconciler'],
  'kernel/sales-channels/compose.ts': ['composeSalesChannelsKernel', 'SalesChannelsKernel'],
  'kernel/sales-channels/default-channel-reconciler.ts': ['DefaultChannelReconciler'],
  'kernel/i18n/request-language.ts': ['createRequestLanguageResolver'],
  'kernel/audit/audit-log-service.ts': ['AuditLogService'],
  'tenancy/scoped-em.ts': ['forkScopedEm'],
  'tenancy/resolve-tenant-context.ts': ['resolveTenantContext', 'systemTenantContext'],
};

/** The repository root, from the platform sources this file already reads. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * The subpaths the `exports` map declares and no barrel carries — D-160.14's
 * third state, where `node` and `tsc` resolve the specifier and
 * `check:platform-surface` refuses a *module* that names it.
 *
 * **Not written here.** It was a `Set` of bare names in this file and a second,
 * `./`-prefixed one in `test/unit/packages/host-package.test.ts`, and the
 * reasons — the load-bearing part, the class being a judgement about who may
 * name a surface — were prose in one of the two. `specs/115-lifecycle-container-move/`
 * Phase 2 moved the answer to `scripts/lib/platform-surface.ts`, keyed by
 * subpath and valued by its reason, so there is one home and a member cannot
 * arrive without one.
 *
 * The generalisation matters more than the deduplication. This file's
 * reconciliation read `subpath !== 'composition'` while there was one exception.
 * `contracts/operator-half.md` R5.3: *"the literal is written for exactly one
 * exception and must be generalised before a second can exist; leaving it and
 * special-casing `lifecycle` beside it would be the same mistake twice."* None
 * of them may be folded into {@link PUBLISHED_SUBPATHS} — that list is keyed by
 * target *file* with no subpath dimension, so an entry there publishes every
 * symbol of the file for a module's relative reach as well, and, the check
 * reporting `violations=0`, would change nothing it prints.
 */
const HOST_INTERNAL_SUBPATHS: ReadonlySet<string> = new Set(
  Object.keys(HOST_INTERNAL_SUBPATH_REASONS),
);

/**
 * Every first-party TypeScript source in the checkout **outside the platform**,
 * keyed by repo-relative path.
 *
 * The population is the workspace's own members, read off `pnpm-workspace.yaml`
 * rather than a list of directories written here — so a member added later is a
 * consumer this walk sees. The platform is excluded because the question is
 * whether anything *outside* it names the subpath: the barrel re-exporting a
 * symbol its own directory declares is not a consumer of it.
 */
function firstPartySourcesOutsideThePlatform(): ReadonlyMap<string, string> {
  const members = workspaceMembers(REPO_ROOT, nodeWorkspaceFs());
  const platformRoot = platformSourceRootOf(members);
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      if (platformRoot !== null && full.startsWith(platformRoot)) continue;
      out.set(full.slice(REPO_ROOT.length), readFileSync(full, 'utf8'));
    }
  };
  for (const member of members) {
    if (!existsSync(member.dir)) continue;
    walk(member.dir);
  }
  return out;
}

/** Every name a file imports from `<host>/<subpath>`, in either import shape. */
function subpathImportsIn(text: string, subpath: string): string[] {
  const names: string[] = [];
  const pattern = new RegExp(
    String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@endora-commerce/platform/${subpath}'`,
    'g',
  );
  for (const match of text.matchAll(pattern)) {
    for (const raw of (match[1] ?? '').split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name !== undefined && name !== '') names.push(name);
    }
  }
  return names;
}

/**
 * The two classes of declared subpath, reconciled against the manifest in both
 * directions (D-160.14; `specs/115-lifecycle-container-move/contracts/operator-half.md`
 * R5.3).
 *
 * This lived inside the `./composition` block and asked one question — *is
 * `composition` declared and unpublished?* — with the exception written into the
 * filter as a literal. That shape answers for the member somebody remembered,
 * which is how a subpath in **neither** class could be declared with nothing to
 * say so, and why the generalisation had to precede a third member rather than
 * accompany it.
 *
 * §2.7.5(a) is why the two lists stay two: `PlatformSurface.published` is keyed
 * by target file with no subpath dimension, so an entry there would publish
 * `composeModules` out of `kernel/compose.ts` for every reach at that file — a
 * module's relative `../../src/kernel/compose.js` included — and, the check
 * reporting `violations=0`, would change nothing it prints. A blindness that
 * arrives green.
 */
describe('the `exports` map is published ∪ host-internal, and nothing else', () => {
  const declared = (): readonly string[] =>
    platformSubpathsOf(workspaceMembers(REPO_ROOT, nodeWorkspaceFs()));

  it('declares every host-internal subpath, and publishes none of them', () => {
    // Direction one: a member of the class the map does not declare. It would
    // resolve for nobody — the host's own reach included — while every list in
    // the estate agreed it was fine.
    for (const subpath of HOST_INTERNAL_SUBPATHS) {
      expect(declared(), subpath).toContain(subpath);
      expect(PUBLISHED_SUBPATHS, subpath).not.toContain(subpath);
    }
    expect(HOST_INTERNAL_SUBPATHS.size, 'the class is empty — the reconciliation below is vacuous')
      .toBeGreaterThan(0);
  });

  it('declares no subpath that is neither published nor host-internal', () => {
    // Direction two, and the one the literal could not ask. A subpath added to
    // the manifest and to neither class is public API by resolution and by no
    // decision — which is the state `./lifecycle` was in for the length of one
    // commit while this feature's red proof was being taken.
    expect([...PUBLISHED_SUBPATHS].sort()).toEqual(
      declared()
        .filter((subpath) => !HOST_INTERNAL_SUBPATHS.has(subpath))
        .sort(),
    );
  });

  it('records why each host-internal subpath is not public API', () => {
    // The reason is the member. A set of bare names is a list somebody grows,
    // and the whole of this class is a judgement about who may name a surface,
    // which no name records. Held to a sentence rather than to a string so that
    // `''` and a placeholder are both failures.
    for (const [subpath, reason] of Object.entries(HOST_INTERNAL_SUBPATH_REASONS)) {
      expect(reason.length, subpath).toBeGreaterThan(80);
    }
  });
});

describe('`./composition`, the subpath no module may name (D-160.14)', () => {
  const barrel = 'composition/index.ts';
  const expected = [...new Set(Object.values(HOST_COMPOSITION_SURFACE).flat())].sort();

  it('exports exactly the 27 symbols the ruling names, and nothing else', () => {
    // Both directions in one comparison, which is what makes T010's "the barrel
    // exports the 27 and only the 27" an assertion rather than a review.
    expect([...new Set(barrelExports(barrel))].sort()).toEqual(expected);
    expect(expected).toHaveLength(27);
  });

  it('exports each name out of the file the ruling attributes it to', () => {
    const parsed = parseBarrel(readFileSync(join(SRC, barrel), 'utf8'), barrel);
    const byFile: Record<string, string[]> = {};
    for (const symbol of parsed.published) (byFile[symbol.target] ??= []).push(symbol.name);
    for (const names of Object.values(byFile)) names.sort();
    const sorted = Object.fromEntries(
      Object.entries(HOST_COMPOSITION_SURFACE).map(([file, names]) => [file, [...names].sort()]),
    );
    expect(byFile).toEqual(sorted);
  });


  /**
   * R3.1a — the subpath is the *whole* of a symbol's reachability. A symbol
   * graduates to a public barrel in the merge request that first gives it a
   * module-package production consumer, and it leaves this barrel in the same
   * merge request. Two homes would be two answers to "is this public API?".
   */
  it('shares no symbol with a public barrel', () => {
    const publicNames = new Set(PUBLISHED_SUBPATHS.flatMap((s) => barrelExports(barrelKeyOf(s))));
    expect(expected.filter((name) => publicNames.has(name))).toEqual([]);
  });

  /**
   * The second direction, and R3.3a is why it can exist at all: nothing outside
   * the platform could name this subpath until T011a rewrote
   * `backend/test/helpers/test-server.ts`'s 27 shim declarations to it. A
   * ratchet whose population is empty on the day it lands reports green over
   * nothing, which is issue #113's shape.
   *
   * So: a name on the barrel that no first-party source imports is a finding —
   * the subpath is not a place to park surface against a future need — and a
   * name imported from it that the barrel does not carry is one too. The second
   * is `tsc`'s answer as well, and it is asserted here because this file is
   * where the population is derived and a consumer outside this repository gets
   * no `tsc` run of ours.
   */
  it('carries exactly the names its consumers outside the platform import', () => {
    const sources = firstPartySourcesOutsideThePlatform();
    expect(sources.size, 'the walk opened no first-party source').toBeGreaterThan(1000);

    const imported = new Map<string, string[]>();
    for (const [file, text] of sources) {
      for (const name of subpathImportsIn(text, 'composition')) {
        (imported.get(name) ?? imported.set(name, []).get(name)!).push(file);
      }
    }
    expect(
      [...imported.keys()],
      'no first-party source imports the subpath — the ratchet below would be vacuous',
    ).not.toEqual([]);

    expect([...imported.keys()].sort()).toEqual(expected);
  });
});

/**
 * `./lifecycle`, the third host-internal subpath (`specs/115-lifecycle-container-move/`,
 * D115-4; `contracts/operator-half.md` §5).
 *
 * ## Why its ledger is derived where `HOST_COMPOSITION_SURFACE` is written down
 *
 * R5.4 asks for `HOST_COMPOSITION_SURFACE`'s instrument: a per-file symbol map,
 * both directions asserted. The map is written by hand there because the 27
 * symbols were **ruled on** — D-160.14 names each one, and a written list is
 * what makes a twenty-eighth a review event.
 *
 * Here the barrel's contents are not a ruling, they are a **consequence**, and
 * writing the consequence down would be the shape D-100 is about. The subpath
 * exists to give the application's fifteen ledgered relative reaches into
 * `packages/platform/dist/lifecycle/` an address (`RELATIVE_HOST_REACHES`, Phase
 * 1). Each of those reaches is a shim spelling `export * from '<target>'`, so
 * the application holds the target's **whole namespace** — and a reach can be
 * retired onto this subpath only if every name it currently yields is here. That
 * makes the expected set a function of the ledger and of the fourteen files it
 * names, and a second, hand-written copy of it would be a second answer waiting
 * to disagree with the first.
 *
 * ## What the two directions are, and what each one catches
 *
 *  - **A name on the barrel out of a file no ledgered reach names** is surface
 *    parked against a future need, which is precisely what R5.4 forbids.
 *    `routes.storefront.ts` and `commands/activation.commands.ts` are the live
 *    proof that the population is narrower than "the lifecycle directory": no
 *    application file reaches either, and neither is here.
 *  - **A name a reached file exports and the barrel does not carry** is a shim
 *    that cannot retire. It would fail silently in the worst way available — the
 *    reach stays, the ledger entry stays, and the phase that was supposed to
 *    drain it reports success over the names it happened to move.
 *
 * The second direction is what makes this ratchet non-vacuous on the day it
 * lands, which the *consumer* population cannot be: nothing outside the platform
 * names this subpath yet, by design (Phase 2 moves no file), so the assertion
 * `./composition` uses would be green over nothing — issue #113's shape. It
 * becomes the right assertion in Phase 7, when the shims are gone and the
 * consumers are import sites; until then the shims **are** the host's reach and
 * are the honest population.
 */
describe('`./lifecycle`, the operator surface no module may name (D115-4)', () => {
  const barrel = 'lifecycle/index.ts';
  const PLATFORM_LIFECYCLE = 'packages/platform/src/lifecycle/';

  /**
   * The platform-lifecycle files the application reaches today, off Phase 1's
   * ledger rather than a list here. The key's second half is the canonical
   * platform source file, which is the whole reason that ledger is keyed by file
   * and not by specifier.
   */
  const reachedFiles = (): string[] =>
    [
      ...new Set(
        Object.keys(RELATIVE_HOST_REACHES)
          .map((key) => key.split('|')[1] ?? '')
          .filter((target) => target.startsWith(PLATFORM_LIFECYCLE)),
      ),
    ].sort();

  /** `barrel key → names`, for a lifecycle source file. */
  const exportsOf = (key: string): string[] =>
    [
      ...new Set(
        parseBarrel(readFileSync(join(SRC, key), 'utf8'), key).published.map((s) => s.name),
      ),
    ].sort();

  const parsed = (): ReturnType<typeof parseBarrel> =>
    parseBarrel(readFileSync(join(SRC, barrel), 'utf8'), barrel);

  it('carries exactly the files the host reaches, and every name each of them exports', () => {
    const files = reachedFiles();
    // The vacuous-pass guard, and it is the one that matters here: the whole
    // expected set is derived from this ledger, so a ledger that stopped naming
    // lifecycle targets would make both directions compare nothing to nothing.
    expect(files.length, 'no ledgered reach names a platform lifecycle file').toBeGreaterThan(5);

    const byFile: Record<string, string[]> = {};
    for (const symbol of parsed().published) (byFile[symbol.target] ??= []).push(symbol.name);
    for (const names of Object.values(byFile)) names.sort();

    const expected: Record<string, string[]> = {};
    for (const file of files) {
      const key = `lifecycle/${file.slice(PLATFORM_LIFECYCLE.length)}`;
      expected[key] = exportsOf(key);
      expect(expected[key]?.length, `${key} exports nothing — it cannot be a reach`).toBeGreaterThan(
        0,
      );
    }

    // One comparison, both directions: a barrel name out of an unreached file
    // and a reached file's export the barrel drops both land here.
    expect(byFile).toEqual(expected);
  });

  it('is read in full, so a name is never dropped by the parse', () => {
    // `export *` is how a shim is written, and it is exactly what this barrel
    // may not be: `parseBarrel` reports it as unreadable, and a barrel whose
    // names cannot be enumerated is one no `exports` map can be judged against.
    expect(parsed().unreadable).toEqual([]);
  });

  it('shares no symbol with a published barrel or with `./composition`', () => {
    // R5.5 — a symbol has one home, and graduates to a public barrel in the
    // merge request that first gives it a module-package production consumer,
    // leaving this one in the same merge request. Two homes would be two answers
    // to "is this public API?", and between two host-internal barrels it would
    // also be two answers to "which of them owns this".
    const mine = new Set(barrelExports(barrel));
    const elsewhere = new Set([
      ...PUBLISHED_SUBPATHS.flatMap((s) => barrelExports(barrelKeyOf(s))),
      ...barrelExports('composition/index.ts'),
    ]);
    expect([...mine].filter((name) => elsewhere.has(name)).sort()).toEqual([]);
  });
});

describe('the platform’s published surface', () => {
  it('the kernel barrel exports exactly the classification’s P set', () => {
    const expected = [...new Set(Object.values(PUBLISHED_KERNEL_SURFACE).flat())].sort();
    const actual = [...new Set(barrelExports('kernel/index.ts'))].sort();
    expect(actual).toEqual(expected);
  });

  it('the http barrel exports exactly the six symbols §1.3 marks P', () => {
    expect([...new Set(barrelExports('http/index.ts'))].sort()).toEqual(
      [...PUBLISHED_HTTP_SURFACE].sort(),
    );
  });

  it('the events barrel exports exactly EventBus and EventBase', () => {
    expect([...new Set(barrelExports('events/index.ts'))].sort()).toEqual(
      [...PUBLISHED_EVENTS_SURFACE].sort(),
    );
  });

  it('the tenancy barrel exports exactly the classification’s P set (T042f)', () => {
    const expected = [...new Set(Object.values(PUBLISHED_TENANCY_SURFACE).flat())].sort();
    expect([...new Set(barrelExports('tenancy/index.ts'))].sort()).toEqual(expected);
  });

  it('the commands barrel exports exactly the classification’s P set (T042f)', () => {
    const expected = [...new Set(Object.values(PUBLISHED_COMMANDS_SURFACE).flat())].sort();
    expect([...new Set(barrelExports('commands/index.ts'))].sort()).toEqual(expected);
  });

  /**
   * The per-*file* half of the two T042f sets, which the flattened comparisons
   * above cannot see: `parseBarrel` records the file each name is re-exported
   * out of, and §1.3's verdict is per file. A name that moved between files —
   * or a barrel that re-exported a symbol from a directory that is not its own,
   * which §2.6 forbids because every barrel is a package boundary in waiting —
   * passes a flattened set comparison and fails here.
   */
  it('publishes each tenancy and commands name out of the file §1.3 classifies', () => {
    const byFile = (subpath: string): Record<string, string[]> => {
      const parsed = parseBarrel(
        readFileSync(join(SRC, `${subpath}/index.ts`), 'utf8'),
        `${subpath}/index.ts`,
      );
      const out: Record<string, string[]> = {};
      const prefix = `${subpath}/`;
      for (const symbol of parsed.published) {
        // Keyed as the expected sets are: the target file's name inside the
        // barrel's own directory, with the `.js` specifier spelling restored.
        // A target *outside* that directory keeps its full key on purpose — it
        // matches no expected group, and the failure then reads
        // `kernel/ports/audit.ts` rather than a plausible-looking bare filename.
        const key = symbol.target.startsWith(prefix)
          ? `${symbol.target.slice(prefix.length, -'.ts'.length)}.js`
          : symbol.target;
        (out[key] ??= []).push(symbol.name);
      }
      for (const names of Object.values(out)) names.sort();
      return out;
    };
    const sorted = (surface: Readonly<Record<string, readonly string[]>>) =>
      Object.fromEntries(Object.entries(surface).map(([file, names]) => [file, [...names].sort()]));

    expect(byFile('tenancy')).toEqual(sorted(PUBLISHED_TENANCY_SURFACE));
    expect(byFile('commands')).toEqual(sorted(PUBLISHED_COMMANDS_SURFACE));
  });

  /**
   * The named half of the ratchet. The set comparison above already fails when
   * one of these returns, but it fails as a diff of ninety names; this one says
   * which name came back and why it was taken off, which is the sentence the
   * author of that merge request needs.
   */
  it('publishes none of the names T042c and T042f removed, each with its reason', () => {
    const exported = new Set(PUBLISHED_SUBPATHS.flatMap((s) => barrelExports(barrelKeyOf(s))));
    const returned = Object.entries(NOT_PUBLISHED)
      .filter(([name]) => exported.has(name))
      .map(([name, reason]) => `${name} — removed because: ${reason}`);
    expect(returned).toEqual([]);
  });

  /**
   * D-160.10, stated on its own so the ruling has a test rather than a row in a
   * list. Publishing the class type freezes into the platform contract the
   * shape Principle XIII routes *around*: a domain write goes through
   * `CommandBus.run`, and the audit row is the bus's to write.
   */
  it('publishes AuditPort and not the AuditLogService class (D-160.10)', () => {
    const exported = barrelExports('kernel/index.ts');
    expect(exported).toContain('AuditPort');
    expect(exported).not.toContain('AuditLogService');
  });

  /**
   * The vacuous-pass guard. Every assertion above is over a parse of a file
   * path; a barrel that moved, was renamed or stopped matching the
   * `export { … } from '…'` shape would make `barrelExports` return `[]`, and
   * an empty set compared against an empty set is a green that read nothing.
   *
   * The population is {@link PUBLISHED_SUBPATHS}, not a list written here: a
   * sixth subpath ruled published gets a barrel this guard reads and no
   * expected set, which is the failure the whole file exists to produce.
   */
  it('read a non-empty barrel for every published directory (D-160.7)', () => {
    for (const subpath of PUBLISHED_SUBPATHS) {
      expect(barrelExports(barrelKeyOf(subpath)).length, subpath).toBeGreaterThan(0);
    }
    expect(barrelExports('kernel/index.ts').length).toBeGreaterThan(50);
  });

  /**
   * The other half of that guard, and the reason T042f exists: a directory
   * D-160.7 publishes with **no expected set** here is a barrel nothing holds
   * to §1.3, which is exactly the state `tenancy` and `commands` were in while
   * `check:platform-surface` judged module reaches against them.
   */
  it('holds every published subpath to an expected set', () => {
    const declared: Readonly<Record<string, readonly string[]>> = {
      kernel: Object.values(PUBLISHED_KERNEL_SURFACE).flat(),
      http: PUBLISHED_HTTP_SURFACE,
      tenancy: Object.values(PUBLISHED_TENANCY_SURFACE).flat(),
      commands: Object.values(PUBLISHED_COMMANDS_SURFACE).flat(),
      events: PUBLISHED_EVENTS_SURFACE,
    };
    expect(Object.keys(declared).sort()).toEqual([...PUBLISHED_SUBPATHS].sort());
    for (const subpath of PUBLISHED_SUBPATHS) {
      expect(declared[subpath]?.length ?? 0, subpath).toBeGreaterThan(0);
    }
  });
});
