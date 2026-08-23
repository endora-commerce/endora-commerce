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

/**
 * Default sink: one structured line on **stderr**. Composition may replace it
 * with one that writes to AuditLogService (FR-013).
 *
 * stderr and not stdout, since feature 072 (T035): the CLI scripts now open
 * their scope through `enterSystemScope`, which reports here, and several of
 * them (`module:install --json` and friends) treat stdout as a machine-readable
 * data channel. An audit line printed there is not a log entry, it is corrupt
 * output. Nothing consumes this on stdout — in the server both streams land in
 * the same log.
 */
let auditSink: EscapeHatchAuditSink = (record) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'info', msg: 'tenant.escape_hatch', ...record })}\n`,
  );
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

/**
 * Emit one escape-hatch audit record without entering a context.
 *
 * The kernel's `enterSystemScope` (feature 072) *starts* an execution that
 * crosses organisations, where `withSystemScope` widens one that already exists.
 * Both are cross-org access and both have to be observable, so the entry point
 * reports through the same sink instead of growing a second, quieter one.
 */
export function recordEscapeHatchAudit(record: EscapeHatchAuditRecord): void {
  requireReason(record.reason);
  auditSink(record);
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
