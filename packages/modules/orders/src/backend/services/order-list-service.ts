import { raw, type EntityManager, type FilterQuery, type Knex } from '@mikro-orm/postgresql';
import {
  customFieldFilterUnavailable,
  type CustomerAccountReadPort,
  type CustomFieldFilters,
  type CustomFieldListFilterCondition,
  type CustomFieldListFilterPort,
  type OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import {
  orgConstraintFor,
  orgScopeSql,
  orgScopeWhere,
  reachesNoOrganization,
  type OrgConstraint,
  type OrgScopeSql,
} from '@endora-commerce/platform/tenancy';
import { Order } from '../entities/order.entity.js';
import { OrderExternalReference } from '../entities/order-external-reference.entity.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { OrderStatusGraphService } from './order-status-graph-service.js';
import type { OrderAdminSearchQuery, OrderAdminSearchRow } from '../admin-search-provider.js';

export interface OrderListQuery {
  status?: string[] | undefined;
  /**
   * Feature 085 (FR-021) — the money axis. The list had eight filters and none
   * of them was this one, so an operator could not ask which orders carry a
   * failed payment; after this feature they are the only actor who can rescue
   * one.
   */
  paymentStatus?: string[] | undefined;
  salesChannelId?: string[] | undefined;
  paymentMethodId?: string[] | undefined;
  deliveryMethodId?: string[] | undefined;
  organizationId?: string | undefined;
  /**
   * Feature 040 — restrict to a single Customer's own orders. Used by the
   * customer self-service history and the admin customer-detail orders panel.
   * Aggregates across sales channels when `salesChannelId` is omitted.
   */
  placedByCustomerAccountId?: string | undefined;
  q?: string | undefined;
  /** Dedicated org / customer name filters, AND-combined with the global `q`. */
  orgName?: string | undefined;
  customerName?: string | undefined;
  placedFrom?: string | undefined;
  placedTo?: string | undefined;
  totalMin?: number | undefined;
  totalMax?: number | undefined;
  /**
   * Filters on the Order custom fields marked as list filters
   * (`specs/157-custom-fields-list-filters/`), turned into one condition by
   * `custom_fields`' `customFieldListFilterPort`.
   */
  customFieldFilters?: CustomFieldFilters | undefined;
  sort?: string | undefined;
  page: number;
  pageSize: number;
}

/**
 * The organizations an admin order list is confined to, as the platform states
 * the reach (issue #305) — a sales representative's is every organization
 * nobody else governs, which no list of allowed ids can express. Built by
 * {@link orderListScopeFor}; absent ⇒ every organization.
 */
export interface OrderListScope {
  /** On `organizationId`, for the entity manager. */
  readonly where: Record<string, unknown>;
  /** On the `organization_id` column, for SQL. */
  readonly sql: OrgScopeSql;
  /** Nothing is reached: no statement need run. */
  readonly empty: boolean;
}

/**
 * The list scope a constraint implies, or `undefined` for every organization.
 *
 * With **no argument** — the ambient constraint — `where` is `{}`: `Order` is
 * `@OrgScoped`, so the global filter already applies exactly this predicate to
 * every statement the list issues through the entity manager, and spelling it
 * a second time made each of them carry the reach twice (issue #955, architect
 * ruling Q3: the orders list for a sales representative ran four statements,
 * each with the excluded set twice). `sql` stays, for `searchForAdmin`, which
 * reads through knex where no global filter applies; `empty` stays, for the
 * short-circuit.
 *
 * With an **explicit** constraint — `orderListPort`'s caller-authorised
 * allowed set, narrower than the ambient scope — `where` carries it.
 */
export function orderListScopeFor(constraint?: OrgConstraint): OrderListScope | undefined {
  const effective = constraint ?? orgConstraintFor();
  if (effective.kind === 'all') return undefined;
  return {
    where: constraint === undefined ? {} : orgScopeWhere('organizationId', effective),
    sql: orgScopeSql('organization_id', effective),
    empty: reachesNoOrganization(effective),
  };
}

export interface AdminOrderRow {
  id: string;
  businessId: string;
  customerName: string | null;
  organizationId: string;
  organizationName: string | null;
  status: string;
  statusName: Record<string, string>;
  paymentStatus: string;
  total: number;
  currency: string;
  placedAt: string;
  createdAt: string;
  salesChannelId: string;
  salesChannelName: string | null;
  deliveryMethodName: string | null;
  paymentMethodName: string | null;
  shipToName: string | null;
  billToName: string | null;
}

export interface OrderListResult {
  rows: AdminOrderRow[];
  total: number;
  /** Per lifecycle status, over every applied filter except the status one. */
  counts: Record<string, number>;
  /**
   * Per payment status, over every applied filter except the payment-status one
   * (feature 085).
   *
   * A second map rather than more keys in `counts`: `paid` is a shipped order
   * status code **and** a payment status, so one map would add two different
   * populations together under a single key.
   */
  paymentStatusCounts: Record<string, number>;
}

const SORTABLE = new Set(['placedAt', 'businessId', 'total', 'status']);

/**
 * OrderListService — feature 038 (US2, T037).
 *
 * Server-side filter / sort / search / pagination for the admin orders list,
 * plus per-status counts. Search `q` matches the business Order ID, the
 * Organization name, the customer (email / first / last name) and an external
 * system's reference for the order (issue #1030).
 */
export class OrderListService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly graphService: OrderStatusGraphService,
    /**
     * The two name searches behind the list's `q`, `orgName` and `customerName`
     * filters, and the row-level name lookups behind its `organizationName` and
     * `customerName` columns (feature 075).
     *
     * The organisation half used to be `em.find(Organization, { nameSearch:
     * { $like: normalizeOrganizationName(q) } })` — this module reaching into a
     * derived column another module maintains and re-implementing its folding
     * rule. `searchIdsByName` is that question, published by its owner, and the
     * folding stays where the column is written.
     */
    private readonly organizationDetails: OrganizationDetailsPort,
    private readonly customerAccountRead: CustomerAccountReadPort,
    /**
     * `customFieldListFilterPort` — the custom-field filters as one condition
     * (feature 157). Absent where the list is never asked to filter on custom
     * fields; a request that does is then refused rather than answered
     * unfiltered.
     */
    private readonly customFieldListFilter: Pick<CustomFieldListFilterPort, 'condition'> | null = null,
  ) {}

  async list(query: OrderListQuery, scope?: OrderListScope): Promise<OrderListResult> {
    const em = this.emFactory();

    // Base filter shared by the page query and the per-status counts.
    const base: FilterQuery<Order> = {};
    const and: FilterQuery<Order>[] = [];
    if (scope) Object.assign(base, scope.where);
    if (query.organizationId) base.organizationId = query.organizationId;
    if (query.placedByCustomerAccountId) {
      base.placedByCustomerAccountId = query.placedByCustomerAccountId;
    }
    if (query.salesChannelId?.length) base.salesChannelId = { $in: query.salesChannelId };
    if (query.paymentMethodId?.length) base.paymentMethodId = { $in: query.paymentMethodId };
    if (query.deliveryMethodId?.length) base.deliveryMethodId = { $in: query.deliveryMethodId };
    if (query.placedFrom || query.placedTo) {
      base.placedAt = {
        ...(query.placedFrom ? { $gte: new Date(query.placedFrom) } : {}),
        ...(query.placedTo ? { $lte: new Date(query.placedTo) } : {}),
      };
    }
    if (query.totalMin !== undefined || query.totalMax !== undefined) {
      // `total` is a decimal column (string in the ORM); Postgres compares the
      // string-encoded bounds numerically.
      base.total = {
        ...(query.totalMin !== undefined ? { $gte: String(query.totalMin) } : {}),
        ...(query.totalMax !== undefined ? { $lte: String(query.totalMax) } : {}),
      };
    }
    if (query.q && query.q.trim()) {
      const q = query.q.trim();
      const like = `%${q}%`;
      const [orgIds, customerIds, externallyReferencedIds] = await Promise.all([
        this.organizationDetails.searchIdsByName(q),
        this.customerAccountRead.searchIdsByName(q),
        this.orderIdsByExternalReference(like),
      ]);
      and.push({
        $or: [
          { businessId: { $ilike: like } },
          { organizationId: { $in: orgIds } },
          { placedByCustomerAccountId: { $in: customerIds } },
          { id: { $in: externallyReferencedIds } },
        ],
      });
    }
    // Dedicated organization-name filter (AND with everything else).
    if (query.orgName && query.orgName.trim()) {
      const orgIds = await this.organizationDetails.searchIdsByName(query.orgName.trim());
      and.push({ organizationId: { $in: orgIds } });
    }
    // Dedicated customer-name filter (matches first / last name or email).
    if (query.customerName && query.customerName.trim()) {
      const customerIds = await this.customerAccountRead.searchIdsByName(query.customerName.trim());
      and.push({ placedByCustomerAccountId: { $in: customerIds } });
    }
    if (and.length) base.$and = and;

    // One condition per request, awaited once; each statement below wraps it in
    // a raw fragment of its own, because a raw fragment is not reused.
    const customFieldCondition = await this.customFieldCondition(query.customFieldFilters);
    const narrowed = (where: FilterQuery<Order>): FilterQuery<Order> => {
      if (customFieldCondition === null) return where;
      const object = where as Record<string, unknown> & { $and?: FilterQuery<Order>[] };
      return {
        ...object,
        $and: [
          ...(object.$and ?? []),
          { id: { $in: raw(`(${customFieldCondition.sql})`, [...customFieldCondition.params]) } },
        ],
      } as FilterQuery<Order>;
    };

    // The two axis filters, kept out of `base` so each axis's counts can be
    // taken over every filter but its own — which is what makes an option's
    // number mean "this is what selecting it would yield". With no
    // payment-status filter applied these are exactly the numbers this list
    // returned before feature 085.
    const statusFilter = query.status?.length ? { status: { $in: query.status } } : {};
    const paymentStatusFilter = query.paymentStatus?.length
      ? { paymentStatus: { $in: query.paymentStatus as Array<Order['paymentStatus']> } }
      : {};

    const [counts, paymentStatusCounts] = await Promise.all([
      this.countsBy(em, narrowed({ ...base, ...paymentStatusFilter }), 'status'),
      this.countsBy(em, narrowed({ ...base, ...statusFilter }), 'paymentStatus'),
    ]);

    // Page query adds both axis filters on top of the base.
    const where: FilterQuery<Order> = narrowed({ ...base, ...statusFilter, ...paymentStatusFilter });
    const { field, dir } = parseSort(query.sort);
    const offset = (query.page - 1) * query.pageSize;
    const [orders, total] = await em.findAndCount(Order, where, {
      orderBy: { [field]: dir },
      limit: query.pageSize,
      offset,
    });

    const rows = await this.toRows(em, orders);
    return { rows, total, counts, paymentStatusCounts };
  }

  /**
   * Issue #1030 — the orders an external system's reference matches, for the
   * list's `q`: matched the way the order number is, a case-insensitive
   * fragment, whichever system recorded it. The message is not searched; it
   * is the other system's words, not a number an operator is given.
   *
   * The entries are org-scoped, so the ambient tenant filter already confines
   * this to the caller's organizations, and the list's own `scope` still
   * applies to the orders the ids come back as.
   */
  private async orderIdsByExternalReference(like: string): Promise<string[]> {
    const rows = await this.emFactory().find(
      OrderExternalReference,
      { reference: { $ilike: like } },
      { fields: ['orderId'] },
    );
    return [...new Set(rows.map((row) => row.orderId))];
  }

  /**
   * Global search over orders (`specs/150-admin-global-search/`, T028).
   *
   * The list's own visibility: `scope` is the reach the list is confined to
   * (absent ⇒ every organization), applied **in the statement**;
   * the organization and customer name lookups go through the same owners'
   * ports `list` uses. Only the selected fields are matched, literally
   * (`likeEscaped`, Postgres' default `\` LIKE escape), and the identifier
   * fields rank exact → prefix → the rest, then most recent change, then id.
   * One page of `limit + 1` ids, then the rows — no count.
   */
  async searchForAdmin(
    query: OrderAdminSearchQuery,
    scope?: OrderListScope,
  ): Promise<{ rows: OrderAdminSearchRow[]; hasMore: boolean }> {
    const fields = new Set(query.fields);
    const contains = `%${query.likeEscaped}%`;
    const prefix = `${query.likeEscaped}%`;
    const [orgIds, customerIds] = await Promise.all([
      fields.has('organizationName') ? this.organizationDetails.searchIdsByName(query.text) : [],
      fields.has('customer') ? this.customerAccountRead.searchIdsByName(query.text) : [],
    ]);

    // One predicate per selected field, OR-combined. Id sets go through
    // `whereIn` (knex expands an array binding into a list, never an array).
    const matches: Array<(qb: Knex.QueryBuilder) => void> = [];
    if (fields.has('number')) matches.push((qb) => qb.orWhereRaw('"business_id" ilike ?', [contains]));
    if (orgIds.length > 0) matches.push((qb) => qb.orWhereIn('organization_id', orgIds));
    if (customerIds.length > 0) {
      matches.push((qb) => qb.orWhereIn('placed_by_customer_account_id', customerIds));
    }
    if (fields.has('billingCompanyName')) {
      matches.push((qb) => qb.orWhereRaw(`"billing_address"->>'companyName' ilike ?`, [contains]));
    }
    if (fields.has('billingTaxId')) {
      matches.push((qb) => qb.orWhereRaw(`"billing_address"->>'taxId' ilike ?`, [contains]));
    }
    if (query.isUuid) matches.push((qb) => qb.orWhereRaw('"id" = ?::uuid', [query.text]));
    if (matches.length === 0) return { rows: [], hasMore: false };
    if (scope?.empty) return { rows: [], hasMore: false };

    const exact: string[] = [];
    const starts: string[] = [];
    const rankBindings: unknown[] = [];
    const prefixBindings: unknown[] = [];
    if (query.isUuid) {
      exact.push('"id" = ?::uuid');
      rankBindings.push(query.text);
    }
    if (fields.has('number')) {
      exact.push('lower("business_id") = lower(?)');
      rankBindings.push(query.text);
      starts.push('"business_id" ilike ?');
      prefixBindings.push(prefix);
    }
    if (fields.has('billingTaxId')) {
      exact.push(`lower("billing_address"->>'taxId') = lower(?)`);
      rankBindings.push(query.text);
      starts.push(`"billing_address"->>'taxId' ilike ?`);
      prefixBindings.push(prefix);
    }
    const rank =
      exact.length === 0
        ? null
        : `case when ${exact.join(' or ')} then 0${starts.length > 0 ? ` when ${starts.join(' or ')} then 1` : ''} else 2 end`;

    const em = this.emFactory();
    const builder = em
      .getKnex()('orders')
      .select('id')
      .where((qb) => {
        if (scope) qb.whereRaw(scope.sql.sql, [...scope.sql.params] as Knex.RawBinding[]);
        qb.andWhere((or) => {
          for (const match of matches) match(or);
        });
      });
    if (rank !== null) builder.orderByRaw(rank, [...rankBindings, ...prefixBindings] as Knex.RawBinding[]);
    builder.orderBy('updated_at', 'desc').orderBy('id', 'asc').limit(query.limit + 1);
    // `em.execute(builder)`, not `await builder`: a knex handle carries no
    // transaction context (issue #207).
    const ids = ((await em.execute(builder)) as Array<{ id: string }>).map((r) => r.id);
    const page = ids.slice(0, query.limit);
    if (page.length === 0) return { rows: [], hasMore: false };

    const orders = await em.find(Order, { id: { $in: page } });
    const byId = new Map(orders.map((o) => [o.id, o]));
    const ranked = page.map((id) => byId.get(id)).filter((o): o is Order => o !== undefined);
    const rows = await this.toRows(em, ranked);
    return {
      hasMore: ids.length > query.limit,
      rows: rows.map((r) => ({
        id: r.id,
        businessId: r.businessId,
        organizationName: r.organizationName,
        placedAt: r.placedAt,
        total: r.total,
        currency: r.currency,
        status: r.status,
        statusName: r.statusName,
      })),
    };
  }

  /** The request's custom-field filters as one condition, or `null` when none applies. */
  private async customFieldCondition(
    filters: CustomFieldFilters | undefined,
  ): Promise<CustomFieldListFilterCondition | null> {
    if (filters === undefined || Object.keys(filters).length === 0) return null;
    if (this.customFieldListFilter === null) throw customFieldFilterUnavailable(Object.keys(filters));
    return this.customFieldListFilter.condition('order', filters);
  }

  /** Counts over `where`, grouped by one of the order's two status axes. */
  private async countsBy(
    em: EntityManager,
    where: FilterQuery<Order>,
    field: 'status' | 'paymentStatus',
  ): Promise<Record<string, number>> {
    const all = await em.find(Order, where, { fields: [field] });
    const counts: Record<string, number> = {};
    for (const o of all) {
      const key = o[field];
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  private async toRows(em: EntityManager, orders: Order[]): Promise<AdminOrderRow[]> {
    if (orders.length === 0) return [];
    const orgIds = [...new Set(orders.map((o) => o.organizationId))];
    const custIds = [...new Set(orders.map((o) => o.placedByCustomerAccountId))];
    const channelIds = [...new Set(orders.map((o) => o.salesChannelId))];
    const [orgs, customers, channels, graph] = await Promise.all([
      this.organizationDetails.findByIds(orgIds),
      this.customerAccountRead.findByIds(custIds),
      em.find(SalesChannel, { id: { $in: channelIds } }, { fields: ['id', 'name'] }),
      this.graphService.loadGraph(),
    ]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const custName = new Map(
      customers.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim() || c.email]),
    );
    const channelName = new Map(channels.map((c) => [c.id, resolveChannelName(c.name)]));
    const statusName = new Map(graph.statuses.map((s) => [s.code, s.name]));

    return orders.map((o) => ({
      id: o.id,
      businessId: o.businessId,
      customerName: custName.get(o.placedByCustomerAccountId) ?? null,
      organizationId: o.organizationId,
      organizationName: orgName.get(o.organizationId) ?? null,
      status: o.status,
      statusName: statusName.get(o.status) ?? { en: o.status },
      paymentStatus: o.paymentStatus,
      total: Number(o.total),
      currency: o.currency,
      placedAt: o.placedAt.toISOString(),
      createdAt: o.createdAt.toISOString(),
      salesChannelId: o.salesChannelId,
      salesChannelName: channelName.get(o.salesChannelId) ?? null,
      deliveryMethodName: o.deliveryMethodSnapshot?.name ?? null,
      paymentMethodName: o.paymentMethodSnapshot?.name ?? null,
      shipToName: o.deliveryAddress?.recipientName ?? null,
      billToName: o.billingAddress?.recipientName ?? null,
    }));
  }
}

/** Pick a human display name from a multilingual channel-name record. */
function resolveChannelName(name: Record<string, string>): string | null {
  return name['en'] ?? name['en-US'] ?? Object.values(name)[0] ?? null;
}

function parseSort(sort: string | undefined): { field: string; dir: 'asc' | 'desc' } {
  if (!sort) return { field: 'placedAt', dir: 'desc' };
  const [field, dirRaw] = sort.split(':');
  const dir = dirRaw === 'asc' ? 'asc' : 'desc';
  return SORTABLE.has(field ?? '') ? { field: field!, dir } : { field: 'placedAt', dir: 'desc' };
}
