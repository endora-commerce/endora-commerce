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
    const entry = this.build(em, input);
    await em.persistAndFlush(entry);
    return entry;
  }

  /**
   * Co-transactional audit writer (feature 054, Constitution Principle XIII).
   *
   * Persists the entry on the CALLER's transactional `em` with NO fork and NO
   * flush — the caller's `em.transactional(...)` commits it atomically with the
   * domain write, so the audit row and the write live or die together (FR-003).
   * Used exclusively by the {@link CommandBus}; regular services keep `record()`.
   */
  recordWithin(em: EntityManager, input: RecordAuditInput): AuditLogEntry {
    const entry = this.build(em, input);
    em.persist(entry);
    return entry;
  }

  private build(em: EntityManager, input: RecordAuditInput): AuditLogEntry {
    return em.create(AuditLogEntry, {
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
  }

  async query(filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
    const em = this.emFactory();
    const where: Record<string, unknown> = {};
    if (filter.actorAdminUserId) where['actorAdminUserId'] = filter.actorAdminUserId;
    if (filter.action) where['action'] = filter.action;
    if (filter.objectType) where['objectType'] = filter.objectType;
    if (filter.objectId) where['objectId'] = filter.objectId;
    if (filter.impersonatedCustomerAccountId) {
      where['impersonatedCustomerAccountId'] = filter.impersonatedCustomerAccountId;
    }
    return em.find(AuditLogEntry, where, {
      orderBy: { actedAt: 'desc' },
      limit: Math.min(Math.max(filter.limit ?? 100, 1), 500),
    });
  }
}

export interface AuditLogFilter {
  actorAdminUserId?: string;
  impersonatedCustomerAccountId?: string;
  action?: string;
  objectType?: string;
  objectId?: string;
  limit?: number;
}
