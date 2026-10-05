import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type OpportunityHistoryEntry,
  type OpportunityHistoryQuery,
  type Pagination,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { loadOpportunity } from './opportunity-access.js';

export interface OpportunityHistoryServiceDeps {
  emFactory: () => EntityManager;
  /** The kernel's audit port — a platform service, read like `audit_logs`' own route reads it. */
  auditLog: Pick<AuditPort, 'query'>;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
}

/** The object type every Command about an Opportunity, or anything hanging on it, is recorded under. */
export const OPPORTUNITY_AUDIT_OBJECT_TYPE = 'crm_opportunity';

/**
 * How far back a history reaches: the audit port answers the newest entries of
 * an object up to this many and takes no offset, so the pages are cut from one
 * capped read.
 */
export const HISTORY_REACH = 500;

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) return parsed.o;
  } catch {
    // Falls through to the refusal below: a cursor is opaque, and one this
    // service did not issue is a malformed request rather than "page one".
  }
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this history issued.');
}

/**
 * The change history of an Opportunity
 * (`specs/143-crm-sales-opportunities/research.md` R-16).
 *
 * **The audit log is the history.** Every write about an Opportunity is a
 * Command recorded against `crm_opportunity` and the Opportunity's id, in the
 * transaction of the write, so this cannot disagree with the data — and it is
 * the whole of it: an edit, a status change (with what caused it, and the
 * Order when an Order did), a link, an assignment, a tag change, a note, a
 * message, an attachment.
 *
 * **Tenant scope comes from the parent.** An audit entry is not any
 * Organization's row, so nothing filters a read of one. The Opportunity is
 * loaded through the scoped EntityManager first — absent or out of scope is the
 * same 404 — and only then are the entries of *that id* read.
 *
 * Served to `crm:read`, not `audit_log:read`: a Sales Rep reads what happened
 * to their Opportunity without being given the platform's whole audit log.
 *
 * The `action` of an entry is the Command's (`crm.opportunity.transition`); the
 * Admin UI labels it with `auditLog.<action>` from this module's bundle.
 */
export class OpportunityHistoryService {
  constructor(private readonly deps: OpportunityHistoryServiceDeps) {}

  async list(
    opportunityId: string,
    query: OpportunityHistoryQuery,
  ): Promise<{ data: OpportunityHistoryEntry[]; pagination: Pagination }> {
    const offset = decodeCursor(query.cursor);
    const opportunity = await loadOpportunity(this.deps.emFactory(), opportunityId);

    // Newest first, from the port. One row more than the page tells whether
    // there is another page; nothing is read beyond the port's own cap.
    const wanted = Math.min(offset + query.limit + 1, HISTORY_REACH);
    const entries = await this.deps.auditLog.query({
      objectType: OPPORTUNITY_AUDIT_OBJECT_TYPE,
      objectId: opportunity.id,
      limit: wanted,
    });
    const page = entries.slice(offset, offset + query.limit);
    const hasMore = entries.length > offset + query.limit;

    const actorIds = [...new Set(page.map((entry) => entry.actorAdminUserId).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length > 0 ? await this.deps.adminUsers.findByIds(actorIds) : [];
    const actorNames = new Map(
      actors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );

    return {
      data: page.map((entry) => {
        const actorId = entry.actorAdminUserId ?? null;
        return {
          id: entry.id,
          actedAt: entry.actedAt.toISOString(),
          action: entry.action,
          // No administrator behind an entry means the system wrote it: a
          // subscriber following an Order, or an automatic creation.
          actor:
            actorId === null
              ? { kind: 'system', id: null, name: null }
              : { kind: 'admin', id: actorId, name: actorNames.get(actorId) ?? null },
          before: entry.stateBefore ?? null,
          after: entry.stateAfter ?? null,
        };
      }),
      pagination: {
        cursor: hasMore ? encodeCursor(offset + query.limit) : null,
        hasMore,
        limit: query.limit,
      },
    };
  }
}
