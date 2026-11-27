import type { EntityManager } from '@mikro-orm/postgresql';
import {
  OPPORTUNITY_READ_PORT_SEARCH_MAX,
  type EntityExtensionReadOptions,
  type OpportunityDocumentKind,
  type OpportunityNotePage,
  type OpportunityNoteQuery,
  type OpportunityReadPort,
  type OpportunityRecord,
  type OpportunitySearchQuery,
  type SupportedLanguage,
  type WithEntityExtensions,
} from '@endora-commerce/contracts';
import { lazyEntityExtensionReads, type EntityExtensionReads } from '@endora-commerce/platform/kernel';
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
 *
 * **Extensions after scope.** `findById`, `findByDocument`,
 * `listOpenForOrganization`, `findByIds` and `search` take `options.include`
 * (`specs/187-side-table-extensions/` FR-058): the Opportunities the scoped
 * EntityManager returned, and no other, are handed on that EntityManager to
 * the platform's `entityExtensionReads`. Without `include` nothing is resolved.
 */
const HOST = 'crm.CrmOpportunity';

type Extended = WithEntityExtensions<OpportunityRecord>;

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
    /** The kernel's `entityExtensionReads`; absent in a hand-built service, which has no loader to offer. */
    private readonly extensionReads: EntityExtensionReads = lazyEntityExtensionReads(() => undefined),
  ) {}

  /** The notes of the Opportunities in the caller's tenant scope, a keyset page at a time (issue #1905). */
  listNotes(query: OpportunityNoteQuery): Promise<OpportunityNotePage> {
    return this.comments().listNotes(query);
  }

  async findById(id: string, options?: EntityExtensionReadOptions): Promise<Extended | null> {
    if (!isUuid(id)) return null;
    const em = this.emFactory();
    const opportunity = await em.findOne(CrmOpportunity, { id });
    if (!opportunity) return null;
    return (await this.#records(em, [opportunity], options))[0] ?? null;
  }

  /**
   * The Opportunities of `ids` the caller's tenant scope holds, in no
   * particular order — a missing, out-of-scope or malformed id is simply absent
   * (`specs/165-task-management/` research R-5). Checks no permission: the
   * caller asks `crm:read` itself.
   */
  async findByIds(ids: readonly string[], options?: EntityExtensionReadOptions): Promise<Extended[]> {
    const candidates = [...new Set(ids.filter(isUuid))];
    if (candidates.length === 0) return [];
    const em = this.emFactory();
    return this.#records(em, await em.find(CrmOpportunity, { id: { $in: candidates } }), options);
  }

  /**
   * Opportunities in the caller's tenant scope whose number or title contains
   * `q` (case-insensitively; all of them for an empty `q`), newest first, at
   * most {@link OPPORTUNITY_READ_PORT_SEARCH_MAX} — the `@@` document list's
   * Opportunities (165 R-5). Checks no permission.
   */
  async search(query: OpportunitySearchQuery, options?: EntityExtensionReadOptions): Promise<Extended[]> {
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
    return this.#records(em, rows, options);
  }

  async findByDocument(
    kind: OpportunityDocumentKind,
    documentId: string,
    options?: EntityExtensionReadOptions,
  ): Promise<Extended | null> {
    if (!isUuid(documentId)) return null;
    const em = this.emFactory();
    const link = await em.findOne(CrmOpportunityLink, { documentKind: kind, documentId });
    if (!link) return null;
    return this.findById(link.opportunityId, options);
  }

  async listOpenForOrganization(organizationId: string, options?: EntityExtensionReadOptions): Promise<Extended[]> {
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
    return this.#records(em, rows, options);
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

  async #records(
    em: EntityManager,
    rows: readonly CrmOpportunity[],
    options: EntityExtensionReadOptions | undefined,
  ): Promise<Extended[]> {
    if (rows.length === 0) return [];
    const graph = await this.workflowRead.loadGraph(em);
    const records = rows.map((row): OpportunityRecord => ({
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
      // `specs/186-aggregate-ports/` R-8 — on the row already, so no query.
      customFieldValues: { ...(row.customFieldValues ?? {}) },
    }));
    return [...(await this.extensionReads.attach(HOST, records, options, em))];
  }
}
