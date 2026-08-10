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
  type ModuleContext,
  type ModuleContextOptions,
  type ModuleLifecycleLogger,
  type ModuleRegistrationSink,
  type Registration,
  type RegistrationBuilder,
} from './module-context.js';

export {
  enterPlatformScope,
  type EnterPlatformScopeOptions,
  type PlatformScope,
} from './scope.js';

export {
  AuditLogService,
  type RecordAuditInput,
} from './audit/audit-log-service.js';
export { AuditLogEntry } from './audit/audit-log-entry.entity.js';

export {
  type AdminPermissionChecker,
  type RequireAdminAnyFactory,
  type RequireAdminFactory,
} from './ports/require-admin.js';
export { type OrganizationReadPort } from './ports/organizations.js';
export { type SettingsReadPort, type SettingsReadResult } from './ports/settings.js';
export {
  type ResolvedChannel,
  type SalesChannelMembershipPort,
  type SalesChannelResolutionPort,
} from './ports/sales-channel.js';
