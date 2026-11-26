import { raw, type EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  QUOTE_REQUEST_HISTORY_EVENT_WINDOW,
  type AdminCreateQuoteRequest,
  type AdminQuoteRequestListSort,
  type AdminQuoteRequestWarning,
  type AdminPatchQuoteRequest,
  type QuoteRequest as RfqDto,
  type QuoteRequestHistory,
  type QuoteRequestSummary,
  customFieldFilterUnavailable,
  type AdminUserReadPort,
  type CatalogProductAvailabilityPort,
  type CatalogProductReadPort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type CustomFieldFilters,
  type CustomFieldListFilterField,
  type CustomFieldListFilterPort,
  type CustomFieldValuePort,
  organizationCompanyTaxId,
  type OrganizationDetailsPort,
  type RfqCreatedByAdminEventPayload,
  type SalesRepAssignmentPort,
  isUuidShape,
} from '@endora-commerce/contracts';
import type { EventBase } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { recordAuditFromContext, type Command, type CommandBus } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { orgConstraintFor, orgScopeSql, reachesNoOrganization } from '@endora-commerce/platform/tenancy';
import type {
  QuoteRequestAdminSearchQuery,
  QuoteRequestAdminSearchRow,
} from '../admin-search-provider.js';
import {
  makeApproveQuoteRequestCommand,
  makeAssignQuoteRequestCommand,
  makeCancelQuoteRequestCommand,
  makeCreateOnBehalfCommand,
  makeModifyQuoteRequestCommand,
  onBehalfChannelId,
  type QuoteRequestAdminCommandDeps,
  type QuoteRequestOperator,
} from '../commands/quote-request-admin-commands.js';
import { QuoteRequest, type QuoteRequestStatus } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { QuoteRequestNotification } from '../entities/quote-request-notification.entity.js';
import type { AssigneeEligibility } from './assignee-eligibility.js';
import type { NotificationKick } from './notifications/kick.js';
import type { RfqService} from './rfq-service.js';
import { rfqAudience, type RfqEventBus, type RfqEvents } from './rfq-service.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqRevisionService } from './rfq-revision-service.js';
import type { RfqNotificationService } from './rfq-notification-service.js';
import { adminCanSeeOrganization } from './admin-org-visibility.js';
import { listTotal } from './summarize.js';
import { quoteRequestAmount } from './quote-amount.js';
import { channelCurrencies, summaryCurrency } from './line-currency.js';
import { normaliseShareValidityDays } from './operator-quote-sharing.js';
import { makeShareQuoteRequestCommand } from '../commands/share-command.js';
import {
  adminActorDirectory,
  customerActorDirectory,
  predecessorsToRead,
  projectHistory,
  variantLabelDirectory,
  type HistoryEventInput,
  type HistoryRevisionInput,
} from './history/history-projection.js';
import { deliveriesByEvent, type HistoryDeliveryInput } from './history/history-deliveries.js';
import { prepareBasketAuditState } from './quote-request-audit-state.js';

/**
 * Admin-facing Quote Requests service — feature 008 workflow.
 *
 * Endpoints implemented:
 *   - listAll(filter)      (US2; one server-side page since issue #317)
 *   - getById              (US2)
 *   - approve              (US2)
 *   - cancel               (US2)
 *   - assign               (US2)
 *   - modify               (US3)
 *   - createOnBehalf       (US4)
 *
 * Visibility scoping is centralised in `SalesRepAssignmentService.canSeeOrganization`
 * (research §R2), and only a `sales_representative` is narrowed by it (issue
 * #957): every other role — `platform_admin` or a custom role — resolves a
 * platform-wide tenant scope and sees every organization, as on every other
 * surface. The reads apply it through the tenant filter, which for a
 * representative *is* that rule (issue #305); the checks that name an
 * organization directly use `adminCanSeeOrganization`.
 */

/**
 * How many of the most recent events the admin History reads (threat model T9)
 * — the contracts' number, which the admin's truncation notice states too.
 */
export const HISTORY_EVENT_WINDOW = QUOTE_REQUEST_HISTORY_EVENT_WINDOW;

export interface AdminContext {
  adminUserId: string;
  /**
   * The literal `platform_admin` role. It no longer decides what this service
   * lets the actor see — the tenant scope does (issue #957).
   */
  isPlatformAdmin: boolean;
  /** Display label embedded in event records ('Sales representative', 'Platform administrator', …) */
  roleLabel: string;
}

export type AdminAssignmentScope = 'mine' | 'unassigned' | 'all';

export interface AdminListFilter {
  scope?: AdminAssignmentScope;
  status?: QuoteRequestStatus | QuoteRequestStatus[];
  organizationId?: string;
  /** `specs/157-custom-fields-list-filters/` — filters on the list-filter Quote Request custom fields. */
  customFieldFilters?: CustomFieldFilters;
  /** Issue #317 — a fragment of the business id, the organization name or the customer's name, or a whole id. */
  q?: string;
  /**
   * `specs/192-quote-request-draft-share/` (FR-009) — only the quotes the
   * customer cannot see yet, or only those it can; absent = both.
   */
  sharing?: 'unshared' | 'shared';
  /** Issue #317 — default `updatedAt:desc`. */
  sort?: AdminQuoteRequestListSort;
  /** Issue #317 — one-based; default 1. */
  page?: number;
  /** Issue #317 — default 25, at most `ADMIN_QUOTE_REQUEST_LIST_PAGE_SIZE_MAX`. */
  pageSize?: number;
}

/** One page of the admin list and how many requests its filters match (issue #317). */
export interface AdminListPage {
  rows: QuoteRequestSummary[];
  total: number;
}

/**
 * The amount the list shows, as SQL over a quote request row (issue #317): per
 * line the agreed unit price, else the asked one, times the quantity, rounded
 * to two places (`round` on a non-negative numeric is half-up, as
 * `lineAmountHalfUp`), summed; a request without one sorts as zero, as the
 * list did when it sorted in the browser. The lines are this module's table.
 */
function quoteAmountSql(alias: string): string {
  return `coalesce((select sum(round(coalesce("qri"."agreed_unit_price", "qri"."desired_unit_price") * "qri"."quantity", 2))
    from "quote_request_items" "qri" where "qri"."quote_request_id" = ${alias}."id"), 0)`;
}

/** `text` matched literally inside a LIKE pattern: `%`, `_` and `\` are not wildcards. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * The events of the admin paths: the customer path's, and the one only an
 * administrator's create emits. Declared here, beside its one emitter, rather
 * than in the map `rfq-service.ts` shares with the customer path.
 */
export interface RfqAdminEvents extends RfqEvents {
  'rfq.created_by_admin.v1': EventBase & RfqCreatedByAdminEventPayload;
}

export interface RfqAdminServiceDeps {
  emFactory: () => EntityManager;
  events: RfqEventBus;
  rfqService: RfqService;
  eventService: RfqEventService;
  revisionService: RfqRevisionService;
  notificationService: RfqNotificationService;
  /** As `RfqServiceDeps.notificationKick`: after a commit that recorded deliveries. */
  notificationKick?: NotificationKick;
  salesRepAssignment: SalesRepAssignmentPort;
  /**
   * Issue #1824 — the bus the operator's writes run on, as Commands
   * (`commands/quote-request-admin-commands.ts`, Principle XIII), and the
   * share of `specs/192-quote-request-draft-share/` (`quote_request.share`,
   * refusable by another module's hook, research R-4).
   */
  commandBus: Pick<CommandBus, 'run'>;
  /**
   * Feature 054 — audits the one write still hand-audited here,
   * `quote_request.prepare_customer_basket`, co-transactionally when provided.
   */
  auditLog?: AuditPort;
  /**
   * `specs/192-quote-request-draft-share/` (R-12) — the
   * `quote_requests.default_validity_days` setting; absent = `0`, no deadline.
   */
  resolveDefaultValidityDays?: () => Promise<number>;
  /** Feature 055 — validates + merges custom-field values on RFQ edit. */
  customFieldValues?: CustomFieldValuePort;
  /**
   * Feature 157 — `customFieldListFilterPort`: the custom fields the admin list
   * offers as filters, and a request's filters as one condition.
   */
  customFieldListFilter?: CustomFieldListFilterPort;
  /**
   * Feature 075, Phase C — the three rows the admin list and detail read and
   * none of which this module owns. They were `em.find` calls against
   * `catalog`'s, `customer_accounts`' and `organizations`' tables; over their
   * published ports the same reads fail closed with their owners.
   */
  catalogProducts: CatalogProductReadPort;
  /**
   * Feature 163 (FR-018) — `catalog`'s availability answer, asked about an
   * operator's lines only to warn: `createOnBehalf` accepts them either way.
   */
  catalogAvailability: Pick<CatalogProductAvailabilityPort, 'filterAvailable' | 'effectiveTexts'>;
  /**
   * Feature 163 (security review M1) — the kernel's membership port: the channels an
   * Organization is assigned to, which an operator's on-behalf request may be raised on —
   * the channel it names, or the one the admin request resolved when it names none.
   */
  channelMembership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'>;
  customerAccounts: CustomerAccountReadPort;
  organizations: OrganizationDetailsPort;
  adminUsers: AdminUserReadPort;
  /**
   * Issue #1906 — the one assignee rule (`assignee-eligibility.ts`): asked of
   * the target of `quote_request.assign` and of every representative the
   * assignee picker offers.
   */
  assigneeEligibility: AssigneeEligibility;
}

export class RfqAdminService {
  constructor(private readonly deps: RfqAdminServiceDeps) {}

  /** Feature 054 — co-transactional RFQ audit on `em` (actor from context). */
  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action,
        objectType: 'quote_request',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  /** The Quote Request custom fields the admin list offers as filters (feature 157). */
  async customFieldFilterFields(): Promise<CustomFieldListFilterField[]> {
    return (await this.deps.customFieldListFilter?.listFilterable('quote_request')) ?? [];
  }

  private async customFieldCondition(filters: CustomFieldFilters | undefined) {
    if (filters === undefined || Object.keys(filters).length === 0) return null;
    // A list asked to filter on custom fields it cannot read refuses rather
    // than answering unfiltered.
    if (!this.deps.customFieldListFilter) throw customFieldFilterUnavailable(Object.keys(filters));
    return this.deps.customFieldListFilter.condition('quote_request', filters);
  }

  /**
   * Issue #317 — one page of the admin list. Every filter is a condition of
   * the one statement that reads the page and counts the matches: the scopes
   * resolve their organizations once (`organizationId IN` / `NOT IN`), and the
   * search resolves the organization and customer names once each through
   * their owners' ports. Only the page's rows are then enriched.
   *
   * Visibility is the tenant filter's: a sales representative's scope is the
   * `canSeeOrganization` rule, every other role's is every organization
   * (issue #957). Nothing here widens it — each condition only narrows.
   */
  async listAll(ctx: AdminContext, filter: AdminListFilter = {}): Promise<AdminListPage> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 25;
    const em = this.deps.emFactory();
    const where: Record<string, unknown> = {};
    const and: unknown[] = [];
    if (filter.organizationId) where['organizationId'] = filter.organizationId;
    if (filter.status) {
      where['status'] = Array.isArray(filter.status) ? { $in: filter.status } : filter.status;
    }
    if (filter.sharing) where['sharedWithCustomer'] = filter.sharing === 'shared';
    // Feature 157 — one condition, a member of `$and`: it narrows the
    // organization and status conditions above and never replaces them.
    const customFieldCondition = await this.customFieldCondition(filter.customFieldFilters);
    if (customFieldCondition !== null) {
      and.push({
        id: { $in: raw(`(${customFieldCondition.sql})`, [...customFieldCondition.params]) },
      });
    }

    if (filter.scope === 'mine') {
      const assigned = await this.deps.salesRepAssignment.listAssignedOrganizationIds(ctx.adminUserId);
      if (assigned.length === 0) return { rows: [], total: 0 };
      and.push({ organizationId: { $in: assigned } });
    } else if (filter.scope === 'unassigned') {
      // The flat rule `isUnassigned` answered per row: no assignment row.
      const governed = await this.deps.salesRepAssignment.listOrganizationIdsWithAssignments();
      if (governed.length > 0) and.push({ organizationId: { $nin: governed } });
    }

    const q = filter.q?.trim();
    if (q) {
      const like = `%${likeLiteral(q)}%`;
      const [orgIds, customerIds] = await Promise.all([
        this.deps.organizations.searchIdsByName(q),
        this.deps.customerAccounts.searchIdsByName(q),
      ]);
      and.push({
        $or: [
          { businessId: { $ilike: like } },
          // A whole id, exactly: a fragment of a uuid matches almost every row.
          ...(isUuidShape(q) ? [{ id: q }] : []),
          ...(orgIds.length > 0 ? [{ organizationId: { $in: orgIds } }] : []),
          ...(customerIds.length > 0 ? [{ customerAccountId: { $in: customerIds } }] : []),
        ],
      });
    }
    if (and.length > 0) where['$and'] = and;

    const [field, direction] = (filter.sort ?? 'updatedAt:desc').split(':') as ['updatedAt' | 'total', 'asc' | 'desc'];
    const primary =
      field === 'total' ? { [raw((alias) => quoteAmountSql(alias))]: direction } : { updatedAt: direction };
    const [found, total] = await em.findAndCount(QuoteRequest, where, {
      // The id breaks ties, so a page boundary is stable.
      orderBy: [primary, { id: 'asc' }] as never,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const rfqs: QuoteRequest[] = [...found];
    if (rfqs.length === 0) return { rows: [], total };

    const items = await em.find(QuoteRequestItem, {
      quoteRequestId: { $in: rfqs.map((r) => r.id) },
    });
    const itemsByRfq = groupBy(items, (i) => i.quoteRequestId);

    const orgs = await this.deps.organizations.findByIds(rfqs.map((r) => r.organizationId));
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    const customers = await this.deps.customerAccounts.findByIds(
      rfqs.map((r) => r.customerAccountId),
    );
    const customerById = new Map(customers.map((c) => [c.id, c]));

    // Resolve the VAT rate once per distinct Organization (mirrors Orders).
    const taxRateByOrg = new Map<string, number>();
    for (const orgId of new Set(rfqs.map((r) => r.organizationId))) {
      taxRateByOrg.set(orgId, await this.deps.rfqService.taxRateForOrganization(orgId));
    }
    // Issue #303 — a request with no lines speaks its channel's currency.
    const currencyByChannel = await channelCurrencies(
      em,
      rfqs.filter((r) => !itemsByRfq.has(r.id)).map((r) => r.salesChannelId),
    );

    const rows = rfqs.map((rfq): QuoteRequestSummary => {
      const rfqItems = itemsByRfq.get(rfq.id) ?? [];
      const customer = customerById.get(rfq.customerAccountId);
      const org = orgById.get(rfq.organizationId);
      // Exact sums (issue #417), the customer list's helper. The list shows
      // `amount` (issue #456); the two totals stay for API readers.
      const { amount, agreement } = quoteRequestAmount(rfqItems);
      const totalAtAgreedPrice = rfqItems.every((it) => it.agreedUnitPrice != null)
        ? listTotal(rfqItems.map((it) => ({ price: it.agreedUnitPrice ?? '0', quantity: it.quantity })))
        : null;
      const totalAtCustomerPrice = rfqItems.every((it) => it.desiredUnitPrice != null)
        ? listTotal(rfqItems.map((it) => ({ price: it.desiredUnitPrice ?? '0', quantity: it.quantity })))
        : null;
      return {
        id: rfq.id,
        businessId: rfq.businessId,
        organizationId: rfq.organizationId,
        customerAccountId: rfq.customerAccountId,
        status: rfq.status,
        awaitingCustomerRevisionAcceptance: rfq.awaitingCustomerRevisionAcceptance,
        lineCount: rfqItems.length,
        totalAtCustomerPrice,
        totalAtAgreedPrice,
        amount,
        agreement,
        taxRate: taxRateByOrg.get(rfq.organizationId) ?? 0,
        currency: summaryCurrency(rfq, rfqItems, currencyByChannel),
        submittedAt: rfq.submittedAt?.toISOString() ?? null,
        expiresAt: rfq.expiresAt?.toISOString() ?? null,
        createdAt: rfq.createdAt.toISOString(),
        updatedAt: rfq.updatedAt.toISOString(),
        version: rfq.version,
        organizationName: org?.name ?? '',
        customerDisplayName: customer ? customerDisplayName(customer) : null,
        // `specs/192-quote-request-draft-share/` (FR-009) — the list's *Not shared* badge.
        sharedWithCustomer: rfq.sharedWithCustomer,
      };
    });
    return { rows, total };
  }

  /**
   * Global search over quote requests (`specs/150-admin-global-search/`, T032).
   *
   * The list's visibility, **in the statement**: the request's tenant scope
   * (`orgConstraintFor()`), the reach `adminTenantScopePort` derives for this
   * admin. For a sales representative that is the `canSeeOrganization` rule
   * (issue #305); every other role — `platform_admin` or a custom one —
   * reaches every organization (issue #957).
   *
   * Matching, ranking and the `limit + 1` page follow the other providers:
   * literal `likeEscaped` patterns, exact → prefix → rest on the number, then
   * most recent change, then id.
   */
  async searchForAdmin(
    query: QuoteRequestAdminSearchQuery,
  ): Promise<{ rows: QuoteRequestAdminSearchRow[]; hasMore: boolean }> {
    const fields = new Set(query.fields);
    const contains = `%${query.likeEscaped}%`;
    const prefix = `${query.likeEscaped}%`;
    const [orgIds, customerIds] = await Promise.all([
      fields.has('organizationName') ? this.deps.organizations.searchIdsByName(query.text) : [],
      fields.has('customer') ? this.deps.customerAccounts.searchIdsByName(query.text) : [],
    ]);
    // One predicate per selected field, OR-combined; every value is a `?`
    // placeholder, an id set one placeholder per id.
    const matches: Array<{ sql: string; params: readonly unknown[] }> = [];
    if (fields.has('number')) matches.push({ sql: '"business_id" ilike ?', params: [contains] });
    if (orgIds.length > 0) {
      matches.push({ sql: `"organization_id" in (${orgIds.map(() => '?').join(', ')})`, params: orgIds });
    }
    if (customerIds.length > 0) {
      matches.push({
        sql: `"customer_account_id" in (${customerIds.map(() => '?').join(', ')})`,
        params: customerIds,
      });
    }
    if (fields.has('customerNote')) matches.push({ sql: '"header_note" ilike ?', params: [contains] });
    if (query.isUuid) matches.push({ sql: '"id" = ?::uuid', params: [query.text] });
    if (matches.length === 0) return { rows: [], hasMore: false };

    const constraint = orgConstraintFor();
    if (reachesNoOrganization(constraint)) return { rows: [], hasMore: false };
    // The platform's predicate for the reach (issue #305): a sales
    // representative's is every organization nobody else governs.
    const tenantReach = constraint.kind === 'all' ? null : orgScopeSql('organization_id', constraint);

    const em = this.deps.emFactory();
    const exact: string[] = [];
    const bindings: unknown[] = [];
    if (query.isUuid) {
      exact.push('"id" = ?::uuid');
      bindings.push(query.text);
    }
    if (fields.has('number')) {
      exact.push('lower("business_id") = lower(?)');
      bindings.push(query.text);
    }
    let rank = '';
    if (exact.length > 0) {
      const starts = fields.has('number') ? ' when "business_id" ilike ? then 1' : '';
      if (fields.has('number')) bindings.push(prefix);
      rank = `case when ${exact.join(' or ')} then 0${starts} else 2 end, `;
    }
    // The reach first, then the OR of the matches — in the statement.
    const where = [
      ...(tenantReach !== null ? [{ sql: `(${tenantReach.sql})`, params: tenantReach.params }] : []),
      { sql: `(${matches.map((m) => m.sql).join(' or ')})`, params: matches.flatMap((m) => m.params) },
    ];
    const ids = (
      await em.execute<Array<{ id: string }>>(
        `select "id" from "quote_requests" where ${where.map((w) => w.sql).join(' and ')}
          order by ${rank}"updated_at" desc, "id" asc limit ?`,
        [...where.flatMap((w) => w.params), ...bindings, query.limit + 1],
      )
    ).map((r) => r.id);
    const page = ids.slice(0, query.limit);
    if (page.length === 0) return { rows: [], hasMore: false };

    const found = await em.find(QuoteRequest, { id: { $in: page } });
    const byId = new Map(found.map((r) => [r.id, r]));
    const ranked = page.map((id) => byId.get(id)).filter((r): r is QuoteRequest => r !== undefined);
    const orgs = await this.deps.organizations.findByIds([...new Set(ranked.map((r) => r.organizationId))]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    return {
      hasMore: ids.length > query.limit,
      rows: ranked.map((r) => ({
        id: r.id,
        businessId: r.businessId,
        organizationName: orgName.get(r.organizationId) ?? null,
        submittedAt: (r.submittedAt ?? r.createdAt).toISOString(),
        status: r.status,
      })),
    };
  }

  async getById(ctx: AdminContext, rfqId: string): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    const dto = await this.deps.rfqService.serializeFull(
      em,
      rfq,
      /* includeFullActorIdentity */ true,
    );
    // Enrich with Organization + Customer display fields so the admin detail
    // can render them by name (parity with the Order detail view).
    const [org, customer] = await Promise.all([
      this.deps.organizations.findById(rfq.organizationId),
      this.deps.customerAccounts.findById(rfq.customerAccountId),
    ]);
    return {
      ...dto,
      organization: org
        ? {
            id: org.id,
            name: org.name,
            legalName: org.legalName ?? null,
            taxId: organizationCompanyTaxId(org),
            isPersonal: org.isPersonal,
            vatStatus: org.vatStatus,
          }
        : null,
      customer: customer
        ? {
            id: customer.id,
            firstName: customer.firstName ?? null,
            lastName: customer.lastName ?? null,
            email: customer.email,
          }
        : null,
    };
  }

  /**
   * Feature 146 (FR-010 – FR-019; research R8; contract §3) — the admin
   * History: the most recent {@link HISTORY_EVENT_WINDOW} events merged into
   * entries, attributed and diffed on read.
   *
   * Bounded (threat model T9): one read of `window + 1` events, the revisions
   * those events reference, then only the predecessors of the modifications'
   * revisions. One `findByIds` per actor port — customers `activeOnly`, so a
   * deleted account's PII is never read and its entries name an unknown user
   * (FR-018) — and one variant read for the labels.
   *
   * `specs/179-rfq-and-customer-notifications/` WP-06 (FR-070) — plus the
   * notification delivery records of the window's events, one read on
   * `(quote_request_id, source_event_id)`; their recipients join the actor
   * reads, so each side is still one batched read.
   */
  async history(ctx: AdminContext, rfqId: string): Promise<QuoteRequestHistory> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);

    const latest = await this.deps.eventService.listLatestForRfq(rfq.id, HISTORY_EVENT_WINDOW + 1);
    const truncated = latest.length > HISTORY_EVENT_WINDOW;
    const events: HistoryEventInput[] = latest
      .slice(0, HISTORY_EVENT_WINDOW)
      .reverse()
      .map((event) => ({
        id: event.id,
        eventType: event.eventType,
        actorAdminUserId: event.actorAdminUserId ?? null,
        actorCustomerAccountId: event.actorCustomerAccountId ?? null,
        actorRoleLabel: event.actorRoleLabel ?? null,
        payload: event.payload ?? {},
        revisionId: event.revisionId ?? null,
        createdAt: event.createdAt,
      }));

    const referenced = await this.deps.revisionService.findForHistory(rfq.id, {
      ids: events.flatMap((event) => (event.revisionId ? [event.revisionId] : [])),
    });
    const revisions: HistoryRevisionInput[] = referenced.map(toHistoryRevision);
    revisions.push(
      ...(await this.deps.revisionService.findForHistory(rfq.id, predecessorsToRead(events, revisions))).map(
        toHistoryRevision,
      ),
    );

    const deliveries = await this.#historyDeliveries(em, rfq.id, events.map((event) => event.id));

    const adminIds = unique([
      ...events.map((event) => event.actorAdminUserId),
      ...deliveries.filter((d) => d.recipientKind === 'admin').map((d) => d.recipientId),
    ]);
    const customerIds = unique([
      ...events.filter((event) => !event.actorAdminUserId).map((event) => event.actorCustomerAccountId),
      ...deliveries.filter((d) => d.recipientKind === 'customer').map((d) => d.recipientId),
    ]);
    const productIds = unique(
      revisions.flatMap((revision) =>
        revision.itemsSnapshot.filter((line) => line.variantId).map((line) => line.productId),
      ),
    );
    const [admins, customers, variants] = await Promise.all([
      adminIds.length > 0 ? this.deps.adminUsers.findByIds(adminIds) : [],
      customerIds.length > 0 ? this.deps.customerAccounts.findByIds(customerIds, { activeOnly: true }) : [],
      productIds.length > 0 ? this.deps.catalogProducts.listVariantsByProductIds(productIds) : [],
    ]);

    const adminDirectory = adminActorDirectory(admins);
    const customerDirectory = customerActorDirectory(customers);
    return {
      entries: projectHistory(
        events,
        revisions,
        {
          admins: adminDirectory,
          customers: customerDirectory,
          variantLabels: variantLabelDirectory(variants),
        },
        deliveriesByEvent(deliveries, { admins: adminDirectory, customers: customerDirectory }),
      ),
      truncated,
    };
  }

  /** The delivery records announcing any of `eventIds` — the History's window, never more. */
  async #historyDeliveries(em: EntityManager, rfqId: string, eventIds: string[]): Promise<HistoryDeliveryInput[]> {
    if (eventIds.length === 0) return [];
    const records = await em.find(QuoteRequestNotification, { quoteRequestId: rfqId, sourceEventId: { $in: eventIds } });
    return records.map((record) => ({
      id: record.id,
      sourceEventId: record.sourceEventId,
      recipientKind: record.recipientKind,
      recipientId: record.recipientId,
      channel: record.channel,
      status: record.status,
      attempts: record.attempts,
      lastError: record.lastError ?? null,
      closedAt: record.closedAt ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  // The operator's writes — Commands (issue #1824)
  // -------------------------------------------------------------------------

  /**
   * What the operator's Commands (`commands/quote-request-admin-commands.ts`)
   * read and write through. `quoteRequestCommandPort` builds its Commands from
   * the same factories over the same dependencies, so the route and the port
   * cannot write differently.
   */
  get commandDeps(): QuoteRequestAdminCommandDeps {
    return this.deps;
  }

  /**
   * Run one of the operator's Commands on the Command Bus — its one audit
   * entry, its history and notification records and its event commit
   * together — and then, for a write that recorded notifications, wake their
   * delivery: after the commit, never before it. The admin routes and
   * `quoteRequestCommandPort` both write through here.
   */
  async runWrite<T>(command: Command<T>, { notifies }: { notifies: boolean }): Promise<T> {
    const result = await this.deps.commandBus.run(command);
    if (notifies) this.kickNotificationDelivery();
    return result;
  }

  /** The admin request's administrator, as the history names the writer. */
  static operatorOf(ctx: AdminContext): QuoteRequestOperator {
    return { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel };
  }

  // -------------------------------------------------------------------------
  // Approve (US2)
  // -------------------------------------------------------------------------

  async approve(
    ctx: AdminContext,
    rfqId: string,
    expectedVersion: number | null,
    note: string | undefined,
  ): Promise<RfqDto> {
    const rfq = await this.runWrite(
      makeApproveQuoteRequestCommand(this.deps, {
        quoteRequestId: rfqId,
        operator: RfqAdminService.operatorOf(ctx),
        expectedVersion,
        note,
      }),
      { notifies: true },
    );
    return this.deps.rfqService.serializeFull(this.deps.emFactory(), rfq, true);
  }

  // -------------------------------------------------------------------------
  // Prepare the customer's basket (issue #170)
  // -------------------------------------------------------------------------

  /**
   * Put an approved request's lines into the basket of the **customer who owns
   * it**, at the agreed prices, for that customer to check out.
   *
   * The admin screen's order action used to post to the storefront's
   * `convert-to-order`, which is `requireCustomer`-guarded: an administrator's
   * session answered `401`, which the Admin UI reads as an expired session.
   * Had it been accepted it would have seeded the *caller's* basket. This is
   * the operator's version of the same conversion — the same rules, through
   * `RfqService.seedBasketFromApproved` — aimed at the request's customer, for
   * a request this administrator may see. Like the customer's conversion it
   * replaces what that customer's basket held.
   *
   * A customer holds one basket per sales channel
   * (`specs/154-sales-channel-access/`). The one seeded is the basket of the
   * channel the quote was raised on — the store the customer agreed it in, and
   * the one channel a conversion can honestly be judged against (see
   * `seedBasketFromApproved`). A request that records no channel (raised before
   * requests did) falls back to `fallbackChannelId`, the channel the admin
   * request resolved to — the system default.
   */
  async prepareCustomerBasket(
    ctx: AdminContext,
    rfqId: string,
    fallbackChannelId: string,
  ): Promise<{ cartId: string; customerAccountId: string; itemCount: number }> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    const owner = {
      customerAccountId: rfq.customerAccountId,
      organizationId: rfq.organizationId,
      salesChannelId: rfq.salesChannelId ?? fallbackChannelId,
    };
    const seeded = await this.deps.rfqService.seedBasketFromApproved(em, rfq, owner);
    this.#audit(
      em,
      'quote_request.prepare_customer_basket',
      rfq.id,
      null,
      prepareBasketAuditState({ cartId: seeded.cartId, customerAccountId: owner.customerAccountId, itemCount: seeded.itemCount }),
    );
    await em.flush();
    return { cartId: seeded.cartId, customerAccountId: owner.customerAccountId, itemCount: seeded.itemCount };
  }

  // -------------------------------------------------------------------------
  // Cancel (US2)
  // -------------------------------------------------------------------------

  async cancel(
    ctx: AdminContext,
    rfqId: string,
    expectedVersion: number | null,
    reason: string | undefined,
  ): Promise<RfqDto> {
    const rfq = await this.runWrite(
      makeCancelQuoteRequestCommand(this.deps, {
        quoteRequestId: rfqId,
        operator: RfqAdminService.operatorOf(ctx),
        expectedVersion,
        reason,
      }),
      { notifies: true },
    );
    return this.deps.rfqService.serializeFull(this.deps.emFactory(), rfq, true);
  }

  /** `quote_requests.default_validity_days`; `0` when no reader is composed. */
  private async defaultValidityDays(): Promise<number> {
    return (await this.deps.resolveDefaultValidityDays?.()) ?? 0;
  }

  /**
   * `GET /api/v1/admin/quote-requests/create-defaults`
   * (`specs/192-quote-request-draft-share/`, contracts/admin-api.md §2) — what
   * the create screen pre-fills: the default validity in days, `null` for none.
   */
  async createDefaults(): Promise<{ validityDays: number | null }> {
    return { validityDays: normaliseShareValidityDays(await this.defaultValidityDays()) };
  }

  // -------------------------------------------------------------------------
  // Share with the customer (`specs/192-quote-request-draft-share/`)
  // -------------------------------------------------------------------------

  /**
   * Share an unshared operator quote with its customer: the Command
   * `quote_request.share` (research R-4) — its refusals, its write and every
   * present `beforeCommit` hook in one transaction. Delivery of the `prepared`
   * records is kicked once the Command committed, never before.
   */
  async share(ctx: AdminContext, rfqId: string, expectedVersion: number | null): Promise<RfqDto> {
    await this.runWrite(
      makeShareQuoteRequestCommand(
        { quoteRequestId: rfqId, expectedVersion, roleLabel: ctx.roleLabel },
        {
          salesRepScope: this.deps.salesRepAssignment,
          customerAccounts: this.deps.customerAccounts,
          eventService: this.deps.eventService,
          notificationService: this.deps.notificationService,
          revisionService: this.deps.revisionService,
        },
      ),
      { notifies: true },
    );
    const em = this.deps.emFactory();
    return this.deps.rfqService.serializeFull(em, await this.findVisibleForAdmin(em, ctx, rfqId), true);
  }

  // -------------------------------------------------------------------------
  // Internal-side claim (informational; visibility is per-org, not per-rfq)
  // -------------------------------------------------------------------------

  async assign(ctx: AdminContext, rfqId: string, targetAdminUserId: string): Promise<RfqDto> {
    const rfq = await this.runWrite(
      makeAssignQuoteRequestCommand(this.deps, {
        quoteRequestId: rfqId,
        operator: RfqAdminService.operatorOf(ctx),
        // The route reads no `If-Match` here, as before.
        expectedVersion: null,
        adminUserId: targetAdminUserId,
      }),
      { notifies: false },
    );
    return this.deps.rfqService.serializeFull(this.deps.emFactory(), rfq, true);
  }

  // -------------------------------------------------------------------------
  // Modify (US3) — also handles edits to Created from admin (US4)
  // -------------------------------------------------------------------------

  async modify(
    ctx: AdminContext,
    rfqId: string,
    expectedVersion: number | null,
    body: AdminPatchQuoteRequest,
  ): Promise<RfqDto> {
    const rfq = await this.runWrite(
      makeModifyQuoteRequestCommand(this.deps, {
        quoteRequestId: rfqId,
        operator: RfqAdminService.operatorOf(ctx),
        expectedVersion,
        body,
      }),
      { notifies: true },
    );
    return this.deps.rfqService.serializeFull(this.deps.emFactory(), rfq, true);
  }

  // -------------------------------------------------------------------------
  // Create on behalf (US4)
  // -------------------------------------------------------------------------

  /**
   * Feature 163 (FR-018) — the lines of an operator-created request whose
   * product is not available to the Organization at the request's channel, in
   * the channel's default language (N2), now. Accepted regardless: this is a
   * warning for the operator, never a refusal (the exemption of
   * `quote_request.create_on_behalf` stands). The channel is
   * {@link onBehalfChannelId}'s, the one the create checked and stored; a
   * request with no channel was refused there, so the `[]` below only answers
   * a direct caller (FR-007).
   */
  async onBehalfWarnings(
    body: Pick<AdminCreateQuoteRequest, 'organizationId' | 'items' | 'salesChannelId'>,
  ): Promise<AdminQuoteRequestWarning[]> {
    const channelId = onBehalfChannelId(body);
    if (channelId === null) return [];
    const productIds = Array.from(new Set(body.items.map((it) => it.productId)));
    if (productIds.length === 0) return [];
    const available = await this.deps.catalogAvailability.filterAvailable(productIds, {
      channelId,
      languageCode: null,
      // The customer the operator names: the request's own actor is the operator.
      audience: rfqAudience({ organizationId: body.organizationId }),
    });
    return productIds
      .filter((productId) => !available.has(productId))
      .map((productId) => ({ productId, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' as const }));
  }

  async createOnBehalf(
    ctx: AdminContext,
    body: AdminCreateQuoteRequest,
  ): Promise<RfqDto> {
    // `specs/192-quote-request-draft-share/` (FR-005) — the new quote is
    // unshared and records nothing for its customer, so nothing is kicked;
    // `share` kicks the `prepared` delivery.
    const rfq = await this.runWrite(
      makeCreateOnBehalfCommand(this.deps, { operator: RfqAdminService.operatorOf(ctx), body }),
      { notifies: false },
    );
    return this.deps.rfqService.serializeFull(this.deps.emFactory(), rfq, true);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** After a commit that recorded deliveries, never before it. */
  private kickNotificationDelivery(): void {
    this.deps.notificationKick?.();
  }

  private async findVisibleForAdmin(
    em: EntityManager,
    ctx: AdminContext,
    rfqId: string,
  ): Promise<QuoteRequest> {
    // Threat model C1 (Constitution XI) — a request outside the caller's
    // organizations answers exactly as an unknown id does, so its existence
    // does not leak.
    const notFound = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Quote Request not found.');
    if (!isUuidShape(rfqId)) throw notFound();
    const rfq = await em.findOne(QuoteRequest, { id: rfqId });
    if (!rfq) throw notFound();
    if (!(await adminCanSeeOrganization(this.deps.salesRepAssignment, ctx.adminUserId, rfq.organizationId))) {
      throw notFound();
    }
    return rfq;
  }
}

function toHistoryRevision(revision: {
  id: string;
  revisionNumber: number;
  previousRevisionId?: string | null;
  headerNoteSnapshot?: string | null;
  itemsSnapshot: HistoryRevisionInput['itemsSnapshot'];
}): HistoryRevisionInput {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    previousRevisionId: revision.previousRevisionId ?? null,
    headerNoteSnapshot: revision.headerNoteSnapshot ?? null,
    itemsSnapshot: Array.isArray(revision.itemsSnapshot) ? revision.itemsSnapshot : [],
  };
}

function unique(values: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function customerDisplayName(c: CustomerAccountRecord): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email;
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const v of arr) {
    const k = key(v);
    const existing = out.get(k);
    if (existing) existing.push(v);
    else out.set(k, [v]);
  }
  return out;
}
