/**
 * The kernel (feature 072) — composition, the request seam and the four ports.
 * Peer of `events/`, `tenancy/`, `http/`, `db/`; becomes
 * `@endora-commerce/kernel` in F4.
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
  enterPlatformScope,
  enterSystemScope,
  getCurrentPlatformScope,
  openPlatformScopeCount,
  type EnterPlatformScopeOptions,
  type PlatformScope,
} from './scope.js';

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
export {
  SalesChannelResolverService,
  parseHostMap,
  type ResolverError,
} from './sales-channels/sales-channel-resolver.service.js';
export { NoSystemDefaultChannel } from './sales-channels/no-system-default-channel.error.js';
export {
  SalesChannelMembershipService,
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
  Setting,
  SETTING_VALUE_TYPES,
  type SettingValueTypeDb,
} from './settings/setting.entity.js';
export { SettingGroup } from './settings/setting-group.entity.js';
export { SettingValue } from './settings/setting-value.entity.js';
export {
  SettingsService,
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
