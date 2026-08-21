import type { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogEntry } from './audit-log-entry.entity.js';

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
   *
   * The {@link CommandBus} is its main caller. `CartAuditService` is the other
   * one (issue #152): a sweep lands a batch of audit rows beside the batch of
   * domain rows it is auditing, and one flush over one EntityManager is what
   * makes "the flip and its audit row commit together" true rather than
   * documented. `record()` is still what a service reaches for when it has one
   * row and no unit of work of its own to join.
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

  /**
   * Every entry recorded under one action for a **set** of objects, oldest
   * first (issue #284).
   *
   * `query()` above answers for one object and caps the answer; this one
   * answers for a page. The difference is the whole reason it exists: its
   * caller is a list of orders asking who wrote each one's current status, and
   * `query()` per row is an N+1 across the page — the class of defect MR !822
   * spent a day pinning out of the catalogue listing.
   *
   * Deliberately **uncapped**. A `limit` over a set does not bound the work
   * evenly, it drops whichever objects sort last, and an object whose history
   * was silently truncated reads as an object with no history — a wrong answer
   * rather than a slow one. The population is bounded by the caller instead:
   * it passes the ids on one page.
   */
  async findByObjectIds(input: {
    action: string;
    objectType: string;
    objectIds: readonly string[];
  }): Promise<AuditLogEntry[]> {
    const objectIds = [...new Set(input.objectIds)];
    // No ids is no question, and an `$in: []` is still a round trip.
    if (objectIds.length === 0) return [];
    return this.emFactory().find(
      AuditLogEntry,
      { action: input.action, objectType: input.objectType, objectId: { $in: objectIds } },
      { orderBy: { actedAt: 'asc' } },
    );
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
