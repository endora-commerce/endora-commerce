import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  rejectOrgCartSchema,
  setCartApprovalPolicySchema,
  cartStatusSchema,
  cartApprovalStatusSchema,
  ERROR_CODES,
  type CartStatus,
  type CartApprovalStatus,
  type CustomerAccountReadPort,
} from '@b2b/contracts';
import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartService } from './services/cart-service.js';
import type { CartApprovalService } from './services/cart-approval-service.js';
import type { CartOrganizationVisibilityService } from './services/cart-organization-visibility-service.js';
import { HttpError } from '../../http/error-envelope.js';

/**
 * Storefront routes scoped to an Organization Admin (feature 027 US4).
 *
 *   - GET    /api/v1/organization/carts                        org-admin
 *   - GET    /api/v1/organization/carts/:id                    org-admin
 *   - PATCH  /api/v1/organization/policies/cart-approval       org-admin
 *   - POST   /api/v1/cart/submit-for-approval                  ordinary member
 *   - POST   /api/v1/organization/carts/:id/approve            org-admin
 *   - POST   /api/v1/organization/carts/:id/reject             org-admin
 *
 * Role check is uniform: the caller's CustomerAccount.role must be
 * `organization_admin` for every endpoint marked "org-admin" above.
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
   * `customer_accounts`' read model (feature 075, Phase C). Two reads: the
   * caller's own role — which is the org-admin gate on every route here — and
   * the owner's e-mail on the cart detail. Both were `em.findOne` against
   * `customer_accounts`' table, so the gate went on answering out of rows a
   * deactivation leaves in place.
   */
  customerAccounts: CustomerAccountReadPort;
  cartApprovalService: CartApprovalService;
  visibilityService: CartOrganizationVisibilityService;
  emFactory: () => EntityManager;
  resolveCartActor: (request: FastifyRequest) => {
    customer?: { customerAccountId: string; organizationId: string | null };
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
    resolveCartActor,
  } = deps;

  /** Resolves the caller as an Organization Administrator (404 if not). */
  const requireOrgAdmin = async (request: FastifyRequest): Promise<{
    customerAccountId: string;
    organizationId: string;
  }> => {
    const actor = resolveCartActor(request);
    if (!actor.customer) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Sign-in required.');
    }
    if (!actor.customer.organizationId) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'No organization in session.');
    }
    const me = await customerAccounts.findById(actor.customer.customerAccountId);
    if (!me || me.role !== 'organization_admin') {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Organization Admin role required.');
    }
    return {
      customerAccountId: actor.customer.customerAccountId,
      organizationId: actor.customer.organizationId,
    };
  };

  app.get('/api/v1/organization/carts', async (request) => {
    const orgAdmin = await requireOrgAdmin(request);
    const parsed = orgCartsListQuerySchema.parse(request.query ?? {});
    const query: Parameters<typeof visibilityService.list>[1] = {};
    if (parsed.status !== undefined) query.status = parsed.status;
    if (parsed.approvalStatus !== undefined) query.approvalStatus = parsed.approvalStatus;
    if (parsed.page !== undefined) query.page = parsed.page;
    if (parsed.pageSize !== undefined) query.pageSize = parsed.pageSize;
    if (parsed.sort !== undefined) query.sort = parsed.sort;
    return visibilityService.list(orgAdmin.organizationId, query);
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/organization/carts/:id',
    async (request) => {
      const orgAdmin = await requireOrgAdmin(request);
      const cart = await visibilityService.getInOrganization(
        request.params.id,
        orgAdmin.organizationId,
      );
      const items = await cartService.getItems(cart.id);
      const total = items.reduce((acc, it) => acc + Number(it.unitPrice) * it.quantity, 0);
      const currency = items[0]?.currency ?? 'PLN';
      const owner = cart.customerAccountId
        ? await customerAccounts.findById(cart.customerAccountId)
        : null;
      return {
        data: {
          id: cart.id,
          ownerCustomerAccountId: cart.customerAccountId,
          ownerDisplayName: owner?.email ?? cart.customerAccountId,
          status: cart.status,
          approvalStatus: cart.approvalStatus,
          itemCount: items.length,
          total: { amount: total, currency },
          lastActivityAt: cart.lastActivityAt.toISOString(),
          submittedForApprovalAt: cart.submittedForApprovalAt?.toISOString() ?? null,
          approvedAt: cart.approvedAt?.toISOString() ?? null,
          rejectedAt: cart.rejectedAt?.toISOString() ?? null,
          rejectedReason: cart.rejectedReason ?? null,
        },
      };
    },
  );

  app.patch(
    '/api/v1/organization/policies/cart-approval',
    { schema: { body: setCartApprovalPolicySchema } },
    async (request) => {
      const orgAdmin = await requireOrgAdmin(request);
      const body = setCartApprovalPolicySchema.parse(request.body);
      const org = await cartApprovalService.setPolicyForOrganization(
        orgAdmin.organizationId,
        orgAdmin,
        body.requiresCartApproval,
      );
      return {
        data: {
          organizationId: org.id,
          requiresCartApproval: org.requiresCartApproval,
          updatedAt: org.updatedAt.toISOString(),
        },
      };
    },
  );

  app.post('/api/v1/cart/submit-for-approval', async (request) => {
    const actor = resolveCartActor(request);
    if (!actor.customer) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Sign-in required.');
    }
    if (!actor.customer.organizationId) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'organization_required');
    }
    const cart = await cartService.getOrCreateForCustomer(actor.customer);
    await cartApprovalService.submitForApproval(cart, {
      customerAccountId: actor.customer.customerAccountId,
      organizationId: actor.customer.organizationId,
    });
    return { data: { ok: true, approvalStatus: cart.approvalStatus } };
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/organization/carts/:id/approve',
    async (request) => {
      const orgAdmin = await requireOrgAdmin(request);
      const cart = await cartApprovalService.approve(request.params.id, orgAdmin);
      return { data: { ok: true, cartId: cart.id, approvalStatus: cart.approvalStatus } };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/organization/carts/:id/reject',
    { schema: { body: rejectOrgCartSchema } },
    async (request) => {
      const orgAdmin = await requireOrgAdmin(request);
      const body = rejectOrgCartSchema.parse(request.body);
      const cart = await cartApprovalService.reject(request.params.id, orgAdmin, body.reason);
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
