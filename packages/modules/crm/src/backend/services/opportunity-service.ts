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
  type OpportunityBoardCardField,
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
import { isDeepStrictEqual } from 'util';
import {
  OpportunityWorkflowConfigError,
  resolveOpportunityStatusName,
  type OpportunityStatusGraph,
} from '../domain/opportunity-status-graph.js';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityLink } from '../entities/crm-opportunity-link.entity.js';
import { CrmOpportunityReference } from '../entities/crm-opportunity-reference.entity.js';
import { CrmOpportunityStatus } from '../entities/crm-opportunity-status.entity.js';
import { CrmOpportunityStatusHistory } from '../entities/crm-opportunity-status-history.entity.js';
import { CrmOpportunityTag } from '../entities/crm-opportunity-tag.entity.js';
import { boardFieldFilterConditions, salesChannelName } from '../domain/board-card-fields.js';
import { effectiveOpportunityValue, effectiveOpportunityValueSql } from '../domain/effective-value.js';
import { tellAfterCommit } from './crm-notifier.js';
import { newlyMentioned, type MentionService, type SavedMentions } from './mention-service.js';
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
  /**
   * What a computed Opportunity is worth now, and the linked documents that
   * figure leaves out; `null` for a manual one.
   */
  liveFigure: (
    opportunity: CrmOpportunity,
  ) => Promise<{ value: string; excludedDocuments: OpportunityExcludedDocument[] } | null>;
  /** The Products, Orders and people a text mentions: stored on write, resolved on read. */
  references: ReferenceService;
  /** Telling the people a saved description newly mentions (User Story 18). */
  mentions: MentionService;
  /** The fields a board card shows (User Story 19) — what `cardValues` and `fieldFilters` refer to. */
  cardFields: () => Promise<OpportunityBoardCardField[]>;
  /**
   * How many Events of an Opportunity have not ended yet (User Story 21). Asked
   * for the detail only — one count for one Opportunity, never per row of a list.
   */
  upcomingEventCount: (opportunityId: string) => Promise<number>;
  /**
   * How many notes, attachments and — for the administrator asking — unread
   * messages an Opportunity has: what the tabs of its screen carry on their
   * labels. Asked for the detail only, after the Opportunity was loaded
   * through the scoped EntityManager.
   */
  childCounts: (opportunityId: string) => Promise<OpportunityChildCounts>;
}

/** The children of one Opportunity, counted — each by the service that owns the rows. */
export interface OpportunityChildCounts {
  noteCount: number;
  attachmentCount: number;
  unreadMessageCount: number;
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

/** What an edit that changed the assignee hands on: the announcement, and whom to tell. */
type ReassignedOpportunity = Parameters<typeof assignedEvent>[0] & { number: string };

const FALLBACK_LANGUAGE = 'en';
/** How many times an edit validates its custom fields again before it answers a conflict. */
const MAX_CUSTOM_FIELD_REVALIDATIONS = 3;
const FALLBACK_COLOR = '#64748b';

function invalid(message: string): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, message);
}

/**
 * The create Command's refusal when its start status has gone by the time it
 * holds it. `details.startStatusGone` is what lets automatic creation tell it
 * from any other conflict and read the workflow again.
 */
function startStatusGone(): HttpError {
  return new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The workflow changed while this was being created.', {
    startStatusGone: true,
  });
}

function isStartStatusGone(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.code === ERROR_CODES.VERSION_CONFLICT &&
    (error.details as { startStatusGone?: unknown } | undefined)?.startStatusGone === true
  );
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
      if (assignedAdminUserId !== null) {
        await assignment.assertAssignable(assignedAdminUserId, input.organizationId);
      }
    }

    const graph = await this.deps.workflowRead.loadGraph();
    const initial = this.#initialStatus(graph);

    // --- Custom fields (US15): a create by hand is always held to the
    // definitions, so a required field is asked for even when none is sent.
    // Validated here, before the Command: the Command reads no other module's
    // port (research N-S1).
    const customFieldValues = await mergeOpportunityCustomFields(
      this.deps.customFields,
      {},
      input.customFieldValues ?? {},
    );

    const created = await this.deps.commandBus.run(
      this.#createCommand({ ...input, assignedAdminUserId, customFieldValues }, initial.code),
    );
    await assignment.notifyAssigned({
      opportunityId: created.id,
      organizationId: input.organizationId,
      number: created.number,
      assignedAdminUserId,
    });
    await this.#tellMentioned({
      opportunityId: created.id,
      organizationId: input.organizationId,
      number: created.number,
      adminUserIds: newlyMentioned(null, input.description),
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
    const salesChannelId =
      input.salesChannelId !== null &&
      (await this.deps.emFactory().count(SalesChannel, { id: input.salesChannelId })) > 0
        ? input.salesChannelId
        : null;

    let created: { id: string; organizationId: string; number: string } | null = null;
    // The create Command refuses when the start status it was handed has gone
    // by the time it holds it (research N-R12). A person retries; nobody is
    // behind a subscriber to do so, and the document would be left without its
    // Opportunity — so the workflow is read again, once, and the Opportunity is
    // created in the start status the workflow has now.
    for (let attempt = 0; created === null; attempt += 1) {
      const initial = this.#initialStatus(await this.deps.workflowRead.loadGraph());
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
        if (attempt === 0 && isStartStatusGone(error)) continue;
        throw error;
      }
    }
    await this.deps.recalculateValue(created.id);
    // By number only, and only to somebody who reaches the Organization — the
    // rule of every assignment (research N-R2). The title of an Opportunity
    // created for a document carries that document's number.
    await this.deps.assignment.notifyAssigned({
      opportunityId: created.id,
      organizationId: created.organizationId,
      number: created.number,
      assignedAdminUserId,
    });
    return { id: created.id, number: created.number };
  }

  /**
   * The create Command. The id is fixed up front so the audit entry and the row
   * agree. `input.customFieldValues` is the bag to store — already validated by
   * the caller, outside the transaction — and absent means none.
   */
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
        // The start status, held until this commits, as a transition holds its
        // target: it cannot be deleted under an Opportunity being created in it
        // (research N-R12). Gone already means the workflow changed meanwhile.
        const start = await em.findOne(
          CrmOpportunityStatus,
          { code: initialStatusCode },
          { lockMode: LockMode.PESSIMISTIC_READ },
        );
        if (!start) throw startStatusGone();
        // Refused before anything is written: a tag that does not exist is 422.
        const tags = await this.deps.tags.resolve(em, input.tagIds ?? []);
        const customFieldValues = input.customFieldValues ?? {};
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

  /**
   * `card` is the board's: the fields its cards show, resolved once for all of
   * its columns. Without it they are read here, and only when the request
   * refers to them — `cardValues=true` or a field filter (User Story 19).
   */
  async list(
    query: OpportunityListQuery,
    card?: readonly OpportunityBoardCardField[],
  ): Promise<{ data: OpportunitySummary[]; pagination: Pagination }> {
    const em = this.deps.emFactory();
    const graph = await this.deps.workflowRead.loadGraph(em);
    const conditions: FilterQuery<CrmOpportunity>[] = [];
    const cardFields =
      card ?? (query.cardValues || query.fieldFilters ? await this.deps.cardFields() : undefined);

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
      // Every tag named must be carried (AND): subqueries that only ever
      // narrow the scoped read below.
      conditions.push(...this.deps.tags.carryingEvery(query.tagId));
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
    if (cardFields) conditions.push(...boardFieldFilterConditions(cardFields, query.fieldFilters));

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
      data: await this.#summaries(page, graph, undefined, query.cardValues ? cardFields : undefined),
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
    if (patch.assignedAdminUserId) {
      await this.deps.assignment.assertAssignable(patch.assignedAdminUserId, visible.organizationId);
    }

    // --- Custom fields (US15) — absent leaves the values as they are. Merged
    // and validated before the Command, against the values read here; the
    // Command uses the result only if the Opportunity still holds those values
    // once it is locked, and otherwise this is done again (research N-S1).
    let validatedAgainst = visible.customFieldValues ?? {};
    let customFieldValues = await mergeOpportunityCustomFields(
      this.deps.customFields,
      validatedAgainst,
      patch.customFieldValues,
    );

    let becameComputed = false;
    const mentioned: { saved: SavedMentions | null } = { saved: null };
    let reassigned: ReassignedOpportunity | null = null;
    for (let attempt = 0; ; attempt += 1) {
      const stale: { current: Record<string, unknown> | null } = { current: null };
      reassigned = await this.#updateCommand(id, patch, ifMatch, {
        customFieldValues,
        validatedAgainst,
        onStale: (bag) => {
          stale.current = bag;
        },
        onBecameComputed: () => {
          becameComputed = true;
        },
        onMentioned: (saved) => {
          mentioned.saved = saved;
        },
      });
      if (stale.current === null) break;
      if (attempt + 1 >= MAX_CUSTOM_FIELD_REVALIDATIONS) {
        throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The opportunity was updated concurrently.');
      }
      validatedAgainst = stale.current;
      customFieldValues = await mergeOpportunityCustomFields(
        this.deps.customFields,
        validatedAgainst,
        patch.customFieldValues,
      );
    }
    if (reassigned) await this.deps.assignment.notifyAssigned(reassigned);
    if (mentioned.saved) await this.#tellMentioned(mentioned.saved);
    // The stored computed figure is not maintained while the mode is manual,
    // so it is brought up to date the moment it becomes the value.
    if (becameComputed) await this.deps.recalculateValue(id);
    return this.get(id);
  }

  /**
   * The edit Command. `custom` carries the custom-field bag the caller merged
   * and validated outside the transaction, and the bag it was validated
   * against: when the locked Opportunity holds another, nothing is written and
   * `onStale` is handed the bag it holds now.
   */
  #updateCommand(
    id: string,
    patch: UpdateOpportunityRequest,
    ifMatch: number | null,
    custom: {
      customFieldValues: Record<string, unknown>;
      validatedAgainst: Record<string, unknown>;
      onStale: (current: Record<string, unknown>) => void;
      onBecameComputed: () => void;
      /** Handed the people the saved description mentions and the one it replaces did not. */
      onMentioned: (saved: SavedMentions) => void;
    },
  ): Promise<ReassignedOpportunity | null> {
    return this.deps.commandBus.run({
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
        if (
          patch.customFieldValues !== undefined &&
          !isDeepStrictEqual(opportunity.customFieldValues ?? {}, custom.validatedAgainst)
        ) {
          custom.onStale({ ...(opportunity.customFieldValues ?? {}) });
          return { result: null, skipAudit: true };
        }
        const before = auditSnapshot(opportunity);
        // Absent means "leave the tags as they are"; present replaces the set.
        const tagChange =
          patch.tagIds === undefined ? null : await this.#replaceTags(em, opportunity.id, patch.tagIds);
        if (patch.title !== undefined) opportunity.title = patch.title;
        if (patch.description !== undefined) {
          // Who this edit adds, against the text it replaces — worked out from
          // the locked row, and told after the commit.
          custom.onMentioned({
            opportunityId: opportunity.id,
            organizationId: opportunity.organizationId,
            number: opportunity.number,
            adminUserIds: newlyMentioned(opportunity.description, patch.description),
          });
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
        if (patch.customFieldValues !== undefined) opportunity.customFieldValues = custom.customFieldValues;
        opportunity.version += 1;
        // An edit that changes the assignee is an assignment too: announced
        // with the previous one, and the new assignee is told.
        const previousAdminUserId = (before.assignedAdminUserId as string | null) ?? null;
        const assignedAdminUserId = opportunity.assignedAdminUserId ?? null;
        if (before.valueMode !== 'computed' && opportunity.valueMode === 'computed') custom.onBecameComputed();
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

  /**
   * Tell the people a committed description newly mentions. A bell that cannot
   * be written costs the save nothing (research N-R12).
   */
  async #tellMentioned(saved: SavedMentions): Promise<void> {
    if (saved.adminUserIds.length === 0) return;
    await tellAfterCommit(saved.opportunityId, async () => {
      await this.deps.mentions.tell(saved);
    });
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
    card?: readonly OpportunityBoardCardField[],
  ): Promise<OpportunitySummary[]> {
    if (rows.length === 0) return [];
    const organizationIds = [...new Set(rows.map((row) => row.organizationId))];
    const assigneeIds = [
      ...new Set(rows.map((row) => row.assignedAdminUserId).filter((id): id is string => Boolean(id))),
    ];
    // Asked once: the status names and a card's Sales Channel are both said in it.
    const viewerLanguage = Promise.resolve(language ?? this.#viewerLanguage());
    const [organizations, assignees, resolvedLanguage, tags, cardValues] = await Promise.all([
      this.deps.organizations.findByIds(organizationIds),
      assigneeIds.length > 0 ? this.deps.adminUsers.findByIds(assigneeIds) : Promise.resolve([]),
      viewerLanguage,
      this.deps.tags.refsFor(
        this.deps.emFactory(),
        rows.map((row) => row.id),
      ),
      card ? this.#cardValues(rows, card, viewerLanguage) : Promise.resolve(null),
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
        ...(cardValues ? { cardValues: cardValues.get(row.id) ?? {} } : {}),
      };
    });
  }

  /**
   * Per Opportunity, the values of the card's fields a summary does not carry
   * as a member of its own (`contracts/admin-api.md` §12c) — and of no other
   * field. **One read per kind of field for all the rows, never one per row**:
   * the contact persons in one port call, the Sales Channels and the link
   * counts in one statement each, and a custom value off the row itself.
   *
   * Every name here is one `crm:read` already shows on the Opportunity's own
   * screen; a linked document is counted, which that screen also says to a
   * reader who may not open it.
   */
  async #cardValues(
    rows: readonly CrmOpportunity[],
    card: readonly OpportunityBoardCardField[],
    viewerLanguage: Promise<string>,
  ): Promise<Map<string, Record<string, unknown>>> {
    const shows = (ref: string): boolean => card.some((field) => field.ref === ref);
    const ids = <T>(values: readonly (T | null | undefined)[]): T[] => [
      ...new Set(values.filter((value): value is T => value !== null && value !== undefined)),
    ];
    const contactIds = shows('builtin:contact') ? ids(rows.map((row) => row.customerAccountId)) : [];
    const channelIds = shows('builtin:salesChannel') ? ids(rows.map((row) => row.salesChannelId)) : [];
    const countsLinks = shows('builtin:linkedOrders') || shows('builtin:linkedQuoteRequests');
    const em = this.deps.emFactory();
    const [language, contacts, channels, links] = await Promise.all([
      viewerLanguage,
      contactIds.length > 0 ? this.deps.customerAccounts.findByIds(contactIds) : Promise.resolve([]),
      channelIds.length > 0 ? em.find(SalesChannel, { id: { $in: channelIds } }) : Promise.resolve([]),
      // The links of the page's own Opportunities, as the tag refs are read:
      // children of rows the scoped read already answered.
      countsLinks
        ? em.find(
            CrmOpportunityLink,
            { opportunityId: { $in: rows.map((row) => row.id) } },
            { fields: ['opportunityId', 'documentKind'] },
          )
        : Promise.resolve([]),
    ]);
    const contactNames = new Map(
      contacts.map((contact) => [
        contact.id,
        `${contact.firstName} ${contact.lastName}`.trim() || contact.email,
      ]),
    );
    // A Sales Channel is named per language; a card says one name, the reader's.
    const channelNames = new Map(channels.map((channel) => [channel.id, salesChannelName(channel, language)]));
    const linkCounts = new Map<string, number>();
    for (const link of links) {
      const key = `${link.opportunityId}:${link.documentKind}`;
      linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
    }

    const values = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const entry: Record<string, unknown> = {};
      for (const field of card) {
        if (field.source === 'custom') {
          entry[field.ref] = (row.customFieldValues ?? {})[field.key] ?? null;
          continue;
        }
        switch (field.key) {
          case 'contact':
            entry[field.ref] = (row.customerAccountId && contactNames.get(row.customerAccountId)) || null;
            break;
          case 'salesChannel':
            entry[field.ref] = (row.salesChannelId && channelNames.get(row.salesChannelId)) || null;
            break;
          case 'source':
            entry[field.ref] = row.source;
            break;
          case 'linkedOrders':
            entry[field.ref] = linkCounts.get(`${row.id}:order`) ?? 0;
            break;
          case 'linkedQuoteRequests':
            entry[field.ref] = linkCounts.get(`${row.id}:quote_request`) ?? 0;
            break;
          default:
          // The summary's own member: not repeated.
        }
      }
      values.set(row.id, entry);
    }
    return values;
  }

  async #detail(opportunity: CrmOpportunity, graph: OpportunityStatusGraph): Promise<OpportunityDetail> {
    const language = await this.#viewerLanguage();
    const [summaries, contact, links, unresolvedPropagations, live, references, upcomingEventCount, childCounts] = await Promise.all([
      this.#summaries([opportunity], graph, language),
      opportunity.customerAccountId
        ? this.deps.customerAccounts.findById(opportunity.customerAccountId)
        : Promise.resolve(null),
      this.deps.links(opportunity.id),
      this.deps.unresolvedPropagations(opportunity.id),
      this.deps.liveFigure(opportunity),
      this.deps.references.resolve(opportunity.description),
      // §12d — what the Events tab's label carries, so the tab strip needs no
      // request of its own. The Opportunity was loaded through the scoped
      // EntityManager before this is asked, as for every other child.
      this.deps.upcomingEventCount(opportunity.id),
      // The other tabs' labels, on the same terms: counted, never listed.
      this.deps.childCounts(opportunity.id),
    ]);
    const summary = summaries[0];
    if (!summary) throw new Error('crm: an opportunity produced no summary.');
    return {
      ...summary,
      // A computed Opportunity shows what its documents add up to as they are
      // read for this screen; the stored figure catches up off the request.
      ...(live ? { value: live.value } : {}),
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
      computedValue: live ? live.value : opportunity.computedValue,
      excludedDocuments: live ? live.excludedDocuments : [],
      source: opportunity.source,
      version: opportunity.version,
      allowedTransitions: graph
        .allowedTargets(opportunity.statusCode)
        .map((code) => this.#statusRef(graph, code, language)),
      links,
      unresolvedPropagations,
      customFieldValues: await this.deps.customFields.project('opportunity', opportunity.customFieldValues ?? {}),
      upcomingEventCount,
      ...childCounts,
    };
  }
}
