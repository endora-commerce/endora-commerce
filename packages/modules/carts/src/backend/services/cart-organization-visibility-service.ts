import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type {
  CartStatus,
  CartApprovalStatus,
  CustomerAccountReadPort,
  OrgCartsListResponse,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { cartTotalsByCart } from './cart-money.js';
import { readOrganizationCarts } from './organization-cart-reach.js';
import { cartOwnerIdentity } from './cart-owner-identity.js';

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
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * `customer_accounts`' read model (feature 075, Phase C). The org-admin
     * cart list names each cart's owner (issue #751: by name, the e-mail
     * beside it), and it read the account row itself — out of a table
     * deactivation leaves in place.
     */
    private readonly customerAccounts: CustomerAccountReadPort,
  ) {}

  async list(organizationId: string, query: OrgCartsListQuery = {}): Promise<OrgCartsListResponse> {
    const em = this.emFactory();
    // A working basket (issue #169) is transient placement state, never a cart
    // of the organisation's to list: it is seen once it is `completed`.
    const where: Record<string, unknown> = { organizationId, status: { $ne: 'working' } };
    if (query.status && query.status.length > 0) {
      where['status'] = { $in: query.status.filter((status) => status !== 'working') };
    }
    if (query.approvalStatus && query.approvalStatus.length > 0) {
      where['approvalStatus'] = { $in: query.approvalStatus };
    }
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 100);
    const orderBy = this.sortClause(query.sort ?? 'last_activity_desc');

    // Issue #619 — a member's cart is outside the administrator's own customer
    // filter; `where` names `organizationId`, so the read stays in the tenant.
    const [rows, totalCount] = await readOrganizationCarts(organizationId, () =>
      em.findAndCount(Cart, where, {
        orderBy,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
    );

    const ownerIds = Array.from(
      new Set(rows.map((r) => r.customerAccountId).filter((id): id is string => Boolean(id))),
    );
    const owners = await this.customerAccounts.findByIds(ownerIds);
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    // Bulk item-count + total resolution.
    const cartIds = rows.map((r) => r.id);
    const itemCounts =
      cartIds.length > 0 ? cartTotalsByCart(await em.find(CartItem, { cartId: { $in: cartIds } })) : new Map();

    return {
      data: rows
        .filter((r) => r.customerAccountId !== null && r.customerAccountId !== undefined)
        .map((cart) => {
          const ic = itemCounts.get(cart.id) ?? { count: 0, total: 0, currency: 'PLN' };
          const owner = ownerById.get(cart.customerAccountId!);
          return {
            id: cart.id,
            ownerCustomerAccountId: cart.customerAccountId!,
            ...cartOwnerIdentity(owner, cart.customerAccountId!),
            orderId: cart.completedOrderId ?? null,
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
    // Issue #619 — read across the administrator's own customer filter, inside
    // the Organization; a working basket is not an Organization cart (#169).
    const cart = await readOrganizationCarts(organizationId, () =>
      em.findOne(Cart, { id: cartId, organizationId, status: { $ne: 'working' } }),
    );
    if (!cart) {
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
