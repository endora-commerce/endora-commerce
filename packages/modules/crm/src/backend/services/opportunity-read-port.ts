import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OpportunityDocumentKind,
  OpportunityReadPort,
  OpportunityRecord,
} from '@endora-commerce/contracts';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityLink } from '../entities/crm-opportunity-link.entity.js';
import { effectiveOpportunityValue, isUuid } from './opportunity-access.js';
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
 * parent decides, never the child.
 */
export class OpportunityReadPortService implements OpportunityReadPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly workflowRead: WorkflowReadService,
  ) {}

  async findById(id: string): Promise<OpportunityRecord | null> {
    if (!isUuid(id)) return null;
    const em = this.emFactory();
    const opportunity = await em.findOne(CrmOpportunity, { id });
    if (!opportunity) return null;
    return (await this.#records(em, [opportunity]))[0] ?? null;
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
