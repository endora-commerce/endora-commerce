import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  adminCartsListQuerySchema,
  adminRejectCartSchema,
  setCartApprovalPolicySchema,
  ERROR_CODES,
} from '@b2b/contracts';
import type { CartAdminService } from './services/cart-admin-service.js';
import type { CartApprovalService } from './services/cart-approval-service.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import { HttpError } from '../../http/error-envelope.js';

/**
 * Admin Carts routes (feature 027 US6).
 *
 *   - GET    /api/v1/admin/carts                  carts:read
 *   - GET    /api/v1/admin/carts/:id              carts:read
 *   - GET    /api/v1/admin/carts/:id/audit        carts:read
 *   - POST   /api/v1/admin/carts/:id/reject       carts:reject
 */

export interface CartsAdminRoutesDeps {
  cartAdminService: CartAdminService;
  /**
   * Feature 027 US4 — platform-admin proxy for the per-Organization
   * `requires_cart_approval` policy. Optional so legacy compositions
   * still build; production wires it.
   */
  cartApprovalService?: CartApprovalService;
  requireAdmin: RequireAdminFactory;
  /**
   * Resolves the admin user id from the authenticated session. Used as
   * the `actor` on the audit-log row for the reject action.
   */
  resolveAdminUserId: (req: FastifyRequest) => string | null;
}

export async function registerCartsAdminRoutes(
  app: FastifyInstance,
  deps: CartsAdminRoutesDeps,
): Promise<void> {
  const { cartAdminService, requireAdmin, resolveAdminUserId } = deps;

  app.get(
    '/api/v1/admin/carts',
    { preHandler: requireAdmin('carts:read') },
    async (request) => {
      const raw = (request.query ?? {}) as Record<string, unknown>;
      // Fastify query parser delivers repeated keys as arrays; explicit
      // status / approvalStatus are accepted as comma-separated strings
      // too for ergonomic curl use.
      const normalised: Record<string, unknown> = { ...raw };
      for (const arrKey of ['status', 'approvalStatus']) {
        const v = normalised[arrKey];
        if (typeof v === 'string') {
          normalised[arrKey] = v.split(',').filter((s) => s.length > 0);
        }
      }
      const parsed = adminCartsListQuerySchema.parse(normalised);
      return cartAdminService.list(parsed);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/carts/:id',
    { preHandler: requireAdmin('carts:read') },
    async (request) => {
      return cartAdminService.getById(request.params.id);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { page?: string; pageSize?: string } }>(
    '/api/v1/admin/carts/:id/audit',
    { preHandler: requireAdmin('carts:read') },
    async (request) => {
      const page = request.query.page ? Math.max(1, Number.parseInt(request.query.page, 10)) : 1;
      const pageSize = request.query.pageSize
        ? Math.max(1, Math.min(200, Number.parseInt(request.query.pageSize, 10)))
        : 50;
      return cartAdminService.getAudit(request.params.id, page, pageSize);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/carts/:id/reject',
    {
      preHandler: requireAdmin('carts:reject'),
      schema: { body: adminRejectCartSchema },
    },
    async (request) => {
      const adminUserId = resolveAdminUserId(request);
      if (!adminUserId) {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      const body = adminRejectCartSchema.parse(request.body);
      return cartAdminService.reject(request.params.id, adminUserId, body.reason);
    },
  );

  /**
   * Feature 027 US4 — admin proxy for the per-Organization
   * `requires_cart_approval` policy. Same semantics as the Org-Admin
   * self-service route under `/api/v1/organization/policies/cart-approval`
   * but the actor is a platform admin (and consequently the audit
   * row's actor_type is `platform_admin`).
   */
  if (deps.cartApprovalService) {
    app.patch<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/cart-approval-policy',
      {
        preHandler: requireAdmin('customers:manage'),
        schema: { body: setCartApprovalPolicySchema },
      },
      async (request) => {
        const adminUserId = resolveAdminUserId(request);
        if (!adminUserId) {
          throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
        }
        const body = setCartApprovalPolicySchema.parse(request.body);
        const org = await deps.cartApprovalService!.setPolicyByAdmin(
          request.params.id,
          adminUserId,
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
  }
}
