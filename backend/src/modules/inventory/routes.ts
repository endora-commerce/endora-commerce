import type { FastifyInstance, FastifyRequest } from 'fastify';
import { availabilityNotificationRequestSchema } from '@b2b/contracts';
import type { AvailabilityNotificationService } from './services/availability-notification-service.js';

export interface InventoryRoutesDeps {
  availabilityService: AvailabilityNotificationService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

export async function registerInventoryRoutes(
  app: FastifyInstance,
  deps: InventoryRoutesDeps,
): Promise<void> {
  const { availabilityService, requireCustomer, resolveCustomerContext } = deps;

  app.post<{ Params: { id: string } }>(
    '/api/v1/catalog/products/:id/notify-when-available',
    {
      preHandler: requireCustomer,
      schema: { body: availabilityNotificationRequestSchema.optional() },
    },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = availabilityNotificationRequestSchema.parse(request.body ?? {});
      const subscription = await availabilityService.subscribe({
        customerAccountId: ctx.customerAccountId,
        productId: request.params.id,
        variantId: body.variantId ?? null,
      });
      reply.status(202);
      return {
        data: {
          subscriptionId: subscription.id,
          requestedAt: subscription.requestedAt.toISOString(),
        },
      };
    },
  );
}
