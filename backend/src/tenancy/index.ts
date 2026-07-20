/**
 * Tenant guard core layer (feature 050 — Systemic Organization Tenant Scoping).
 * Peer of `events/`, `http/`, `db/`. See specs/050-org-tenant-scoping/.
 */
export {
  type TenantContext,
  type TenantScopeMode,
  type TenantActor,
  type TenantImpersonation,
  MissingTenantContextError,
  getTenantContext,
  runWithTenantContext,
  runInTenantContext,
  runWithoutTenantContext,
  enterTenantContext,
} from './tenant-context.js';
export {
  resolveTenantContext,
  systemTenantContext,
  orgPinnedTenantContext,
  type TenantActorInput,
  type CustomerActorInput,
  type AdminActorInput,
  type AdminScopeInput,
} from './resolve-tenant-context.js';
export { forkScopedEm } from './scoped-em.js';
export {
  OrgScoped,
  CustomerScoped,
  GlobalEntity,
  TransitivelyScoped,
  RuleScoped,
  tenantClassifications,
  type ScopeClass,
  type ClassificationMeta,
} from './org-scoped.decorator.js';
export {
  withSystemScope,
  withOrgScope,
  setEscapeHatchAuditSink,
  type EscapeHatchAuditRecord,
  type EscapeHatchAuditSink,
} from './escape-hatch.js';
export {
  orgConstraintFor,
  orgScopeWhere,
  isOrgInScope,
  ruleVisibleForScope,
  type OrgConstraint,
} from './derived-scope.js';
export { ORG_FILTER, CUSTOMER_FILTER } from './filters.js';
