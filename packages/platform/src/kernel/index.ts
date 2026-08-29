/**
 * The kernel (feature 072) — the platform's module-facing surface.
 * Peer of `events/`, `tenancy/`, `http/`, `db/`; becomes the `./kernel` subpath
 * of `@endora-commerce/platform` in F4 (D-160.1 — one host package, not five
 * mirroring the five directories).
 *
 * **That subpath is the boundary a future `@endora-commerce/kernel` would
 * take.** D-160.6 answered the meta-package *no* on measurement rather than on
 * possibility — over the five publishable directories the graph holds one
 * breakable cycle, and the median module needs four of the five — and it kept
 * the split available in the direction it is cheap: one package becomes five by
 * re-pointing a subpath, while five published packages become one only by
 * breaking every dependent. So this barrel is a package boundary in waiting,
 * and it carries **this directory's** symbols and nothing else. A symbol from
 * `http/`, `events/`, `tenancy/` or `commands/` re-exported here to save a
 * consumer one import line spends that option for a convenience.
 *
 * **What is on it is decided by `contracts/host-package.md` §1.3, not by what
 * happens to be here** (T042c). Until T042c the barrel was an accumulation:
 * 126 names, of which modules took **six** — `ModuleContext`, `lazyPort`, the
 * two public-origin readers and two settings errors — while every other module
 * reach into this directory went by relative path and will become a bare
 * specifier when its module moves. Publishing the rest of the directory
 * alongside them would have made `@endora-commerce/platform` owe a major
 * version for `ManifestReconciler` (§1.3 row 46, **A**, on the barrel since
 * feature 072), for the container the host builds once, and for
 * `AuditLogService`, whose class D-160.10 replaced with {@link AuditPort}
 * precisely so the platform does not freeze into a contract the shape
 * Principle XIII routes around.
 *
 * So the rule is: a symbol is here when §1.3 records a module taking it from a
 * file it marks **P**, or when it is the argument, return or thrown shape of a
 * published method — a `@throws` a caller cannot name is a method a caller
 * cannot call. Everything else is reachable by relative path, which the two
 * composition roots and the tests have and a packaged module does not.
 * `test/unit/kernel/published-surface.test.ts` is the two-way ratchet, and it
 * carries the reason each removed name is not published.
 *
 * Three groups deserve naming here because a future author will look for them:
 *
 *  - **the composition machinery** — `createRootContainer`, `composeModules`,
 *    `registerValues`, `createModuleContext`, `registerRequestScopeHook`,
 *    `requiredModulesFrom` and the errors they raise. D-45 gives a module one
 *    registration pass and one boot phase, both run by the host; no module
 *    builds a container or composes a module list.
 *  - **the seams a `ModuleContext` already exposes** — `registerPort`
 *    (`ctx.di.providePort`), `defineModuleWorker` / `subscribeForModule` /
 *    `pauseWorkersFor` / `resumeWorkersFor` (`ctx.worker`, `ctx.subscribe`),
 *    `moduleLogger` (`ctx.log`). Publishing the function re-opens by bare
 *    specifier the seam the context closed, which is `check:subscribe-seam`'s
 *    argument in reverse.
 *  - **the three classes §1.4d/§1.4e make ports** — `SettingsService`,
 *    `SalesChannelMembershipService` and `SalesChannelResolverService` are
 *    reached through `settingsReadPort`, `salesChannelMembershipPort` and
 *    `salesChannelResolutionPort`; their error and mutation shapes stay,
 *    because those are what a caller of the port catches and passes.
 *
 * Also not here, and classified **A** outright by §1.3: the registry cache,
 * `ModuleRegistration`, `activationDeclarationsFrom`, and anything under `db/`,
 * `overlay/` or `packages/`.
 *
 * The boundary rule, enforced by `scripts/check-kernel-boundary.ts`: a module
 * may declare an ORM relation into the kernel, never into another module, and
 * the kernel never relates into a module.
 */

export { type ModuleContext } from './module-context.js';
export { lazyPort } from './lazy-port.js';

/**
 * The public origin of this backend, and the error the second one throws when a
 * production deployment has none (issue #218). The root's boot-time refusal,
 * `assertPublicApiBaseUrlConfigured`, is not published: it is the host's.
 */
export {
  PublicApiBaseUrlNotConfiguredError,
  configuredPublicApiBaseUrl,
  resolvePublicApiBaseUrl,
} from './public-api-base-url.js';

export { effectiveState, toModulePresenceDto } from './lifecycle/effective-state.js';
/**
 * The **P** half of `plugin-helpers` (§1.4c). `rethrowIfModuleDisabled` and
 * `ModuleDisabledError` are mandated by composition-checklist item 7, and
 * `requireModuleEnabled` is the sanctioned call for an entry point with no port
 * and no request. The four worker/subscriber wrappers are not here — a composed
 * module uses `ctx.worker` and `ctx.subscribe`.
 */
export {
  ModuleDisabledError,
  rethrowIfModuleDisabled,
  requireModuleEnabled,
} from './lifecycle/plugin-helpers.js';

/**
 * The platform's structured-logger shape: `ctx.log`, the optional worker
 * logger, and every `log` a module is handed or holds.
 *
 * The **type** is published and the destination machinery around it is not —
 * `attachPlatformLogger` and `moduleLogger` are the host's, and a module that
 * could call the second would re-open by bare specifier the attribution seam
 * `ModuleContext` closed. A module needs the name because it declares fields
 * and constructor parameters of this shape; it needs none of the rest.
 *
 * It was published under the name `WorkerLogger` from
 * `lifecycle/plugin-helpers.js`, an identical interface declared a second time
 * because nothing had noticed the first. Naming a consumer rather than a shape
 * is what made a second declaration look reasonable — `ctx.log` is not a
 * worker's — and the two spellings then diverged into a third name, an alias
 * called `ModuleLifecycleLogger`, colliding with the unrelated hook logger
 * `@endora-commerce/contracts` publishes under exactly that name.
 */
export { type PlatformLogger } from './logging.js';

/**
 * The one scope entry a module opens for itself (§1.3 row 13, 27 reaches). The
 * platform-scope family below it is the host's: a module never asks which scope
 * it is in, and the balance counter is a harness assertion.
 */
export { enterSystemScope } from './scope.js';

/**
 * The audit seam (D-160.10). `AuditLogService` is the host's implementation and
 * is deliberately **not** published: Principle XIII routes a domain write
 * through `CommandBus.run`, which makes the bus the audit log's caller, and
 * freezing the writer class into the platform contract would owe third-party
 * packages a major version to change the shape the principle routes around.
 */
export { type AuditPort, type RecordAuditInput, type AuditLogFilter } from './ports/audit.js';
export { AuditLogEntry } from './audit/audit-log-entry.entity.js';

export {
  InProcessCacheRegistry,
  inProcessCaches,
  type InProcessCacheLayer,
} from './cache/in-process-cache-registry.js';

export { hashPassword, verifyPassword } from './crypto/password-hasher.js';

export { SalesChannel } from './sales-channels/sales-channel.entity.js';
/**
 * The channel cache as a module reads it. `toCachedChannel`, `CachedChannel`
 * and the LRU TTL are how it is *filled*, which is the kernel's own half.
 */
export {
  SalesChannelsCache,
  SALES_CHANNELS_CACHE_KEY_PREFIX,
  SALES_CHANNELS_CACHE_NAMESPACE,
  type SalesChannelsCacheInvalidation,
} from './sales-channels/sales-channels-cache.js';
// `SalesChannelResolverService` itself is **not** published (§1.4e): a consumer
// resolves `salesChannelResolutionPort` and types on `SalesChannelResolutionPort`.
// `parseHostMap` is the host-map parser a composition root calls, and
// `ResolverError` is the refusal shape the port's `resolveActive` returns.
export {
  parseHostMap,
  type ResolverError,
} from './sales-channels/sales-channel-resolver.service.js';
export { NoSystemDefaultChannel } from './sales-channels/no-system-default-channel.error.js';
// `SalesChannelMembershipService` itself is **not** published (§1.4e): a
// consumer resolves `salesChannelMembershipPort` and types on
// `SalesChannelMembershipPort`. The two mutation types stay — they are
// parameter and return shapes of that port's own methods.
export {
  type MembershipMutationOptions,
  type MembershipMutationResult,
} from './sales-channels/sales-channel-membership.service.js';
// `registerSalesChannelResolverMiddleware` is the host's: the root registers
// the middleware, a module reads the channel it resolved.
export {
  getResolvedChannel,
  currentSalesChannel,
} from './sales-channels/sales-channel-resolver.middleware.js';
export {
  productIdsInRequestChannel,
  outOfRequestChannel,
} from './sales-channels/request-channel-assortment.js';

export { Setting } from './settings/setting.entity.js';
export { SettingGroup } from './settings/setting-group.entity.js';
export { SettingValue } from './settings/setting-value.entity.js';
// `SettingsService` itself is **not** published (§1.4d): a consumer resolves
// `settingsReadPort` and types on `SettingsReadPort`. The four errors stay —
// they are what a caller of that port catches, and the port's doc block names
// each one in a `@throws`.
export {
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
  SettingValueShapeMismatch,
  SettingsChannelIdInvalid,
} from './settings/settings.service.js';
// The settings cache's *invalidation* seam and its key namespace. `SettingsCache`
// itself is the store the kernel reads through (§1.4d); a module goes through
// `settingsReadPort`.
export {
  SETTINGS_CACHE_KEY_PREFIX,
  SETTINGS_CACHE_NAMESPACE,
  type SettingsCacheInvalidation,
} from './settings/settings-cache.js';
// A module writes a secret and asks whether one is set; decrypting is the
// store's, and the envelope shape with it.
export {
  encryptSecretValue,
  secretValueIsSet,
  SecretKeyMissing,
  SecretKeyInvalid,
} from './settings/secret-value-codec.js';

export {
  type AdminPermissionChecker,
  type RequireAdminAnyFactory,
  type RequireAdminFactory,
} from './ports/require-admin.js';
export { type OrganizationReadPort, type OrganizationSnapshot } from './ports/organizations.js';
export { type RequireCustomerGuard } from './ports/require-customer.js';
export { type SettingsReadPort, type SettingsReadResult } from './ports/settings.js';
export {
  type ResolvedChannel,
  type SalesChannelMembershipPort,
  type SalesChannelResolutionPort,
} from './ports/sales-channel.js';
