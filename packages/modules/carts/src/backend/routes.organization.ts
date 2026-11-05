import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  rejectOrgCartSchema,
  cartStatusSchema,
  cartApprovalStatusSchema,
  ERROR_CODES,
  organizationPermissionPreHandler,
  type CartStatus,
  type CartApprovalStatus,
  type CatalogProductReadPort,
  type CustomerAccountReadPort,
  type OrganizationPermissionPort,
  type OrgCartDetailView,
} from '@endora-commerce/contracts';
import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartService } from './services/cart-service.js';
import type { CartApprovalService } from './services/cart-approval-service.js';
import type { CartOrganizationVisibilityService } from './services/cart-organization-visibility-service.js';
import { HttpError } from '@endora-commerce/platform/http';
import { getResolvedChannel, type RequireCustomerGuard } from '@endora-commerce/platform/kernel';
import { cartLineAmount, cartSubtotal } from './services/cart-money.js';
import { productMetaOf } from './services/cart-line-meta.js';
import { cartOwnerIdentity } from './services/cart-owner-identity.js';

/**
 * Storefront routes of the Organization's cart approval (feature 027 US4;
 * `specs/170-organization-roles/` `contracts/storefront-api.md` §5).
 *
 *   - GET    /api/v1/organization/carts                        carts.approve
 *   - GET    /api/v1/organization/carts/:id                    carts.approve
 *   - POST   /api/v1/cart/submit-for-approval                  any member
 *   - POST   /api/v1/organization/carts/:id/approve            carts.approve
 *   - POST   /api/v1/organization/carts/:id/reject             carts.approve
 *
 * The gate is the organization permission `carts.approve` (FR-032, FR-033),
 * declared as a `preHandler` after `requireCustomer`: a member whose role lacks
 * it is refused `403 ORGANIZATION_PERMISSION_REQUIRED` naming the code. It
 * replaced the legacy administrator role read; *Administrator* holds every
 * code, so an administrator's reach is unchanged. The per-Organization policy
 * switch (`PATCH /api/v1/organization/policies/cart-approval`) is removed (OR-3):
 * whether a buyer needs approval is their role's `carts.order_without_approval`.
 * Anti-enumeration: a foreign organization's carts return 404, not 403.
 */

const orgCartsListQuerySchema = z.object({
  status: z.union([
    z.array(cartStatusSchema),
    z.string().transform((s) => s.split(',').filter(Boolean) as CartStatus[]),
  ]).optional(),
  approvalStatus: z.union([
    z.array(cartApprovalStatusSchema),
    z.string().transform((s) => s.split(',').filter(Boolean) as CartApprovalStatus[]),
  ]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  sort: z.enum([
    'last_activity_desc',
    'last_activity_asc',
    'total_desc',
    'total_asc',
    'created_desc',
  ]).optional(),
});

export interface CartsOrganizationRoutesDeps {
  cartService: CartService;
  /**
   * `customer_accounts`' read model (feature 075, Phase C) — the owner's e-mail
   * on the cart detail. It was `em.findOne` against `customer_accounts`' table.
   */
  customerAccounts: CustomerAccountReadPort;
  /**
   * `organizations`' permission port, resolved per request through this thunk
   * (`contracts/organization-permission-port.md` §5) — never a captured port.
   */
  organizationPermissions: () => OrganizationPermissionPort;
  cartApprovalService: CartApprovalService;
  /** Issue #650 — the names and SKUs of a cart's lines on the detail. */
  catalogProducts: Pick<CatalogProductReadPort, 'findByIds'>;
  visibilityService: CartOrganizationVisibilityService;
  emFactory: () => EntityManager;
  /** Declared on the routes that validate a body, so it runs before validation. */
  requireCustomer: RequireCustomerGuard;
  resolveCartActor: (request: FastifyRequest) => {
    /** `organizationRoleId` as in `CartsDeps.resolveCartActor` (research R-15, FR-080). */
    customer?: {
      customerAccountId: string;
      organizationId: string | null;
      organizationRoleId?: string | null;
    };
    anonymousToken?: string;
  };
}

export async function registerCartsOrganizationRoutes(
  app: FastifyInstance,
  deps: CartsOrganizationRoutesDeps,
): Promise<void> {
  const {
    cartService,
    cartApprovalService,
    visibilityService,
    customerAccounts,
    catalogProducts,
    requireCustomer,
    resolveCartActor,
    organizationPermissions,
  } = deps;

  /** Signed in, and the role holds `carts.approve` — judged before any handler. */
  const approver = [requireCustomer, organizationPermissionPreHandler(organizationPermissions, 'carts.approve')];

  /** The approver the guards admitted, as the service takes it. */
  const approverOf = (request: FastifyRequest): { customerAccountId: string; organizationId: string } => {
    const actor = resolveCartActor(request);
    if (!actor.customer) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Sign-in required.');
    }
    if (!actor.customer.organizationId) {
      // D-178 — an invariant, as on `submit-for-approval` below.
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'Invariant violated: a customer account has no Organization (Principle XI).',
      );
    }
    return {
      customerAccountId: actor.customer.customerAccountId,
      organizationId: actor.customer.organizationId,
    };
  };

  app.get('/api/v1/organization/carts', { preHandler: approver }, async (request) => {
    const approverActor = approverOf(request);
    const parsed = orgCartsListQuerySchema.parse(request.query ?? {});
    const query: Parameters<typeof visibilityService.list>[1] = {};
    if (parsed.status !== undefined) query.status = parsed.status;
    if (parsed.approvalStatus !== undefined) query.approvalStatus = parsed.approvalStatus;
    if (parsed.page !== undefined) query.page = parsed.page;
    if (parsed.pageSize !== undefined) query.pageSize = parsed.pageSize;
    if (parsed.sort !== undefined) query.sort = parsed.sort;
    return visibilityService.list(approverActor.organizationId, query);
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/organization/carts/:id',
    { preHandler: approver },
    async (request) => {
      const approverActor = approverOf(request);
      const cart = await visibilityService.getInOrganization(
        request.params.id,
        approverActor.organizationId,
      );
      const items = await cartService.getItems(cart.id);
      const total = Number(cartSubtotal(items));
      const currency = items[0]?.currency ?? 'PLN';
      const owner = cart.customerAccountId
        ? await customerAccounts.findById(cart.customerAccountId)
        : null;
      // Issue #650 — the lines, so the administrator sees what they approve:
      // named in the response language, at the price stored on the line.
      const products =
        items.length > 0
          ? await catalogProducts.findByIds(Array.from(new Set(items.map((it) => it.productId))))
          : [];
      const meta = productMetaOf(products, await request.responseLanguage(), new Set());
      const data: OrgCartDetailView = {
        id: cart.id,
        ownerCustomerAccountId: cart.customerAccountId ?? null,
        ...cartOwnerIdentity(owner, cart.customerAccountId ?? ''),
        orderId: cart.completedOrderId ?? null,
        status: cart.status,
        approvalStatus: cart.approvalStatus,
        itemCount: items.length,
        total: { amount: total, currency },
        lastActivityAt: cart.lastActivityAt.toISOString(),
        submittedForApprovalAt: cart.submittedForApprovalAt?.toISOString() ?? null,
        approvedAt: cart.approvedAt?.toISOString() ?? null,
        rejectedAt: cart.rejectedAt?.toISOString() ?? null,
        rejectedReason: cart.rejectedReason ?? null,
        items: items.map((it) => {
          const name = meta.get(it.productId)?.name ?? null;
          return {
            id: it.id,
            productId: it.productId,
            variantId: it.variantId ?? null,
            displayName:
              name !== null && it.packagingUnitName ? `${name} (${it.packagingUnitName})` : name,
            productSku: meta.get(it.productId)?.sku ?? null,
            quantity: it.quantity,
            unitPrice: { amount: Number(it.unitPrice), currency: it.currency },
            lineTotal: { amount: cartLineAmount(it.unitPrice, it.quantity), currency: it.currency },
          };
        }),
      };
      return { data };
    },
  );

  app.post('/api/v1/cart/submit-for-approval', async (request) => {
    const actor = resolveCartActor(request);
    if (!actor.customer) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Sign-in required.');
    }
    // D-178 — an invariant, not a business state: every customer account has an
    // Organization (`customer_accounts.organization_id` is `NOT NULL`), so
    // reaching this is a broken platform and not a buyer who needs to attach
    // one. Kept rather than deleted — the actor's field is optional at this
    // seam and the call below takes a `string`.
    if (!actor.customer.organizationId) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'Invariant violated: a customer account has no Organization (Principle XI).',
      );
    }
    // The basket of the storefront the buyer is on (`specs/154-sales-channel-access/`).
    const cart = await cartService.getOrCreateForCustomer({
      ...actor.customer,
      salesChannelId: getResolvedChannel(request).id,
    });
    const language = await request.responseLanguage();
    // The stored cart, not the one read above: the reply states what was
    // written (issue #619 — it used to echo an object nothing had persisted).
    const submitted = await cartApprovalService.submitForApproval(
      cart,
      {
        customerAccountId: actor.customer.customerAccountId,
        organizationId: actor.customer.organizationId,
        organizationRoleId: actor.customer.organizationRoleId ?? null,
      },
      { language },
    );
    return { data: { ok: true, approvalStatus: submitted.approvalStatus } };
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/organization/carts/:id/approve',
    { preHandler: approver },
    async (request) => {
      const approverActor = approverOf(request);
      const cart = await cartApprovalService.approve(request.params.id, approverActor);
      return { data: { ok: true, cartId: cart.id, approvalStatus: cart.approvalStatus } };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/organization/carts/:id/reject',
    { preHandler: approver, schema: { body: rejectOrgCartSchema } },
    async (request) => {
      const approverActor = approverOf(request);
      const body = rejectOrgCartSchema.parse(request.body);
      const cart = await cartApprovalService.reject(request.params.id, approverActor, body.reason);
      return {
        data: {
          ok: true,
          cartId: cart.id,
          status: cart.status,
          approvalStatus: cart.approvalStatus,
        },
      };
    },
  );
}
