import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createReturnCaseRequestSchema } from '@b2b/contracts';
import type { ReturnCaseService } from './services/return-case-service.js';

/**
 * Returns customer (storefront) routes — feature 046 (US1). All endpoints
 * require an authenticated customer; ownership is enforced in the service
 * against `customer_account_id`.
 */
export interface ReturnsCustomerRoutesDeps {
  caseService: ReturnCaseService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerAccountId: (req: FastifyRequest) => string;
}

export async function registerReturnsCustomerRoutes(
  app: FastifyInstance,
  deps: ReturnsCustomerRoutesDeps,
): Promise<void> {
  const { caseService, requireCustomer, resolveCustomerAccountId } = deps;

  app.get<{ Params: { orderId: string } }>(
    '/api/v1/orders/:orderId/returnable',
    { preHandler: requireCustomer },
    async (request) => {
      const customerAccountId = resolveCustomerAccountId(request);
      const data = await caseService.getReturnable(request.params.orderId, customerAccountId);
      return { data };
    },
  );

  app.get('/api/v1/returns', { preHandler: requireCustomer }, async (request) => {
    const customerAccountId = resolveCustomerAccountId(request);
    const data = await caseService.listForCustomer(customerAccountId);
    return { data };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/returns/:id',
    { preHandler: requireCustomer },
    async (request) => {
      const customerAccountId = resolveCustomerAccountId(request);
      const data = await caseService.getForCustomer(request.params.id, customerAccountId);
      return { data };
    },
  );

  app.post(
    '/api/v1/returns',
    { preHandler: requireCustomer, schema: { body: createReturnCaseRequestSchema } },
    async (request, reply) => {
      const customerAccountId = resolveCustomerAccountId(request);
      const body = createReturnCaseRequestSchema.parse(request.body);
      const data = await caseService.createCase(body, customerAccountId);
      reply.status(201);
      return { data };
    },
  );
}
