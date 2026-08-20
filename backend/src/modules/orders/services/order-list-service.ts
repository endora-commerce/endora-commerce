import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort, OrganizationDetailsPort } from '@b2b/contracts';
import { Order } from '../entities/order.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import type { OrderStatusGraphService } from './order-status-graph-service.js';

export interface OrderListQuery {
  status?: string[] | undefined;
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
  sort?: string | undefined;
  page: number;
  pageSize: number;
}

export interface OrderListScope {
  allowedOrganizationIds: string[];
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
  counts: Record<string, number>;
}

const SORTABLE = new Set(['placedAt', 'businessId', 'total', 'status']);

/**
 * OrderListService — feature 038 (US2, T037).
 *
 * Server-side filter / sort / search / pagination for the admin orders list,
 * plus per-status counts. Search `q` matches the business Order ID, the
 * Organization name, and the customer (email / first / last name).
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
  ) {}

  async list(query: OrderListQuery, scope?: OrderListScope): Promise<OrderListResult> {
    const em = this.emFactory();

    // Base filter shared by the page query and the per-status counts.
    const base: FilterQuery<Order> = {};
    const and: FilterQuery<Order>[] = [];
    if (scope) base.organizationId = { $in: scope.allowedOrganizationIds };
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
      const [orgIds, customerIds] = await Promise.all([
        this.organizationDetails.searchIdsByName(q),
        this.customerAccountRead.searchIdsByName(q),
      ]);
      and.push({
        $or: [
          { businessId: { $ilike: like } },
          { organizationId: { $in: orgIds } },
          { placedByCustomerAccountId: { $in: customerIds } },
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

    // Per-status counts over the base filter (independent of the status tab).
    const counts = await this.statusCounts(em, base);

    // Page query adds the status filter on top of the base.
    const where: FilterQuery<Order> = query.status?.length
      ? { ...base, status: { $in: query.status } }
      : base;
    const { field, dir } = parseSort(query.sort);
    const offset = (query.page - 1) * query.pageSize;
    const [orders, total] = await em.findAndCount(Order, where, {
      orderBy: { [field]: dir },
      limit: query.pageSize,
      offset,
    });

    const rows = await this.toRows(em, orders);
    return { rows, total, counts };
  }

  private async statusCounts(em: EntityManager, base: FilterQuery<Order>): Promise<Record<string, number>> {
    const all = await em.find(Order, base, { fields: ['status'] });
    const counts: Record<string, number> = {};
    for (const o of all) counts[o.status] = (counts[o.status] ?? 0) + 1;
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
