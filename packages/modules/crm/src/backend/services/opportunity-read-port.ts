import type { EntityManager } from '@mikro-orm/postgresql';
import {
  OPPORTUNITY_READ_PORT_SEARCH_MAX,
  type OpportunityDocumentKind,
  type OpportunityNotePage,
  type OpportunityNoteQuery,
  type OpportunityReadPort,
  type OpportunityRecord,
  type OpportunitySearchQuery,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityLink } from '../entities/crm-opportunity-link.entity.js';
import { effectiveOpportunityValue } from '../domain/effective-value.js';
import { resolveOpportunityStatusName } from '../domain/opportunity-status-graph.js';
import { isUuid } from './opportunity-access.js';
import type { OpportunityCommentService } from './opportunity-comment-service.js';
import type { WorkflowReadService } from './workflow-read-service.js';

/**
 * Reading Opportunities from another module — the shape `crm` publishes as
 * `opportunityReadPort` (`specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §4).
 *
 * **Plain records, never the entity.** A caller in another package gets values
 * it can keep; it cannot hold, mutate or flush a row of this module.
 *
 * **The caller's tenant scope, by construction.** Every Opportunity is read
 * through the scoped EntityManager, so one of an Organization the caller may
 * not see is absent — `null`, or missing from the list — exactly like one that
 * does not exist. A link carries no tenant column of its own, so
 * `findByDocument` reads the link only to learn which Opportunity to ask for,
 * and then asks for that Opportunity through the scoped EntityManager: the
 * parent decides, never the child. `listNotes` is the comment service's, which
 * owns the table and joins every note to its Opportunity for the same reason.
 */
export class OpportunityReadPortService implements OpportunityReadPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly workflowRead: WorkflowReadService,
    /**
     * The comment service, resolved per call: it reaches this class back
     * through the reference service, so a constructor argument would be a
     * cycle in the container.
     */
    private readonly comments: () => Pick<OpportunityCommentService, 'listNotes'>,
  ) {}

  /** The notes of the Opportunities in the caller's tenant scope, a keyset page at a time (issue #1905). */
  listNotes(query: OpportunityNoteQuery): Promise<OpportunityNotePage> {
    return this.comments().listNotes(query);
  }

  async findById(id: string): Promise<OpportunityRecord | null> {
    if (!isUuid(id)) return null;
    const em = this.emFactory();
    const opportunity = await em.findOne(CrmOpportunity, { id });
    if (!opportunity) return null;
    return (await this.#records(em, [opportunity]))[0] ?? null;
  }

  /**
   * The Opportunities of `ids` the caller's tenant scope holds, in no
   * particular order — a missing, out-of-scope or malformed id is simply absent
   * (`specs/165-task-management/` research R-5). Checks no permission: the
   * caller asks `crm:read` itself.
   */
  async findByIds(ids: readonly string[]): Promise<OpportunityRecord[]> {
    const candidates = [...new Set(ids.filter(isUuid))];
    if (candidates.length === 0) return [];
    const em = this.emFactory();
    return this.#records(em, await em.find(CrmOpportunity, { id: { $in: candidates } }));
  }

  /**
   * Opportunities in the caller's tenant scope whose number or title contains
   * `q` (case-insensitively; all of them for an empty `q`), newest first, at
   * most {@link OPPORTUNITY_READ_PORT_SEARCH_MAX} — the `@@` document list's
   * Opportunities (165 R-5). Checks no permission.
   */
  async search(query: OpportunitySearchQuery): Promise<OpportunityRecord[]> {
    const limit = Math.min(Math.max(0, Math.trunc(query.limit)), OPPORTUNITY_READ_PORT_SEARCH_MAX);
    if (limit === 0) return [];
    const needle = (query.q ?? '').trim();
    const like = `%${needle.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const em = this.emFactory();
    const rows = await em.find(
      CrmOpportunity,
      needle === '' ? {} : { $or: [{ number: { $ilike: like } }, { title: { $ilike: like } }] },
      { orderBy: { createdAt: 'desc', number: 'desc' }, limit },
    );
    return this.#records(em, rows);
  }

  async findByDocument(kind: OpportunityDocumentKind, documentId: string): Promise<OpportunityRecord | null> {
    if (!isUuid(documentId)) return null;
    const em = this.emFactory();
    const link = await em.findOne(CrmOpportunityLink, { documentKind: kind, documentId });
    if (!link) return null;
    return this.findById(link.opportunityId);
  }

  async listOpenForOrganization(organizationId: string): Promise<OpportunityRecord[]> {
    if (!isUuid(organizationId)) return [];
    const em = this.emFactory();
    const graph = await this.workflowRead.loadGraph(em);
    const openCodes = graph.statuses.filter((status) => status.kind === 'open').map((status) => status.code);
    if (openCodes.length === 0) return [];
    const rows = await em.find(
      CrmOpportunity,
      { organizationId, statusCode: { $in: openCodes } },
      { orderBy: { createdAt: 'desc', number: 'desc' } },
    );
    return this.#records(em, rows);
  }

  /**
   * A status's name in `language`, by the rule every `crm` screen names one
   * with (issue #455); the code itself for a status the workflow no longer
   * holds.
   */
  async statusName(code: string, language: SupportedLanguage): Promise<string> {
    const status = (await this.workflowRead.loadGraph()).get(code);
    return status ? resolveOpportunityStatusName(status, language) : code;
  }

  async #records(em: EntityManager, rows: readonly CrmOpportunity[]): Promise<OpportunityRecord[]> {
    if (rows.length === 0) return [];
    const graph = await this.workflowRead.loadGraph(em);
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      organizationId: row.organizationId,
      customerAccountId: row.customerAccountId ?? null,
      salesChannelId: row.salesChannelId ?? null,
      statusCode: row.statusCode,
      // A status the workflow no longer holds closes nothing: `open`.
      statusKind: graph.kindOf(row.statusCode) ?? 'open',
      assignedAdminUserId: row.assignedAdminUserId ?? null,
      value: effectiveOpportunityValue(row),
      valueMode: row.valueMode,
      currency: row.currency,
      closedAt: row.closedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
