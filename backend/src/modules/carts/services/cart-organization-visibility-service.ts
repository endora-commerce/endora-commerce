import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type {
  CartStatus,
  CartApprovalStatus,
  OrgCartsListResponse,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';

/**
 * Organization-Administrator visibility surface (feature 027 US4).
 *
 * Lists every cart belonging to a member of the caller's Organization.
 * The role gate is enforced at the route level; this service trusts
 * its caller's `actor.organizationId` and refuses anti-enumeration
 * lookups against other organizations.
 */

export interface OrgCartsListQuery {
  status?: CartStatus[];
  approvalStatus?: CartApprovalStatus[];
  page?: number;
  pageSize?: number;
  sort?: 'last_activity_desc' | 'last_activity_asc' | 'total_desc' | 'total_asc' | 'created_desc';
}

export class CartOrganizationVisibilityService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(organizationId: string, query: OrgCartsListQuery = {}): Promise<OrgCartsListResponse> {
    const em = this.emFactory();
    const where: Record<string, unknown> = { organizationId };
    if (query.status && query.status.length > 0) where['status'] = { $in: query.status };
    if (query.approvalStatus && query.approvalStatus.length > 0) {
      where['approvalStatus'] = { $in: query.approvalStatus };
    }
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 100);
    const orderBy = this.sortClause(query.sort ?? 'last_activity_desc');

    const [rows, totalCount] = await em.findAndCount(Cart, where, {
      orderBy,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    const ownerIds = Array.from(
      new Set(rows.map((r) => r.customerAccountId).filter((id): id is string => Boolean(id))),
    );
    const owners = ownerIds.length > 0
      ? await em.find(CustomerAccount, { id: { $in: ownerIds } })
      : [];
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    // Bulk item-count + total resolution.
    const cartIds = rows.map((r) => r.id);
    const itemCounts = new Map<string, { count: number; total: number; currency: string }>();
    if (cartIds.length > 0) {
      const items = await em.find(CartItem, { cartId: { $in: cartIds } });
      for (const it of items) {
        const prev = itemCounts.get(it.cartId) ?? { count: 0, total: 0, currency: it.currency };
        prev.count += 1;
        prev.total += Number(it.unitPrice) * it.quantity;
        itemCounts.set(it.cartId, prev);
      }
    }

    return {
      data: rows
        .filter((r) => r.customerAccountId !== null && r.customerAccountId !== undefined)
        .map((cart) => {
          const ic = itemCounts.get(cart.id) ?? { count: 0, total: 0, currency: 'PLN' };
          const owner = ownerById.get(cart.customerAccountId!);
          return {
            id: cart.id,
            ownerCustomerAccountId: cart.customerAccountId!,
            ownerDisplayName: owner?.email ?? cart.customerAccountId!,
            status: cart.status,
            approvalStatus: cart.approvalStatus,
            itemCount: ic.count,
            total: { amount: ic.total, currency: ic.currency },
            lastActivityAt: cart.lastActivityAt.toISOString(),
            submittedForApprovalAt: cart.submittedForApprovalAt?.toISOString() ?? null,
          };
        }),
      meta: { page, pageSize, totalCount },
    };
  }

  /**
   * Fetch a single cart in the caller's Organization. Refuses with 404
   * when the cart belongs to a different Organization (anti-enumeration
   * symmetry with the ordinary-member ownership check).
   */
  async getInOrganization(cartId: string, organizationId: string): Promise<Cart> {
    const em = this.emFactory();
    const cart = await em.findOne(Cart, { id: cartId });
    if (!cart || cart.organizationId !== organizationId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found');
    }
    return cart;
  }

  private sortClause(
    sort: NonNullable<OrgCartsListQuery['sort']>,
  ): Record<string, 'asc' | 'desc'> {
    switch (sort) {
      case 'last_activity_asc':
        return { lastActivityAt: 'asc' };
      case 'total_desc':
      case 'total_asc':
        return { updatedAt: sort === 'total_desc' ? 'desc' : 'asc' };
      case 'created_desc':
        return { createdAt: 'desc' };
      case 'last_activity_desc':
      default:
        return { lastActivityAt: 'desc' };
    }
  }
}
