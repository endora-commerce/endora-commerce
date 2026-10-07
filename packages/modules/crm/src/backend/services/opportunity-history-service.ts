import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type OpportunityHistoryQuery,
  type OpportunityHistoryResponse,
  type OpportunityReference,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { loadOpportunity } from './opportunity-access.js';
import type { ReferenceService } from './reference-service.js';

export interface OpportunityHistoryServiceDeps {
  emFactory: () => EntityManager;
  /** The kernel's audit port — a platform service, read like `audit_logs`' own route reads it. */
  auditLog: Pick<AuditPort, 'query'>;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
  /** What the tokens of an audited text name, for the reader. */
  references: Pick<ReferenceService, 'resolveMany'>;
}

/** The audited keys that hold a text which may carry reference tokens. */
const TEXT_FIELDS = ['description'] as const;

/** The texts of one audited state — as it was, or as it is. */
function textsOf(state: unknown): string[] {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return [];
  return TEXT_FIELDS.map((field) => (state as Record<string, unknown>)[field]).filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
}

/** The object type every Command about an Opportunity, or anything hanging on it, is recorded under. */
export const OPPORTUNITY_AUDIT_OBJECT_TYPE = 'crm_opportunity';

/** The most the audit port answers in one read (`AuditPort.query`), whatever is asked. */
const AUDIT_QUERY_CAP = 500;

/**
 * How far back a history reaches. The audit port answers the newest entries of
 * an object, capped, and takes no offset, so the pages are cut from one capped
 * read — and the history serves **one entry fewer than the cap**: a read that
 * comes back full then proves there is an earlier entry, and the last page
 * says so (`truncated`) instead of ending as if it were the whole of it.
 */
export const HISTORY_REACH = AUDIT_QUERY_CAP - 1;

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
 * **A text is returned as it was audited, tokens and all**, with what its
 * tokens name beside it — resolved now, for this reader, under the rule every
 * other text of the module is read by (User Story 18; research N-M6). The
 * audit entry itself is never rewritten.
 *
 * **A history that is cut says that it is.** Past `HISTORY_REACH` entries there
 * is no next page; the last page then carries `truncated: true`. `hasMore`
 * keeps its one meaning — a next page exists and `cursor` asks for it.
 *
 * The `action` of an entry is the Command's (`crm.opportunity.transition`); the
 * Admin UI labels it with `auditLog.<action>` from this module's bundle.
 */
export class OpportunityHistoryService {
  constructor(private readonly deps: OpportunityHistoryServiceDeps) {}

  async list(
    opportunityId: string,
    query: OpportunityHistoryQuery,
  ): Promise<OpportunityHistoryResponse> {
    const offset = decodeCursor(query.cursor);
    const opportunity = await loadOpportunity(this.deps.emFactory(), opportunityId);

    // Newest first, from the port. One row more than the page tells whether
    // there is another page; nothing is asked beyond the port's own cap.
    const wanted = Math.min(offset + query.limit + 1, AUDIT_QUERY_CAP);
    const read = await this.deps.auditLog.query({
      objectType: OPPORTUNITY_AUDIT_OBJECT_TYPE,
      objectId: opportunity.id,
      limit: wanted,
    });
    const entries = read.slice(0, HISTORY_REACH);
    const page = entries.slice(offset, offset + query.limit);
    const hasMore = entries.length > offset + query.limit;
    // The row past the reach is never served; that it exists is what is said.
    const truncated = !hasMore && read.length > HISTORY_REACH;

    const actorIds = [...new Set(page.map((entry) => entry.actorAdminUserId).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length > 0 ? await this.deps.adminUsers.findByIds(actorIds) : [];
    const actorNames = new Map(
      actors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );

    // One resolution for the whole page, as a page of comments has.
    const texts = page.map((entry) => [...textsOf(entry.stateBefore), ...textsOf(entry.stateAfter)]);
    const resolved = await this.deps.references.resolveMany(texts.map((list) => list.join('\n')));
    const referencesOf = (index: number): OpportunityReference[] => resolved[index] ?? [];

    return {
      data: page.map((entry, index) => {
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
          references: referencesOf(index),
        };
      }),
      pagination: {
        cursor: hasMore ? encodeCursor(offset + query.limit) : null,
        hasMore,
        limit: query.limit,
      },
      truncated,
    };
  }
}
