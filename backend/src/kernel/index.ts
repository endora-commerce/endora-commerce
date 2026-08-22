/**
 * The kernel (feature 072) — composition, the request seam and the four ports.
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
 * What this barrel deliberately does not carry is `contracts/host-package.md`
 * §1.3's **A** column — `defineModuleWorker`, `subscribeForModule`,
 * `pauseWorkersFor`, `resumeWorkersFor` (a composed module uses `ctx.worker` /
 * `ctx.subscribe`), the registry cache, `ModuleRegistration`,
 * `activationDeclarationsFrom`, and anything under `db/`, `overlay/` or
 * `packages/` — plus the three classes §1.4d/§1.4e make ports:
 * `SettingsService`, `SalesChannelMembershipService` and
 * `SalesChannelResolverService` are reached through `settingsReadPort`,
 * `salesChannelMembershipPort` and `salesChannelResolutionPort`.
 *
 * The boundary rule, enforced by `scripts/check-kernel-boundary.ts`: a module
 * may declare an ORM relation into the kernel, never into another module, and
 * the kernel never relates into a module.
 */
export {
  createRootContainer,
  registerOrm,
  registerValues,
  getRootContainer,
  setRootContainer,
  disposeRootContainer,
  installShutdownDisposal,
  type KernelCradle,
  type KernelContainer,
} from './container.js';

export {
  createModuleContext,
  createModuleRegistrationSink,
  createRegistrationOwnership,
  DuplicateRegistrationError,
  EagerResolutionError,
  ForeignRegistrationError,
  type ModuleBootHook,
  type ModuleContext,
  type ModuleContextOptions,
  type ModuleLifecycleLogger,
  type ModuleRegistrationSink,
  type Registration,
  type RegistrationBuilder,
  type RegistrationOwnership,
} from './module-context.js';

export {
  composeModules,
  ContributionWindowClosedError,
  ModuleCompositionError,
  type ComposedModules,
  type ComposeModulesOptions,
  type ModuleEntry,
} from './compose.js';

export {
  absentRequiredModules,
  assertRequiredModulesPresent,
  requiredModulesFrom,
  RequiredModuleAbsentError,
  type RequiredModule,
  type RequiredModuleFinding,
  type RequiredModulePresence,
} from './lifecycle/required-modules.js';

export { effectiveState, toModulePresenceDto } from './lifecycle/effective-state.js';
export {
  ModuleDisabledError,
  rethrowIfModuleDisabled,
  requireModuleEnabled,
  type WorkerLogger,
} from './lifecycle/plugin-helpers.js';

export {
  enterPlatformScope,
  enterSystemScope,
  getCurrentPlatformScope,
  openPlatformScopeCount,
  type EnterPlatformScopeOptions,
  type PlatformScope,
} from './scope.js';

export {
  attachPlatformLogger,
  currentPlatformLogger,
  moduleLogger,
  platformLogger,
  type PlatformLogger,
} from './logging.js';

export {
  registerRequestScopeHook,
  type RequestScopeHookOptions,
} from './request-scope-hook.js';

export {
  AuditLogService,
  type RecordAuditInput,
} from './audit/audit-log-service.js';
export { AuditLogEntry } from './audit/audit-log-entry.entity.js';

export {
  InProcessCacheRegistry,
  inProcessCaches,
  type InProcessCacheLayer,
} from './cache/in-process-cache-registry.js';
export { SharedDropMarks } from './cache/shared-drop-marks.js';

export { hashPassword, verifyPassword } from './crypto/password-hasher.js';
export { enroll, verifyTotp } from './crypto/totp.js';

export { SalesChannel } from './sales-channels/sales-channel.entity.js';
export {
  SalesChannelsCache,
  toCachedChannel,
  SALES_CHANNELS_CACHE_KEY_PREFIX,
  SALES_CHANNELS_CACHE_NAMESPACE,
  SALES_CHANNELS_LRU_TTL_MS,
  type CachedChannel,
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
export {
  registerSalesChannelResolverMiddleware,
  getResolvedChannel,
  currentSalesChannel,
} from './sales-channels/sales-channel-resolver.middleware.js';
export {
  DefaultChannelReconciler,
  type DefaultChannelReconciliationResult,
} from './sales-channels/default-channel-reconciler.js';
export {
  productIdsInRequestChannel,
  outOfRequestChannel,
} from './sales-channels/request-channel-assortment.js';

export {
  Setting,
  SETTING_VALUE_TYPES,
  type SettingValueTypeDb,
} from './settings/setting.entity.js';
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
export {
  SettingsCache,
  type SettingsCacheInvalidation,
  SETTINGS_CACHE_KEY_PREFIX,
  SETTINGS_CACHE_NAMESPACE,
  SETTINGS_LRU_TTL_MS,
} from './settings/settings-cache.js';
export {
  encryptSecretValue,
  decryptSecretValue,
  isSecretEnvelope,
  secretValueIsSet,
  SecretKeyMissing,
  SecretKeyInvalid,
  type SecretEnvelope,
} from './settings/secret-value-codec.js';
export {
  ManifestReconciler,
  type ReconciliationResult,
} from './settings/manifest-reconciler.js';

export { registerPort } from './ports/provide.js';
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
export { lazyPort } from './lazy-port.js';

export {
  PublicApiBaseUrlNotConfiguredError,
  assertPublicApiBaseUrlConfigured,
  configuredPublicApiBaseUrl,
  resolvePublicApiBaseUrl,
} from './public-api-base-url.js';
