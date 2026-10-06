import {
  LockMode,
  QueryOrder,
  raw,
  UniqueConstraintViolationException,
  type FilterQuery,
} from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CRM_EVENTS,
  ERROR_CODES,
  type AdminUserReadPort,
  type CreateOpportunityRequest,
  type CustomerAccountReadPort,
  type CustomFieldValuePort,
  type OpportunityCreatedEvent,
  type OpportunityDetail,
  type OpportunityDocumentKind,
  type OpportunityExcludedDocument,
  type OpportunityLink,
  type OpportunityListQuery,
  type OpportunitySource,
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
import { CrmOpportunityLink } from '../entities/crm-opportunity-link.entity.js';
import { CrmOpportunityReference } from '../entities/crm-opportunity-reference.entity.js';
import { CrmOpportunityStatusHistory } from '../entities/crm-opportunity-status-history.entity.js';
import { CrmOpportunityTag } from '../entities/crm-opportunity-tag.entity.js';
import { effectiveOpportunityValue, effectiveOpportunityValueSql } from '../domain/effective-value.js';
import { loadOpportunity } from './opportunity-access.js';
import {
  actingAdminUserId,
  assignedEvent,
  isActiveAdministrator,
  type OpportunityAssignmentService,
} from './opportunity-assignment-service.js';
import { nextOpportunityNumber } from './opportunity-number.js';
import { storedReferencesOf, type ReferenceService, type ReferenceSource } from './reference-service.js';
import type { TagService } from './tag-service.js';
import { mergeOpportunityCustomFields } from './opportunity-custom-fields.js';
import type { WorkflowReadService } from './workflow-read-service.js';

export interface OpportunityServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  workflowRead: WorkflowReadService;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  organizations: OrganizationDetailsPort;
  customerAccounts: CustomerAccountReadPort;
  adminUsers: AdminUserReadPort;
  /** The default assignee, who may be one, and telling them. */
  assignment: OpportunityAssignmentService;
  /** The tag list: which tags exist, and which an Opportunity carries. */
  tags: TagService;
  /** The Opportunity's linked documents, rendered for the reader. */
  links: (opportunityId: string) => Promise<OpportunityLink[]>;
  /** Refused Order status changes nobody has retried or dismissed yet. */
  unresolvedPropagations: (opportunityId: string) => Promise<PropagationOutcome[]>;
  /** Operator-defined fields (US15): `custom_fields` validates, this service writes. */
  customFields: CustomFieldValuePort;
  /** Recalculates a computed Opportunity's value — asked when its mode becomes `computed`. */
  recalculateValue: (opportunityId: string) => Promise<unknown>;
  /** The linked documents a computed value leaves out, and why. */
  excludedDocuments: (opportunity: CrmOpportunity) => Promise<OpportunityExcludedDocument[]>;
  /** The Products and Orders a text mentions: stored on write, resolved on read. */
  references: ReferenceService;
}

/** An Opportunity the system creates for a document that was just placed. */
export interface AutomaticOpportunityInput {
  title: string;
  organizationId: string;
  currency: string;
  salesChannelId: string | null;
  source: Exclude<OpportunitySource, 'manual'>;
  /** The document it is created for, linked in the same Command. */
  document: { kind: OpportunityDocumentKind; id: string };
}

/** What the create Command writes beside the request's own fields. */
interface CreateOptions {
  source: OpportunitySource;
  /** A document linked to the Opportunity in the same transaction (`link_source = 'auto'`). */
  document?: { kind: OpportunityDocumentKind; id: string };
}

const FALLBACK_LANGUAGE = 'en';
const FALLBACK_COLOR = '#64748b';

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
    // Only once there is something to say: an Opportunity with no custom
    // values audits exactly as it did before the fields existed.
    ...(Object.keys(opportunity.customFieldValues ?? {}).length > 0
      ? { customFieldValues: { ...opportunity.customFieldValues } }
      : {}),
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
 * contact person, the assignee.
 *
 * **Taggings are written here**, not by the tag service: a tagging is a child
 * of the Opportunity, so it is written under a parent that was loaded through
 * the scoped EntityManager, inside a Command recorded against that parent.
 */
export class OpportunityService {
  constructor(private readonly deps: OpportunityServiceDeps) {}

  async create(input: CreateOpportunityRequest): Promise<OpportunityDetail> {
    const { organizations, customerAccounts, assignment } = this.deps;

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
    // Absent means "apply the default rule"; `null` means "nobody", explicitly.
    const creator = actingAdminUserId();
    let assignedAdminUserId: string | null;
    if (input.assignedAdminUserId === undefined) {
      assignedAdminUserId = await assignment.resolveDefault(input.organizationId, creator);
    } else {
      assignedAdminUserId = input.assignedAdminUserId;
      if (assignedAdminUserId !== null) await assignment.assertAssignable(assignedAdminUserId);
    }

    const graph = await this.deps.workflowRead.loadGraph();
    const initial = this.#initialStatus(graph);

    const created = await this.deps.commandBus.run(
      this.#createCommand(
        // --- Custom fields (US15): a create by hand is always held to the
        // definitions, so a required field is asked for even when none is sent.
        { ...input, assignedAdminUserId, customFieldValues: input.customFieldValues ?? {} },
        initial.code,
      ),
    );
    await assignment.notifyAssigned({
      opportunityId: created.id,
      number: created.number,
      title: input.title,
      assignedAdminUserId,
    });
    return this.get(created.id);
  }

  /**
   * Create an Opportunity for a document that was just placed, **and link the
   * document in the same Command** (research R-8).
   *
   * One transaction is what makes automatic creation idempotent: a document
   * belongs to at most one Opportunity by a unique constraint, so when the
   * same event is handled twice — delivered again, or two handlers racing —
   * the second Command's link is refused and its Opportunity is rolled back
   * with it. That refusal is the answer `already-linked`, not an error; the
   * Command reads no other module's port, so nothing else can be mistaken for
   * it.
   *
   * Runs in the caller's scope — a subscriber's system scope — with the
   * Organization given explicitly. Nobody is the creator, so the default
   * assignee is the Organization's longest-standing active Sales Rep, and they
   * are told. A Sales Channel that no longer exists is left out rather than
   * failing the creation.
   */
  async createForDocument(
    input: AutomaticOpportunityInput,
  ): Promise<{ id: string; number: string } | 'already-linked'> {
    const assignedAdminUserId = await this.deps.assignment.resolveDefault(input.organizationId, null);
    const graph = await this.deps.workflowRead.loadGraph();
    const initial = this.#initialStatus(graph);
    const salesChannelId =
      input.salesChannelId !== null &&
      (await this.deps.emFactory().count(SalesChannel, { id: input.salesChannelId })) > 0
        ? input.salesChannelId
        : null;

    let created: { id: string; organizationId: string; number: string };
    try {
      created = await this.deps.commandBus.run(
        this.#createCommand(
          {
            title: input.title.slice(0, 200),
            organizationId: input.organizationId,
            currency: input.currency,
            salesChannelId,
            assignedAdminUserId,
            valueMode: 'computed',
          },
          initial.code,
          { source: input.source, document: input.document },
        ),
      );
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) return 'already-linked';
      throw error;
    }
    await this.deps.recalculateValue(created.id);
    await this.deps.assignment.notifyAssigned({
      opportunityId: created.id,
      number: created.number,
      title: input.title,
      assignedAdminUserId,
    });
    return { id: created.id, number: created.number };
  }

  /** The create Command. The id is fixed up front so the audit entry and the row agree. */
  #createCommand(
    input: CreateOpportunityRequest,
    initialStatusCode: string,
    options: CreateOptions = { source: 'manual' },
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
        // Refused before anything is written: a tag that does not exist is 422.
        const tags = await this.deps.tags.resolve(em, input.tagIds ?? []);
        // --- Custom fields (US15) — refused before anything is written.
        const customFieldValues = await mergeOpportunityCustomFields(
          this.deps.customFields,
          {},
          input.customFieldValues,
        );
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
          source: options.source,
          createdByAdminUserId: actor.actorAdminUserId,
          customFieldValues,
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
        for (const tag of tags) em.create(CrmOpportunityTag, { opportunityId: id, tagId: tag.id });
        await this.#saveReferences(
          em,
          { opportunityId: id, kind: 'description', sourceId: null },
          opportunity.description,
        );
        if (options.document) {
          em.create(CrmOpportunityLink, {
            opportunityId: id,
            documentKind: options.document.kind,
            documentId: options.document.id,
            syncStatus: true,
            linkSource: 'auto',
            linkedByAdminUserId: null,
          });
        }
        return {
          result: { id, organizationId: opportunity.organizationId, number: opportunity.number },
          before: null,
          after: {
            ...auditSnapshot(opportunity),
            source: options.source,
            ...(tags.length > 0 ? { tags: tags.map((tag) => tag.name) } : {}),
            ...(options.document
              ? { linkedDocument: { documentKind: options.document.kind, documentId: options.document.id } }
              : {}),
          },
        };
      },
      event: (result) => {
        const payload: OpportunityCreatedEvent = {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          opportunityId: result.id,
          organizationId: result.organizationId,
          number: result.number,
          source: options.source,
        };
        return { eventName: CRM_EVENTS.CREATED, payload };
      },
    };
  }

  async list(query: OpportunityListQuery): Promise<{ data: OpportunitySummary[]; pagination: Pagination }> {
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
    if (query.tagId && query.tagId.length > 0) {
      // Every tag named must be carried (AND). The ids come from an unscoped
      // statement and only ever narrow the scoped read below.
      const carrying = await this.deps.tags.opportunityIdsCarryingAll(em, query.tagId);
      if (carrying.length === 0) {
        return { data: [], pagination: { cursor: null, hasMore: false, limit: query.limit } };
      }
      conditions.push({ id: { $in: carrying } });
    }
    if (query.organizationId) conditions.push({ organizationId: query.organizationId });
    if (query.assignedAdminUserId === 'unassigned') {
      conditions.push({ assignedAdminUserId: null });
    } else if (query.assignedAdminUserId === 'me') {
      // "Mine" is whoever asks. With no administrator behind the request there
      // is nobody for an Opportunity to be assigned to, and the answer is none.
      const me = actingAdminUserId();
      if (me === null) return { data: [], pagination: { cursor: null, hasMore: false, limit: query.limit } };
      conditions.push({ assignedAdminUserId: me });
    } else if (query.assignedAdminUserId !== undefined) {
      conditions.push({ assignedAdminUserId: query.assignedAdminUserId });
    }
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
      sort === 'value' ? { [raw((alias) => effectiveOpportunityValueSql(alias))]: direction } : { [sort]: direction };
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

  /**
   * The list's rendering of rows a caller has **already read through the scoped
   * EntityManager** — what lets another read of this module (analytics' most
   * valuable Opportunities) answer the same card the list does, without
   * restating how a status, an assignee or a value is rendered.
   */
  async summarize(rows: readonly CrmOpportunity[]): Promise<OpportunitySummary[]> {
    if (rows.length === 0) return [];
    return this.#summaries(rows, await this.deps.workflowRead.loadGraph(this.deps.emFactory()));
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
    if (patch.assignedAdminUserId) await this.deps.assignment.assertAssignable(patch.assignedAdminUserId);

    let becameComputed = false;
    const reassigned = await this.deps.commandBus.run({
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
        // Absent means "leave the tags as they are"; present replaces the set.
        const tagChange =
          patch.tagIds === undefined ? null : await this.#replaceTags(em, opportunity.id, patch.tagIds);
        if (patch.title !== undefined) opportunity.title = patch.title;
        if (patch.description !== undefined) {
          opportunity.description = patch.description;
          // The references are derived from the text and saved with it.
          await this.#saveReferences(
            em,
            { opportunityId: opportunity.id, kind: 'description', sourceId: null },
            patch.description,
          );
        }
        if (patch.customerAccountId !== undefined) opportunity.customerAccountId = patch.customerAccountId;
        if (patch.salesChannelId !== undefined) opportunity.salesChannelId = patch.salesChannelId;
        if (patch.assignedAdminUserId !== undefined) {
          opportunity.assignedAdminUserId = patch.assignedAdminUserId;
        }
        if (patch.valueMode !== undefined) opportunity.valueMode = patch.valueMode;
        if (patch.manualValue !== undefined) opportunity.manualValue = normalizeAmount(patch.manualValue);
        if (patch.expectedCloseDate !== undefined) opportunity.expectedCloseDate = patch.expectedCloseDate;
        // --- Custom fields (US15) — absent leaves the values as they are.
        opportunity.customFieldValues = await mergeOpportunityCustomFields(
          this.deps.customFields,
          opportunity.customFieldValues,
          patch.customFieldValues,
        );
        opportunity.version += 1;
        // An edit that changes the assignee is an assignment too: announced
        // with the previous one, and the new assignee is told.
        const previousAdminUserId = (before.assignedAdminUserId as string | null) ?? null;
        const assignedAdminUserId = opportunity.assignedAdminUserId ?? null;
        becameComputed = before.valueMode !== 'computed' && opportunity.valueMode === 'computed';
        return {
          result:
            previousAdminUserId === assignedAdminUserId
              ? null
              : {
                  opportunityId: opportunity.id,
                  organizationId: opportunity.organizationId,
                  number: opportunity.number,
                  title: opportunity.title,
                  assignedAdminUserId,
                  previousAdminUserId,
                },
          before: tagChange ? { ...before, tags: tagChange.before } : before,
          after: tagChange
            ? { ...auditSnapshot(opportunity), tags: tagChange.after }
            : auditSnapshot(opportunity),
        };
      },
      event: (result) => (result ? assignedEvent(result) : undefined),
    });
    if (reassigned) await this.deps.assignment.notifyAssigned(reassigned);
    // The stored computed figure is not maintained while the mode is manual,
    // so it is brought up to date the moment it becomes the value.
    if (becameComputed) await this.deps.recalculateValue(id);
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
   * Replace an Opportunity's whole tag set (`PUT …/tags`). One Command against
   * the Opportunity, with the tag names before and after; setting the set it
   * already has writes nothing.
   */
  async setTags(id: string, tagIds: readonly string[]): Promise<OpportunityDetail> {
    // The parent first: an Opportunity the caller cannot see is a 404 before
    // the tags are looked at.
    await loadOpportunity(this.deps.emFactory(), id);
    await this.deps.commandBus.run({
      action: 'crm.opportunity.tag_set',
      objectType: 'crm_opportunity',
      objectId: id,
      run: async ({ em }) => {
        const opportunity = await loadOpportunity(em, id, { lockMode: LockMode.PESSIMISTIC_WRITE });
        const change = await this.#replaceTags(em, opportunity.id, tagIds);
        if (!change.changed) return { result: undefined, skipAudit: true };
        opportunity.version += 1;
        return { result: undefined, before: { tags: change.before }, after: { tags: change.after } };
      },
    });
    return this.get(id);
  }

  /**
   * The write behind every way of setting an Opportunity's tags. **Call it
   * inside a Command, with an Opportunity that was loaded through the scoped
   * EntityManager** — the taggings carry no tenant column of their own.
   */
  async #replaceTags(
    em: EntityManager,
    opportunityId: string,
    tagIds: readonly string[],
  ): Promise<{ changed: boolean; before: string[]; after: string[] }> {
    const wanted = await this.deps.tags.resolve(em, tagIds);
    const current = await em.find(CrmOpportunityTag, { opportunityId });
    const currentTags = await this.deps.tags.resolve(
      em,
      current.map((tagging) => tagging.tagId),
    );
    const wantedIds = new Set(wanted.map((tag) => tag.id));
    const currentIds = new Set(current.map((tagging) => tagging.tagId));
    let changed = false;
    for (const tagging of current) {
      if (wantedIds.has(tagging.tagId)) continue;
      em.remove(tagging);
      changed = true;
    }
    for (const tag of wanted) {
      if (currentIds.has(tag.id)) continue;
      em.create(CrmOpportunityTag, { opportunityId, tagId: tag.id });
      changed = true;
    }
    return {
      changed,
      before: currentTags.map((tag) => tag.name),
      after: wanted.map((tag) => tag.name),
    };
  }

  /**
   * Replace the stored references of one source with those its text carries
   * now. **Call it inside the Command that saves the text, with that
   * Command's EntityManager and an Opportunity that was loaded through the
   * scoped one** — the rows carry no tenant column of their own.
   */
  async #saveReferences(em: EntityManager, source: ReferenceSource, text: string | null | undefined): Promise<void> {
    await em.nativeDelete(CrmOpportunityReference, storedReferencesOf(source));
    for (const row of this.deps.references.rowsFor(source, text)) em.create(CrmOpportunityReference, row);
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
    const [organizations, assignees, resolvedLanguage, tags] = await Promise.all([
      this.deps.organizations.findByIds(organizationIds),
      assigneeIds.length > 0 ? this.deps.adminUsers.findByIds(assigneeIds) : Promise.resolve([]),
      language ?? this.#viewerLanguage(),
      this.deps.tags.refsFor(
        this.deps.emFactory(),
        rows.map((row) => row.id),
      ),
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
              active: isActiveAdministrator(assignee),
            }
          : null,
        value: effectiveOpportunityValue(row),
        valueMode: row.valueMode,
        currency: row.currency,
        salesChannelId: row.salesChannelId ?? null,
        expectedCloseDate: row.expectedCloseDate ?? null,
        tags: tags.get(row.id) ?? [],
        closedAt: row.closedAt ? row.closedAt.toISOString() : null,
        closedKind: row.closedKind ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async #detail(opportunity: CrmOpportunity, graph: OpportunityStatusGraph): Promise<OpportunityDetail> {
    const language = await this.#viewerLanguage();
    const [summaries, contact, links, unresolvedPropagations, excludedDocuments, references] = await Promise.all([
      this.#summaries([opportunity], graph, language),
      opportunity.customerAccountId
        ? this.deps.customerAccounts.findById(opportunity.customerAccountId)
        : Promise.resolve(null),
      this.deps.links(opportunity.id),
      this.deps.unresolvedPropagations(opportunity.id),
      this.deps.excludedDocuments(opportunity),
      this.deps.references.resolve(opportunity.description),
    ]);
    const summary = summaries[0];
    if (!summary) throw new Error('crm: an opportunity produced no summary.');
    return {
      ...summary,
      // The text as stored, and beside it what its tokens name for this reader.
      description: opportunity.description ?? null,
      references,
      customerAccount: contact
        ? {
            id: contact.id,
            name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email,
            email: contact.email,
          }
        : null,
      manualValue: opportunity.manualValue ?? null,
      computedValue: opportunity.computedValue,
      excludedDocuments,
      source: opportunity.source,
      version: opportunity.version,
      allowedTransitions: graph
        .allowedTargets(opportunity.statusCode)
        .map((code) => this.#statusRef(graph, code, language)),
      links,
      unresolvedPropagations,
      customFieldValues: await this.deps.customFields.project('opportunity', opportunity.customFieldValues ?? {}),
    };
  }
}
