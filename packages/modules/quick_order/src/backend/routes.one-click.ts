import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  organizationPermissionPreHandler,
  quickOrderOneClickRequestSchema,
  type OrganizationPermissionPort,
} from '@endora-commerce/contracts';
import { currentSalesChannel, getResolvedChannel } from '@endora-commerce/platform/kernel';
import type { OneClickContext, OneClickService } from './services/one-click-service.js';

/**
 * One-click buy routes (feature 039, US5).
 *   - GET  /quick-order/one-click/eligibility  should the PDP button show?
 *   - POST /quick-order/one-click              place the order from defaults
 *
 * Both read the channel the canonical resolver already put on the request scope
 * (Constitution XII) and hand it to the service. Before issue #99 the service
 * carried a `'default'` constructor default instead — a channel code where an id
 * was wanted — and the storefront request's real channel was never consulted.
 *
 * **Who may (`specs/170-organization-roles/`, FR-050; issue #653).** Placement
 * needs `quick_order.one_click` and `carts.order_without_approval`, declared as
 * two guards after `requireCustomer` in that order, so a member lacking either
 * is answered `403 ORGANIZATION_PERMISSION_REQUIRED` naming the first missing —
 * before the body is validated and before any basket is written. Eligibility is
 * a read and stays open; it answers the same rule as a reason.
 */
export interface QuickOrderOneClickRoutesDeps {
  service: OneClickService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** `organizations`' port, resolved per request (`module-composition.md` item 4a). */
  organizationPermissions: () => OrganizationPermissionPort;
}

/** The buyer, with the role id the request's actor carries (research R-15). */
function buyerOf(request: FastifyRequest, deps: QuickOrderOneClickRoutesDeps): OneClickContext {
  const ctx = deps.resolveCustomerContext(request);
  const actor = request.actor;
  return {
    customerAccountId: ctx.customerAccountId,
    organizationId: ctx.organizationId,
    organizationRoleId: actor.kind === 'customer' ? (actor.organizationRoleId ?? null) : null,
  };
}

export async function registerQuickOrderOneClickRoutes(
  app: FastifyInstance,
  deps: QuickOrderOneClickRoutesDeps,
): Promise<void> {
  const { service, requireCustomer, organizationPermissions } = deps;

  app.get(
    '/api/v1/quick-order/one-click/eligibility',
    { preHandler: requireCustomer },
    async (request) => ({
      data: await service.eligibility(buyerOf(request, deps), currentSalesChannel()?.id ?? null),
    }),
  );

  app.post(
    '/api/v1/quick-order/one-click',
    {
      preHandler: [
        requireCustomer,
        organizationPermissionPreHandler(organizationPermissions, 'quick_order.one_click'),
        organizationPermissionPreHandler(organizationPermissions, 'carts.order_without_approval'),
      ],
      schema: { body: quickOrderOneClickRequestSchema },
    },
    async (request, reply) => {
      const body = quickOrderOneClickRequestSchema.parse(request.body);
      const order = await service.place(
        buyerOf(request, deps),
        {
          productId: body.productId,
          variantId: body.variantId ?? null,
          ...(body.quantity ? { quantity: body.quantity } : {}),
          ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
        },
        getResolvedChannel(request).id,
        { language: await request.responseLanguage() },
      );
      reply.status(201);
      return {
        data: {
          order: {
            id: order.id,
            businessId: order.businessId,
            status: order.status,
            total: Number(order.total),
            currency: order.currency,
          },
          nextAction: order.nextAction ?? null,
        },
      };
    },
  );
}
