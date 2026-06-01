import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { changePasswordRequestSchema, ERROR_CODES } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../http/error-envelope.js';
import { CustomerAccount } from '../customer_accounts/entities/customer-account.entity.js';
import type { CustomerAuthService } from '../customer_accounts/services/customer-auth-service.js';
import type { OrderListService } from '../orders/services/order-list-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';

/**
 * Customer self-service routes (feature 040, US1). Each endpoint is scoped to
 * the authenticated customer's own data (FR-011); org-only capabilities are
 * simply absent for org-less customers (FR-003).
 */
export type RequireCustomerGuard = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export interface CustomerActorView {
  customerAccountId: string;
  organizationId: string | null;
}

/**
 * Resolves the authenticated customer WITHOUT requiring an Organization —
 * org-less customers are first-class here (FR-003). Injected by the host so
 * the actor source (production `request.actor` vs test `request.testActor`)
 * stays out of the route logic.
 */
export type ResolveCustomerActor = (
  request: FastifyRequest,
) => CustomerActorView;

export interface CustomersSelfDeps {
  emFactory: () => EntityManager;
  requireCustomer: RequireCustomerGuard;
  resolveCustomerActor: ResolveCustomerActor;
  customerAuthService: CustomerAuthService;
  /**
   * Lazy getter — OrderListService is built inside the orders plugin's
   * registration, so it is only available once the server has booted. Routes
   * resolve it at request time.
   */
  getOrderListService: () => OrderListService;
  rfqService: RfqService;
}

export async function registerCustomersSelfRoutes(
  app: FastifyInstance,
  deps: CustomersSelfDeps,
): Promise<void> {
  const { emFactory, requireCustomer, customerAuthService, resolveCustomerActor } = deps;
  const { getOrderListService, rfqService } = deps;

  // GET /api/v1/me/customer — own profile
  app.get(
    '/api/v1/me/customer',
    { preHandler: requireCustomer },
    async (request) => {
      const actor = resolveCustomerActor(request);
      const em = emFactory();
      const customer = await em.findOne(CustomerAccount, {
        id: actor.customerAccountId,
      });
      if (!customer) {
        throw new HttpError(
          404,
          ERROR_CODES.CUSTOMER_NOT_FOUND,
          'Customer not found.',
        );
      }
      return {
        data: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          organizationId: customer.organizationId ?? null,
          customerGroupId: customer.customerGroupId ?? null,
          twoFactorEnabled: customer.twoFactorConfirmedAt != null,
        },
      };
    },
  );

  // POST /api/v1/me/customer/change-password
  app.post(
    '/api/v1/me/customer/change-password',
    { preHandler: requireCustomer, schema: { body: changePasswordRequestSchema } },
    async (request, reply) => {
      const actor = resolveCustomerActor(request);
      const body = changePasswordRequestSchema.parse(request.body);
      await customerAuthService.changePassword(
        actor.customerAccountId,
        body.currentPassword,
        body.newPassword,
      );
      reply.code(204);
      return null;
    },
  );

  // GET /api/v1/me/customer/orders — own orders, aggregated across channels
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    '/api/v1/me/customer/orders',
    { preHandler: requireCustomer },
    async (request) => {
      const actor = resolveCustomerActor(request);
      const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, Number.parseInt(request.query.pageSize ?? '20', 10) || 20),
      );
      const result = await getOrderListService().list({
        placedByCustomerAccountId: actor.customerAccountId,
        page,
        pageSize,
      });
      return {
        data: result.rows,
        meta: { page, pageSize, total: result.total },
      };
    },
  );

  // GET /api/v1/me/customer/quote-requests — own RFQs
  app.get(
    '/api/v1/me/customer/quote-requests',
    { preHandler: requireCustomer },
    async (request) => {
      const actor = resolveCustomerActor(request);
      // Org-less customers cannot have RFQs (submission requires an Org).
      if (actor.organizationId === null) {
        return { data: [] };
      }
      const data = await rfqService.listForCustomer({
        customerAccountId: actor.customerAccountId,
        organizationId: actor.organizationId,
        isOrgAdmin: false,
      });
      return { data };
    },
  );
}
