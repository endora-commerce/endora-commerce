import type { FastifyInstance, FastifyRequest } from 'fastify';
import { quickOrderOneClickRequestSchema } from '@b2b/contracts';
import type { OneClickService } from './services/one-click-service.js';

/**
 * One-click buy routes (feature 039, US5).
 *   - GET  /quick-order/one-click/eligibility  should the PDP button show?
 *   - POST /quick-order/one-click              place the order from defaults
 */
export interface QuickOrderOneClickRoutesDeps {
  service: OneClickService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

export async function registerQuickOrderOneClickRoutes(
  app: FastifyInstance,
  deps: QuickOrderOneClickRoutesDeps,
): Promise<void> {
  const { service, requireCustomer, resolveCustomerContext } = deps;

  app.get(
    '/api/v1/quick-order/one-click/eligibility',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      return { data: await service.eligibility(ctx.customerAccountId) };
    },
  );

  app.post(
    '/api/v1/quick-order/one-click',
    { preHandler: requireCustomer, schema: { body: quickOrderOneClickRequestSchema } },
    async (request, reply) => {
      const body = quickOrderOneClickRequestSchema.parse(request.body);
      const ctx = resolveCustomerContext(request);
      const order = await service.place(ctx, {
        productId: body.productId,
        variantId: body.variantId ?? null,
        ...(body.quantity ? { quantity: body.quantity } : {}),
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      });
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
