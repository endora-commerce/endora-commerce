import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../modules/audit_logs/services/audit-log-service.js';
import { actorFromContext } from './actor.js';
import { getTenantContext } from '../tenancy/index.js';

/** The mutation-shape half of an audit entry (actor is server-derived here). */
export interface AuditFromContextInput {
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly stateBefore?: Record<string, unknown> | null;
  readonly stateAfter?: Record<string, unknown> | null;
}

/**
 * Record a co-transactional audit entry on `em`, deriving the actor from the
 * ambient {@link getTenantContext} (feature 050) — never from a request body.
 *
 * This is the lightweight companion to {@link CommandBus.run}: where a write
 * already runs inside its own `em.persistAndFlush(...)` (and therefore cannot be
 * wrapped in the bus's own transaction without restructuring), a service calls
 * this immediately before its flush so the audit row commits with the write. The
 * actor is best-effort: with no ambient context (e.g. a system/worker path that
 * did not open one) the entry records null actor ids rather than throwing, so a
 * background write still audits. Callers that MUST have an actor use the bus.
 */
export function recordAuditFromContext(
  auditLog: AuditLogService,
  em: EntityManager,
  input: AuditFromContextInput,
): void {
  const ctx = getTenantContext();
  const actor = ctx ? actorFromContext(ctx) : null;
  auditLog.recordWithin(em, {
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId,
    actorAdminUserId: actor?.actorAdminUserId ?? null,
    impersonatedCustomerAccountId: actor?.impersonatedCustomerAccountId ?? null,
    stateBefore: input.stateBefore ?? null,
    stateAfter: input.stateAfter ?? null,
  });
}
