import type { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogEntry } from '../entities/audit-log-entry.entity.js';

/**
 * Append-only audit log writer. Every sensitive operation (FR-084) calls `record()`
 * — price changes, permission changes, credit-limit adjustments, order-status changes
 * performed during Impersonation, etc.
 *
 * This service is deliberately narrow: it only appends rows. Queries are the concern
 * of the admin-panel audit viewer (US4 / T195).
 */

export interface RecordAuditInput {
  actorAdminUserId?: string | null;
  impersonatedCustomerAccountId?: string | null;
  action: string;
  objectType: string;
  objectId: string;
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export class AuditLogService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async record(input: RecordAuditInput): Promise<AuditLogEntry> {
    const em = this.emFactory();
    const entry = em.create(AuditLogEntry, {
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      ...(input.actorAdminUserId !== undefined ? { actorAdminUserId: input.actorAdminUserId } : {}),
      ...(input.impersonatedCustomerAccountId !== undefined
        ? { impersonatedCustomerAccountId: input.impersonatedCustomerAccountId }
        : {}),
      ...(input.stateBefore !== undefined ? { stateBefore: input.stateBefore } : {}),
      ...(input.stateAfter !== undefined ? { stateAfter: input.stateAfter } : {}),
      ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });
    await em.persistAndFlush(entry);
    return entry;
  }
}
