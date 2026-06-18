import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type {
  AdminCartsListQuery,
  AdminCartsListResponse,
  AdminCartDetailResponse,
  AdminCartAuditResponse,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { CartAuditEntry } from '../entities/cart-audit-entry.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import type { CartAuditService } from './cart-audit-service.js';
import type { CartSnapshot, PromotionApplication } from '@b2b/contracts';

/** Narrow port over the promotion engine for the admin cart-detail discount. */
export interface AdminCartPromotionPort {
  applyToCart(snapshot: CartSnapshot): Promise<PromotionApplication>;
}

/**
 * Platform-admin observability + emergency-reject surface for carts
 * (feature 027 US6).
 *
 *   - list(filter, sort, page) — paginated, filterable, sortable view
 *     across every cart on the platform.
 *   - getById(id) — read-only detail with line items, discount, and
 *     conversion lineage.
 *   - getAudit(id, page) — paginated cart-detail audit feed.
 *   - reject(id, adminUserId, reason) — terminal `Rejected` transition
 *     by a platform admin. Refuses on already-terminal carts.
 *
 * Capability gates are enforced at the route level via `requireAdmin('carts:read')`
 * and `requireAdmin('carts:reject')`.
 */

export class CartAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cartAuditService: CartAuditService,
    /** Feature 045 (T043) — when wired, the detail shows the real discount. */
    private readonly promotion?: AdminCartPromotionPort,
  ) {}

  async list(query: AdminCartsListQuery = {}): Promise<AdminCartsListResponse> {
    const em = this.emFactory();
    const where: Record<string, unknown> = {};
    if (query.status && query.status.length > 0) where['status'] = { $in: query.status };
    if (query.approvalStatus && query.approvalStatus.length > 0) {
      where['approvalStatus'] = { $in: query.approvalStatus };
    }
    if (query.organizationId) where['organizationId'] = query.organizationId;
    if (query.customerAccountId) where['customerAccountId'] = query.customerAccountId;
    if (query.salesChannelId) where['salesChannelId'] = query.salesChannelId;
    if (query.lastActivityFrom || query.lastActivityTo) {
      const range: Record<string, Date> = {};
      if (query.lastActivityFrom) range['$gte'] = new Date(query.lastActivityFrom);
      if (query.lastActivityTo) range['$lte'] = new Date(query.lastActivityTo);
      where['lastActivityAt'] = range;
    }

    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);
    const orderBy = this.sortClause(query.sort ?? 'last_activity_desc');

    const [rows, totalCount] = await em.findAndCount(Cart, where, {
      orderBy,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    // Resolve display names + counts in bulk to avoid N+1 lookups.
    const cartIds = rows.map((r) => r.id);
    const customerIds = Array.from(
      new Set(rows.map((r) => r.customerAccountId).filter((id): id is string => Boolean(id))),
    );
    const orgIds = Array.from(
      new Set(rows.map((r) => r.organizationId).filter((id): id is string => Boolean(id))),
    );
    const channelIds = Array.from(
      new Set(rows.map((r) => r.salesChannelId).filter((id): id is string => Boolean(id))),
    );

    const [customers, organizations, channels, itemCounts] = await Promise.all([
      customerIds.length > 0
        ? em.find(CustomerAccount, { id: { $in: customerIds } })
        : Promise.resolve([]),
      orgIds.length > 0
        ? em.find(Organization, { id: { $in: orgIds } })
        : Promise.resolve([]),
      channelIds.length > 0
        ? em.find(SalesChannel, { id: { $in: channelIds } })
        : Promise.resolve([]),
      this.itemCountsByCart(em, cartIds),
    ]);

    const customerById = new Map(customers.map((c) => [c.id, c]));
    const orgById = new Map(organizations.map((o) => [o.id, o]));
    const channelById = new Map(channels.map((c) => [c.id, c]));

    return {
      data: rows.map((cart) => {
        const items = itemCounts.get(cart.id) ?? { count: 0, total: 0, currency: 'PLN' };
        const cust = cart.customerAccountId ? customerById.get(cart.customerAccountId) : null;
        const org = cart.organizationId ? orgById.get(cart.organizationId) : null;
        const channel = cart.salesChannelId ? channelById.get(cart.salesChannelId) : null;
        return {
          id: cart.id,
          ownerCustomerAccountId: cart.customerAccountId ?? null,
          ownerDisplayName: cust ? (cust.email ?? cust.id) : null,
          organizationId: cart.organizationId ?? null,
          organizationDisplayName: org?.name ?? null,
          salesChannelId: cart.salesChannelId ?? null,
          salesChannelCode: channel?.code ?? null,
          status: cart.status,
          approvalStatus: cart.approvalStatus,
          itemCount: items.count,
          total: { amount: items.total, currency: items.currency },
          appliedPromotionCode: cart.appliedPromotionCode ?? null,
          lastActivityAt: cart.lastActivityAt.toISOString(),
          createdAt: cart.createdAt.toISOString(),
        };
      }),
      meta: { page, pageSize, totalCount },
    };
  }

  async getById(cartId: string): Promise<AdminCartDetailResponse> {
    const em = this.emFactory();
    const cart = await em.findOne(Cart, { id: cartId });
    if (!cart) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found');
    }
    const items = await em.find(CartItem, { cartId });
    const cust = cart.customerAccountId
      ? await em.findOne(CustomerAccount, { id: cart.customerAccountId })
      : null;
    const org = cart.organizationId
      ? await em.findOne(Organization, { id: cart.organizationId })
      : null;
    const channel = cart.salesChannelId
      ? await em.findOne(SalesChannel, { id: cart.salesChannelId })
      : null;

    const productIds = Array.from(new Set(items.map((it) => it.productId)));
    const products = productIds.length > 0
      ? await em.find(Product, { id: { $in: productIds } })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const subtotal = items.reduce((acc, it) => acc + Number(it.unitPrice) * it.quantity, 0);
    const currency = items[0]?.currency ?? 'PLN';

    // Feature 045 (T043) — compute the real discount for the detail view.
    let discountTotal = 0;
    if (this.promotion && items.length > 0) {
      try {
        const application = await this.promotion.applyToCart({
          organizationId: cart.organizationId ?? null,
          customerGroupId: null,
          currency,
          lines: items.map((it) => ({
            productId: it.productId,
            variantId: it.variantId ?? null,
            categoryIds: [],
            quantity: it.quantity,
            unitPrice: { amount: Number(it.unitPrice), currency: it.currency },
          })),
          deliveryTotal: 0,
          promotionCode: cart.appliedPromotionCode ?? null,
          salesChannelId: cart.salesChannelId ?? null,
        });
        discountTotal = application.discountTotal;
      } catch {
        discountTotal = 0;
      }
    }
    const total = Math.max(0, Math.round((subtotal - discountTotal) * 100) / 100);

    return {
      data: {
        id: cart.id,
        ownerCustomerAccountId: cart.customerAccountId ?? null,
        ownerDisplayName: cust ? (cust.email ?? cust.id) : null,
        organizationId: cart.organizationId ?? null,
        organizationDisplayName: org?.name ?? null,
        salesChannelId: cart.salesChannelId ?? null,
        salesChannelCode: channel?.code ?? null,
        status: cart.status,
        approvalStatus: cart.approvalStatus,
        itemCount: items.length,
        total: { amount: total, currency },
        appliedPromotionCode: cart.appliedPromotionCode ?? null,
        lastActivityAt: cart.lastActivityAt.toISOString(),
        createdAt: cart.createdAt.toISOString(),
        items: items.map((it) => {
          const product = productById.get(it.productId);
          return {
            id: it.id,
            productId: it.productId,
            productName: product ? anyLocaleName(product) : it.productId,
            variantId: it.variantId ?? null,
            quantity: it.quantity,
            unitPrice: { amount: Number(it.unitPrice), currency: it.currency },
            lineTotal: { amount: Number(it.unitPrice) * it.quantity, currency: it.currency },
          };
        }),
        discount:
          discountTotal > 0
            ? { code: cart.appliedPromotionCode ?? null, amount: discountTotal, currency }
            : cart.appliedPromotionCode
              ? { code: cart.appliedPromotionCode, amount: 0, currency }
              : null,
        convertedToQuoteRequestId: cart.convertedToQuoteRequestId ?? null,
        submittedForApprovalAt: cart.submittedForApprovalAt?.toISOString() ?? null,
        approvedAt: cart.approvedAt?.toISOString() ?? null,
        approvedByCustomerAccountId: cart.approvedByCustomerAccountId ?? null,
        rejectedAt: cart.rejectedAt?.toISOString() ?? null,
        rejectedByActor: cart.rejectedByActor ?? null,
        rejectedReason: cart.rejectedReason ?? null,
      },
    };
  }

  async getAudit(
    cartId: string,
    page = 1,
    pageSize = 50,
  ): Promise<AdminCartAuditResponse> {
    const em = this.emFactory();
    const cart = await em.findOne(Cart, { id: cartId });
    if (!cart) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found');
    }
    const capped = Math.min(pageSize, 200);
    const [rows, totalCount] = await em.findAndCount(
      CartAuditEntry,
      { cartId },
      { orderBy: { occurredAt: 'desc' }, limit: capped, offset: (page - 1) * capped },
    );

    const actorIds = Array.from(
      new Set(rows.map((r) => r.actorId).filter((id): id is string => Boolean(id))),
    );
    const actors = actorIds.length > 0
      ? await em.find(CustomerAccount, { id: { $in: actorIds } })
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a]));

    return {
      data: rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurredAt.toISOString(),
        actorType: r.actorType,
        actorId: r.actorId ?? null,
        actorDisplayName: r.actorId
          ? (actorById.get(r.actorId)?.email ?? r.actorId)
          : null,
        action: r.action,
        fromState: r.fromState ?? null,
        toState: r.toState ?? null,
        reason: r.reason ?? null,
        metadata: r.metadata,
      })),
      meta: { page, pageSize: capped, totalCount },
    };
  }

  async reject(
    cartId: string,
    adminUserId: string,
    reason: string,
  ): Promise<AdminCartDetailResponse> {
    const em = this.emFactory();
    const cart = await em.findOne(Cart, { id: cartId });
    if (!cart) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found');
    }
    if (cart.status === 'completed' || cart.status === 'rejected') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'already_terminal');
    }
    const fromStatus = cart.status;
    cart.status = 'rejected';
    cart.rejectedAt = new Date();
    cart.rejectedByActor = `admin:${adminUserId}`;
    cart.rejectedReason = reason;
    cart.lastActivityAt = new Date();
    await em.flush();

    await this.cartAuditService.record({
      cartId: cart.id,
      actorType: 'platform_admin',
      actorId: adminUserId,
      action: 'admin_rejected',
      fromState: fromStatus,
      toState: 'rejected',
      reason,
    });

    return this.getById(cartId);
  }

  // Internal helpers ─────────────────────────────────────────────────────

  private sortClause(
    sort: NonNullable<AdminCartsListQuery['sort']>,
  ): Record<string, 'asc' | 'desc'> {
    switch (sort) {
      case 'last_activity_asc':
        return { lastActivityAt: 'asc' };
      case 'total_desc':
      case 'total_asc':
        // The grand total is computed from cart_items at read time; the
        // SQL-side approximation is `updatedAt` (a write-heavy proxy). A
        // true total-sort needs a subquery — kept as a follow-up.
        return { updatedAt: sort === 'total_desc' ? 'desc' : 'asc' };
      case 'created_desc':
        return { createdAt: 'desc' };
      case 'last_activity_desc':
      default:
        return { lastActivityAt: 'desc' };
    }
  }

  private async itemCountsByCart(
    em: EntityManager,
    cartIds: string[],
  ): Promise<Map<string, { count: number; total: number; currency: string }>> {
    const result = new Map<string, { count: number; total: number; currency: string }>();
    if (cartIds.length === 0) return result;
    const items = await em.find(CartItem, { cartId: { $in: cartIds } });
    for (const it of items) {
      const prev = result.get(it.cartId) ?? { count: 0, total: 0, currency: it.currency };
      prev.count += 1;
      prev.total += Number(it.unitPrice) * it.quantity;
      result.set(it.cartId, prev);
    }
    return result;
  }
}

function anyLocaleName(product: Product): string {
  if (!product.name || typeof product.name !== 'object') return product.id;
  const en = product.name['en-US'] ?? product.name['en'];
  if (typeof en === 'string' && en.length > 0) return en;
  const first = Object.values(product.name).find((v) => typeof v === 'string' && v.length > 0);
  return (first as string) ?? product.id;
}
