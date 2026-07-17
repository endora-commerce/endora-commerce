import { runWithTenantContext } from './tenant-context.js';
import { systemTenantContext, orgPinnedTenantContext } from './resolve-tenant-context.js';

/**
 * The ONLY sanctioned way to cross organizations (feature 050, FR-005 / FR-013).
 *
 * `withSystemScope` / `withOrgScope` are the single greppable tokens for
 * scope-widening; the CI check forbids any other means (raw `setFilterParams`
 * / `disableFilter` outside this layer). Every call requires a non-empty
 * `reason` and emits one audit record so cross-org access is observable.
 */

export interface EscapeHatchAuditRecord {
  readonly scope: 'system' | 'org';
  readonly reason: string;
  readonly organizationId?: string;
}

export type EscapeHatchAuditSink = (record: EscapeHatchAuditRecord) => void;

// Default sink: structured stderr line. Composition may replace it with one that
// writes to AuditLogService (FR-013).
let auditSink: EscapeHatchAuditSink = (record) => {
  // eslint-disable-next-line no-console -- operational audit line; replaced in composition.
  console.info(JSON.stringify({ level: 'info', msg: 'tenant.escape_hatch', ...record }));
};

/** Wire the escape hatch to a real audit sink (e.g. AuditLogService). */
export function setEscapeHatchAuditSink(sink: EscapeHatchAuditSink): void {
  auditSink = sink;
}

function requireReason(reason: string): void {
  if (!reason || reason.trim().length === 0) {
    throw new Error('withSystemScope/withOrgScope requires a non-empty reason (feature 050, FR-005).');
  }
}

/** Run `fn` crossing ALL organizations (reporting, reconciliation, migrations). */
export function withSystemScope<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  requireReason(reason);
  auditSink({ scope: 'system', reason });
  return runWithTenantContext(systemTenantContext(reason), fn);
}

/** Run `fn` pinned to a single organization (e.g. a per-org background job). */
export function withOrgScope<T>(organizationId: string, reason: string, fn: () => Promise<T>): Promise<T> {
  requireReason(reason);
  auditSink({ scope: 'org', reason, organizationId });
  return runWithTenantContext(orgPinnedTenantContext(organizationId, reason), fn);
}
