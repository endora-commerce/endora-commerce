import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { Order } from '../entities/order.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { normalizeOrganizationName } from '../../organizations/services/normalize-name.js';
import type { OrderStatusGraphService } from './order-status-graph-service.js';

export interface OrderListQuery {
  status?: string | undefined;
  salesChannelId?: string | undefined;
  organizationId?: string | undefined;
  q?: string | undefined;
  placedFrom?: string | undefined;
  placedTo?: string | undefined;
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
  ) {}

  async list(query: OrderListQuery, scope?: OrderListScope): Promise<OrderListResult> {
    const em = this.emFactory();

    // Base filter shared by the page query and the per-status counts.
    const base: FilterQuery<Order> = {};
    if (scope) base.organizationId = { $in: scope.allowedOrganizationIds };
    if (query.organizationId) base.organizationId = query.organizationId;
    if (query.salesChannelId) base.salesChannelId = query.salesChannelId;
    if (query.placedFrom || query.placedTo) {
      base.placedAt = {
        ...(query.placedFrom ? { $gte: new Date(query.placedFrom) } : {}),
        ...(query.placedTo ? { $lte: new Date(query.placedTo) } : {}),
      };
    }
    if (query.q && query.q.trim()) {
      const q = query.q.trim();
      const like = `%${q}%`;
      const [orgs, customers] = await Promise.all([
        em.find(Organization, { nameSearch: { $like: `%${normalizeOrganizationName(q)}%` } }, { fields: ['id'] }),
        em.find(
          CustomerAccount,
          { $or: [{ email: { $ilike: like } }, { firstName: { $ilike: like } }, { lastName: { $ilike: like } }] },
          { fields: ['id'] },
        ),
      ]);
      base.$or = [
        { businessId: { $ilike: like } },
        { organizationId: { $in: orgs.map((o) => o.id) } },
        { placedByCustomerAccountId: { $in: customers.map((c) => c.id) } },
      ];
    }

    // Per-status counts over the base filter (independent of the status tab).
    const counts = await this.statusCounts(em, base);

    // Page query adds the status filter on top of the base.
    const where: FilterQuery<Order> = query.status ? { ...base, status: query.status } : base;
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
    const [orgs, customers, graph] = await Promise.all([
      em.find(Organization, { id: { $in: orgIds } }, { fields: ['id', 'name'] }),
      em.find(CustomerAccount, { id: { $in: custIds } }, { fields: ['id', 'firstName', 'lastName', 'email'] }),
      this.graphService.loadGraph(),
    ]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const custName = new Map(
      customers.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim() || c.email]),
    );
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
    }));
  }
}

function parseSort(sort: string | undefined): { field: string; dir: 'asc' | 'desc' } {
  if (!sort) return { field: 'placedAt', dir: 'desc' };
  const [field, dirRaw] = sort.split(':');
  const dir = dirRaw === 'asc' ? 'asc' : 'desc';
  return SORTABLE.has(field ?? '') ? { field: field!, dir } : { field: 'placedAt', dir: 'desc' };
}
