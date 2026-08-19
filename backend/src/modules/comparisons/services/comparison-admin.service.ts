import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  ComparisonAdminDetail,
  ComparisonAdminListItem,
  ComparisonAdminListQuery,
  CustomerAccountReadPort,
  CustomerAccountRecord,
} from '@b2b/contracts';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import { Comparison } from '../entities/comparison.entity.js';
import {
  ComparisonNotFoundError,
  type ComparisonService,
} from './comparison-service.js';

/**
 * Read-only admin service for the comparisons module — feature 007 /
 * US5 / T063. Reuses the storefront `ComparisonService.buildOwnerView`
 * for the per-comparison projection, but joins owner/channel metadata
 * the storefront does not need.
 *
 * No mutation methods (spec FR-022). When operational tooling demands
 * a force-delete in the future, that is a separate spec.
 *
 * The owner column shows a customer's e-mail address, which is
 * `customer_accounts`' row and not this module's. Feature 075 (Phase C)
 * replaced the `em.find(CustomerAccount, …)` that used to fetch it with that
 * module's read port, so an admin screen cannot report identities out of a
 * module the operator has switched off.
 */
export class ComparisonAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly comparisonService: ComparisonService,
    private readonly customerAccounts: CustomerAccountReadPort,
  ) {}

  // ------------------------------------------------------------------
  // List
  // ------------------------------------------------------------------

  async list(
    filters: ComparisonAdminListQuery,
  ): Promise<{ data: ComparisonAdminListItem[]; nextCursor: string | null; limit: number }> {
    const em = this.emFactory();
    const limit = Math.max(1, Math.min(100, filters.limit ?? 25));

    const where: Record<string, unknown> = {};
    if (filters.salesChannelId) where['salesChannelId'] = filters.salesChannelId;
    if (filters.customerAccountId)
      where['customerAccountId'] = filters.customerAccountId;
    if (filters.ownerType === 'customer') {
      where['customerAccountId'] = { $ne: null };
    } else if (filters.ownerType === 'anonymous') {
      where['anonymousToken'] = { $ne: null };
    }
    if (filters.createdAfter) {
      where['createdAt'] = { $gte: new Date(filters.createdAfter) };
    }
    if (filters.createdBefore) {
      where['createdAt'] = {
        ...(where['createdAt'] as Record<string, unknown> | undefined),
        $lt: new Date(filters.createdBefore),
      };
    }

    // Cursor is a base64-encoded createdAt timestamp; rows BEFORE the
    // cursor are returned in createdAt-desc order.
    if (filters.cursor) {
      try {
        const cursorDate = new Date(
          Buffer.from(filters.cursor, 'base64url').toString('utf8'),
        );
        if (!Number.isNaN(cursorDate.getTime())) {
          where['createdAt'] = {
            ...(where['createdAt'] as Record<string, unknown> | undefined),
            $lt: cursorDate,
          };
        }
      } catch {
        // Malformed cursor — silently start from the top, same as omitting it.
      }
    }

    // Fetch limit+1 to detect whether more pages remain.
    const rows = await em.find(Comparison, where, {
      orderBy: { createdAt: 'desc' },
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    // Resolve sales-channel + customer-email metadata for the page.
    const channelIds = unique(page.map((c) => c.salesChannelId));
    const customerIds = unique(
      page.map((c) => c.customerAccountId).filter((id): id is string => Boolean(id)),
    );
    const [channels, customers] = await Promise.all([
      channelIds.length > 0
        ? em.find(SalesChannel, { id: { $in: channelIds } })
        : Promise.resolve([]),
      customerIds.length > 0
        ? this.customerAccounts.findByIds(customerIds)
        : Promise.resolve([]),
    ]);
    const channelById = new Map(channels.map((c) => [c.id, c]));
    const customerById = new Map(customers.map((c) => [c.id, c]));

    // Bridge product counts for the page in one query.
    const counts = await em.getConnection().execute<{
      comparison_id: string;
      n: string | number;
    }[]>(
      page.length > 0
        ? `select comparison_id, count(*)::int as n
             from comparison_products
             where comparison_id in (${page.map(() => '?').join(',')})
             group by comparison_id`
        : `select null as comparison_id, 0 as n where false`,
      page.map((c) => c.id),
    );
    const countById = new Map(
      counts.map((r) => [r.comparison_id, Number(r.n)]),
    );

    const data: ComparisonAdminListItem[] = page.map((c) => ({
      id: c.id,
      shareToken: c.shareToken,
      owner: ownerMetadata(c, customerById),
      salesChannel: {
        id: c.salesChannelId,
        code: channelById.get(c.salesChannelId)?.code ?? '(unknown)',
      },
      displayMode: c.displayMode,
      productCount: countById.get(c.id) ?? 0,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));

    const nextCursor = hasMore
      ? Buffer.from(page[page.length - 1]!.createdAt.toISOString(), 'utf8').toString('base64url')
      : null;

    return { data, nextCursor, limit };
  }

  // ------------------------------------------------------------------
  // Detail
  // ------------------------------------------------------------------

  async detail(id: string): Promise<ComparisonAdminDetail> {
    const em = this.emFactory();
    const comparison = await em.findOne(Comparison, { id });
    if (!comparison) throw new ComparisonNotFoundError();
    // The detail view renders prices in the comparison's recorded
    // channel (the creator's), not the admin's preferred channel.
    //
    // And in that channel's **public** prices, not the owner's negotiated
    // ones: the viewer decides the figures, the viewer here is an
    // administrator, and an administrator has no buying organisation to
    // resolve against. Handing this screen the owner's price lists would be a
    // disclosure decision of its own rather than a consequence of this one, so
    // the screen says which prices it is showing instead of assuming
    // (`detail.pricesNote`).
    //
    // The `administrator` viewer is also what keeps every *row* on this screen.
    // A storefront reader is filtered by `isProductVisibleTo`, and an admin
    // given any audience would be filtered too — dropping exactly the
    // organisation-restricted products this audit view exists to show.
    const view = await this.comparisonService.buildOwnerView(
      comparison,
      comparison.salesChannelId,
      { kind: 'administrator' },
    );

    const channel = await em.findOne(SalesChannel, { id: comparison.salesChannelId });
    const customer = comparison.customerAccountId
      ? await this.customerAccounts.findById(comparison.customerAccountId)
      : null;
    const customerById = new Map<string, CustomerAccountRecord>(
      customer ? [[customer.id, customer]] : [],
    );

    return {
      id: view.id,
      shareToken: view.shareToken,
      owner: ownerMetadata(comparison, customerById),
      salesChannel: {
        id: comparison.salesChannelId,
        code: channel?.code ?? '(unknown)',
      },
      displayMode: view.displayMode,
      products: view.products,
      comparableAttributes: view.comparableAttributes,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function ownerMetadata(
  c: Comparison,
  customerById: Map<string, CustomerAccountRecord>,
): { kind: 'customer' | 'anonymous'; customerAccountId: string | null; email: string | null; anonymousToken: string | null } {
  if (c.customerAccountId) {
    const customer = customerById.get(c.customerAccountId);
    return {
      kind: 'customer',
      customerAccountId: c.customerAccountId,
      email: customer?.email ?? null,
      anonymousToken: null,
    };
  }
  return {
    kind: 'anonymous',
    customerAccountId: null,
    email: null,
    anonymousToken: c.anonymousToken ?? null,
  };
}
