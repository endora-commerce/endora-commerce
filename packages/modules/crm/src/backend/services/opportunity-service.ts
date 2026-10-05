import { LockMode, QueryOrder, raw, type FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CRM_EVENTS,
  ERROR_CODES,
  type AdminUserReadPort,
  type CreateOpportunityRequest,
  type CustomerAccountReadPort,
  type OpportunityCreatedEvent,
  type OpportunityDetail,
  type OpportunityLink,
  type OpportunityListQuery,
  type OpportunityStatusRef,
  type OpportunitySummary,
  type OrganizationDetailsPort,
  type Pagination,
  type PropagationOutcome,
  type UpdateOpportunityRequest,
} from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { getTenantContext, isOrgInScope } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import {
  OpportunityWorkflowConfigError,
  resolveOpportunityStatusName,
  type OpportunityStatusGraph,
} from '../domain/opportunity-status-graph.js';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityStatusHistory } from '../entities/crm-opportunity-status-history.entity.js';
import { effectiveOpportunityValue, loadOpportunity } from './opportunity-access.js';
import { nextOpportunityNumber } from './opportunity-number.js';
import type { WorkflowReadService } from './workflow-read-service.js';

export interface OpportunityServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  workflowRead: WorkflowReadService;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  organizations: OrganizationDetailsPort;
  customerAccounts: CustomerAccountReadPort;
  adminUsers: AdminUserReadPort;
  /** The Opportunity's linked documents, rendered for the reader. */
  links: (opportunityId: string) => Promise<OpportunityLink[]>;
  /** Refused Order status changes nobody has retried or dismissed yet. */
  unresolvedPropagations: (opportunityId: string) => Promise<PropagationOutcome[]>;
}

const FALLBACK_LANGUAGE = 'en';
const FALLBACK_COLOR = '#64748b';
const VALUE_EXPRESSION = (alias: string) =>
  `case when ${alias}."value_mode" = 'manual' then ${alias}."manual_value" else ${alias}."computed_value" end`;

function invalid(message: string): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, message);
}

/** `12` and `12.5` as the two-place string `numeric(14,2)` reads back as. */
function normalizeAmount(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
}

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
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this list issued.');
}

function auditSnapshot(opportunity: CrmOpportunity): Record<string, unknown> {
  return {
    number: opportunity.number,
    title: opportunity.title,
    description: opportunity.description ?? null,
    organizationId: opportunity.organizationId,
    customerAccountId: opportunity.customerAccountId ?? null,
    salesChannelId: opportunity.salesChannelId ?? null,
    statusCode: opportunity.statusCode,
    assignedAdminUserId: opportunity.assignedAdminUserId ?? null,
    valueMode: opportunity.valueMode,
    manualValue: opportunity.manualValue ?? null,
    currency: opportunity.currency,
    expectedCloseDate: opportunity.expectedCloseDate ?? null,
  };
}

/**
 * Opportunities — create, list, read, edit, delete
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §1).
 *
 * **Tenant scope is ambient.** Every read goes through the scoped
 * EntityManager, so an Opportunity of an Organization the caller may not see
 * is simply absent — from the list, and as 404 everywhere else. Nothing here
 * writes an `organization_id` predicate by hand.
 *
 * **Every write is a Command** (Constitution XIII), recorded against
 * `crm_opportunity` and the Opportunity's id.
 *
 * What other modules own is read through their ports: the Organization, the
 * contact person, the assignee. Tags and the default-assignee rule arrive with
 * their own stories; until then a request naming tags is refused rather than
 * accepted and dropped.
 */
export class OpportunityService {
  constructor(private readonly deps: OpportunityServiceDeps) {}

  async create(input: CreateOpportunityRequest): Promise<OpportunityDetail> {
    const { organizations, customerAccounts, adminUsers } = this.deps;

    // The Organization exists *and* the caller may see it. `organizations` is
    // not tenant-filtered (it is the tenant), so reach is asked separately —
    // and the two answers are one refusal, so an out-of-scope id reads exactly
    // like one that does not exist.
    const organization = isOrgInScope(input.organizationId)
      ? await organizations.findById(input.organizationId)
      : null;
    if (!organization) throw invalid('The organization does not exist.');

    if (input.customerAccountId) {
      const contact = await customerAccounts.findInOrganization(
        input.customerAccountId,
        input.organizationId,
      );
      if (!contact) throw invalid('The contact person does not belong to this organization.');
    }
    if (input.assignedAdminUserId) {
      const assignee = await adminUsers.findById(input.assignedAdminUserId, { activeOnly: true });
      if (!assignee) throw invalid('The assignee is not an administrator of this platform.');
    }
    this.#refuseTags(input.tagIds);

    const graph = await this.deps.workflowRead.loadGraph();
    const initial = this.#initialStatus(graph);

    const created = await this.deps.commandBus.run(this.#createCommand(input, initial.code));
    return this.get(created.id);
  }

  /** The create Command. The id is fixed up front so the audit entry and the row agree. */
  #createCommand(
    input: CreateOpportunityRequest,
    initialStatusCode: string,
  ): Command<{ id: string; organizationId: string; number: string }> {
    const id = randomUUID();
    return {
      action: 'crm.opportunity.create',
      objectType: 'crm_opportunity',
      objectId: id,
      run: async ({ em, actor }) => {
        if (input.salesChannelId && (await em.count(SalesChannel, { id: input.salesChannelId })) === 0) {
          throw invalid('The sales channel does not exist.');
        }
        const opportunity = em.create(CrmOpportunity, {
          id,
          number: await nextOpportunityNumber(em),
          title: input.title,
          description: input.description ?? null,
          organizationId: input.organizationId,
          customerAccountId: input.customerAccountId ?? null,
          salesChannelId: input.salesChannelId ?? null,
          statusCode: initialStatusCode,
          assignedAdminUserId: input.assignedAdminUserId ?? null,
          valueMode: input.valueMode ?? 'manual',
          manualValue: normalizeAmount(input.manualValue),
          currency: input.currency,
          expectedCloseDate: input.expectedCloseDate ?? null,
          source: 'manual',
          createdByAdminUserId: actor.actorAdminUserId,
        });
        // Written now, not at commit: the history row below names this one
        // through a foreign key the unit of work knows nothing about (the
        // column is a plain id, not a relation), so it would not order the two.
        await em.flush();
        // The creation entry: "time in the start status" is measured from it.
        em.create(CrmOpportunityStatusHistory, {
          opportunityId: id,
          fromStatusCode: null,
          toStatusCode: initialStatusCode,
          actorAdminUserId: actor.actorAdminUserId,
          cause: 'created',
        });
        return {
          result: { id, organizationId: opportunity.organizationId, number: opportunity.number },
          before: null,
          after: auditSnapshot(opportunity),
        };
      },
      event: (result) => {
        const payload: OpportunityCreatedEvent = {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          opportunityId: result.id,
          organizationId: result.organizationId,
          number: result.number,
          source: 'manual',
        };
        return { eventName: CRM_EVENTS.CREATED, payload };
      },
    };
  }

  async list(query: OpportunityListQuery): Promise<{ data: OpportunitySummary[]; pagination: Pagination }> {
    // The assignee and tag filters arrive with their own stories. Refused
    // rather than ignored: a filter that is accepted and not applied answers a
    // different question than the one asked, and nothing on the page says so.
    if (query.assignedAdminUserId !== undefined || (query.tagId && query.tagId.length > 0)) {
      throw invalid('Filtering opportunities by assignee or by tag is not available yet.');
    }
    const em = this.deps.emFactory();
    const graph = await this.deps.workflowRead.loadGraph(em);
    const conditions: FilterQuery<CrmOpportunity>[] = [];

    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
      const organizationIds = await this.deps.organizations.searchIdsByName(query.q);
      conditions.push({
        $or: [
          { title: { $ilike: like } },
          { number: { $ilike: like } },
          ...(organizationIds.length > 0 ? [{ organizationId: { $in: organizationIds } }] : []),
        ],
      });
    }
    if (query.statusCode && query.statusCode.length > 0) {
      conditions.push({ statusCode: { $in: query.statusCode } });
    }
    if (query.state) {
      const codes = graph.statuses.filter((status) => status.kind === query.state).map((s) => s.code);
      conditions.push({ statusCode: { $in: codes } });
    }
    if (query.organizationId) conditions.push({ organizationId: query.organizationId });
    if (query.salesChannelId) conditions.push({ salesChannelId: query.salesChannelId });
    if (query.createdFrom) {
      conditions.push({ createdAt: { $gte: new Date(`${query.createdFrom}T00:00:00.000Z`) } });
    }
    if (query.createdTo) {
      // Inclusive of the whole day named.
      const end = new Date(`${query.createdTo}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      conditions.push({ createdAt: { $lt: end } });
    }

    const direction = (query.order ?? 'desc') === 'asc' ? QueryOrder.ASC_NULLS_LAST : QueryOrder.DESC_NULLS_LAST;
    const sort = query.sort ?? 'createdAt';
    const primary =
      sort === 'value' ? { [raw((alias) => VALUE_EXPRESSION(alias))]: direction } : { [sort]: direction };
    const offset = decodeCursor(query.cursor);

    const rows = await em.find(
      CrmOpportunity,
      conditions.length > 0 ? { $and: conditions } : {},
      {
        // The number breaks ties, in the same direction, so a page boundary is stable.
        orderBy: [primary, { number: direction }] as never,
        limit: query.limit + 1,
        offset,
      },
    );
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      data: await this.#summaries(page, graph),
      pagination: {
        cursor: hasMore ? encodeCursor(offset + query.limit) : null,
        hasMore,
        limit: query.limit,
      },
    };
  }

  async get(id: string): Promise<OpportunityDetail> {
    const em = this.deps.emFactory();
    const opportunity = await loadOpportunity(em, id);
    const graph = await this.deps.workflowRead.loadGraph(em);
    return this.#detail(opportunity, graph);
  }

  async update(
    id: string,
    patch: UpdateOpportunityRequest,
    ifMatch: number | null,
  ): Promise<OpportunityDetail> {
    // The parent first: an Opportunity the caller cannot see is a 404 before
    // any of the request's own values is looked at.
    const visible = await loadOpportunity(this.deps.emFactory(), id);
    if (patch.customerAccountId) {
      const contact = await this.deps.customerAccounts.findInOrganization(
        patch.customerAccountId,
        visible.organizationId,
      );
      if (!contact) throw invalid('The contact person does not belong to this organization.');
    }
    if (patch.assignedAdminUserId) {
      const assignee = await this.deps.adminUsers.findById(patch.assignedAdminUserId, { activeOnly: true });
      if (!assignee) throw invalid('The assignee is not an administrator of this platform.');
    }
    this.#refuseTags(patch.tagIds);

    await this.deps.commandBus.run({
      action: 'crm.opportunity.update',
      objectType: 'crm_opportunity',
      objectId: id,
      run: async ({ em }) => {
        // Locked, so two edits carrying the same `If-Match` cannot both pass
        // the version test.
        const opportunity = await loadOpportunity(em, id, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (ifMatch !== null && ifMatch !== opportunity.version) {
          throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The opportunity was updated concurrently.');
        }
        if (patch.salesChannelId && (await em.count(SalesChannel, { id: patch.salesChannelId })) === 0) {
          throw invalid('The sales channel does not exist.');
        }
        const before = auditSnapshot(opportunity);
        if (patch.title !== undefined) opportunity.title = patch.title;
        if (patch.description !== undefined) opportunity.description = patch.description;
        if (patch.customerAccountId !== undefined) opportunity.customerAccountId = patch.customerAccountId;
        if (patch.salesChannelId !== undefined) opportunity.salesChannelId = patch.salesChannelId;
        if (patch.assignedAdminUserId !== undefined) {
          opportunity.assignedAdminUserId = patch.assignedAdminUserId;
        }
        if (patch.valueMode !== undefined) opportunity.valueMode = patch.valueMode;
        if (patch.manualValue !== undefined) opportunity.manualValue = normalizeAmount(patch.manualValue);
        if (patch.expectedCloseDate !== undefined) opportunity.expectedCloseDate = patch.expectedCloseDate;
        opportunity.version += 1;
        return { result: undefined, before, after: auditSnapshot(opportunity) };
      },
    });
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.deps.commandBus.run({
      action: 'crm.opportunity.delete',
      objectType: 'crm_opportunity',
      objectId: id,
      run: async ({ em }) => {
        const opportunity = await loadOpportunity(em, id, { lockMode: LockMode.PESSIMISTIC_WRITE });
        const before = auditSnapshot(opportunity);
        // Links, history, outcomes and the rest go with it — every child table
        // is `on delete cascade`.
        em.remove(opportunity);
        return { result: undefined, before, after: null };
      },
    });
  }

  /**
   * Tags are a later story's. A request naming some is refused, because
   * accepting it and storing nothing would be an edit that silently did not
   * happen.
   */
  #refuseTags(tagIds: readonly string[] | undefined): void {
    if (tagIds && tagIds.length > 0) throw invalid('Tags are not available on opportunities yet.');
  }

  #initialStatus(graph: OpportunityStatusGraph) {
    try {
      return graph.initial();
    } catch (error) {
      if (error instanceof OpportunityWorkflowConfigError) {
        throw new HttpError(422, ERROR_CODES.CRM_WORKFLOW_INVALID, error.message, {
          rule: error.rule,
          code: error.rule,
        });
      }
      throw error;
    }
  }

  /**
   * The language a status label is resolved in: the acting administrator's
   * stored preference — what the admin application renders from — or English.
   */
  async #viewerLanguage(): Promise<string> {
    const actor = getTenantContext()?.actor;
    if (actor?.kind !== 'admin' || !actor.id) return FALLBACK_LANGUAGE;
    const admin = await this.deps.adminUsers.findById(actor.id);
    return admin?.preferredLanguage ?? FALLBACK_LANGUAGE;
  }

  #statusRef(graph: OpportunityStatusGraph, code: string, language: string): OpportunityStatusRef {
    const status = graph.get(code);
    if (!status) return { code, name: code, color: FALLBACK_COLOR, kind: 'open' };
    const base = language.split('-')[0] ?? language;
    return {
      code: status.code,
      name: status.name[language] ?? resolveOpportunityStatusName(status, base),
      color: status.color,
      kind: status.kind,
    };
  }

  async #summaries(
    rows: readonly CrmOpportunity[],
    graph: OpportunityStatusGraph,
    language?: string,
  ): Promise<OpportunitySummary[]> {
    if (rows.length === 0) return [];
    const organizationIds = [...new Set(rows.map((row) => row.organizationId))];
    const assigneeIds = [
      ...new Set(rows.map((row) => row.assignedAdminUserId).filter((id): id is string => Boolean(id))),
    ];
    const [organizations, assignees, resolvedLanguage] = await Promise.all([
      this.deps.organizations.findByIds(organizationIds),
      assigneeIds.length > 0 ? this.deps.adminUsers.findByIds(assigneeIds) : Promise.resolve([]),
      language ?? this.#viewerLanguage(),
    ]);
    const organizationNames = new Map(organizations.map((organization) => [organization.id, organization.name]));
    const assigneeById = new Map(assignees.map((admin) => [admin.id, admin]));

    return rows.map((row) => {
      const assignee = row.assignedAdminUserId ? assigneeById.get(row.assignedAdminUserId) : undefined;
      return {
        id: row.id,
        number: row.number,
        title: row.title,
        organization: { id: row.organizationId, name: organizationNames.get(row.organizationId) ?? '' },
        status: this.#statusRef(graph, row.statusCode, resolvedLanguage),
        assignee: assignee
          ? {
              id: assignee.id,
              name: `${assignee.firstName} ${assignee.lastName}`.trim() || assignee.email,
              active: assignee.status === 'active' && assignee.deletedAt === null,
            }
          : null,
        value: effectiveOpportunityValue(row),
        valueMode: row.valueMode,
        currency: row.currency,
        salesChannelId: row.salesChannelId ?? null,
        expectedCloseDate: row.expectedCloseDate ?? null,
        // Tags arrive with their own story; an Opportunity carries none before it.
        tags: [],
        closedAt: row.closedAt ? row.closedAt.toISOString() : null,
        closedKind: row.closedKind ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async #detail(opportunity: CrmOpportunity, graph: OpportunityStatusGraph): Promise<OpportunityDetail> {
    const language = await this.#viewerLanguage();
    const [summaries, contact, links, unresolvedPropagations] = await Promise.all([
      this.#summaries([opportunity], graph, language),
      opportunity.customerAccountId
        ? this.deps.customerAccounts.findById(opportunity.customerAccountId)
        : Promise.resolve(null),
      this.deps.links(opportunity.id),
      this.deps.unresolvedPropagations(opportunity.id),
    ]);
    const summary = summaries[0];
    if (!summary) throw new Error('crm: an opportunity produced no summary.');
    return {
      ...summary,
      description: opportunity.description ?? null,
      // Reference tokens are resolved by the references story; the text is
      // returned as stored until then.
      references: [],
      customerAccount: contact
        ? {
            id: contact.id,
            name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email,
            email: contact.email,
          }
        : null,
      manualValue: opportunity.manualValue ?? null,
      computedValue: opportunity.computedValue,
      excludedDocuments: [],
      source: opportunity.source,
      version: opportunity.version,
      allowedTransitions: graph
        .allowedTargets(opportunity.statusCode)
        .map((code) => this.#statusRef(graph, code, language)),
      links,
      unresolvedPropagations,
    };
  }
}
