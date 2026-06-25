import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createReturnCaseRequestSchema,
  customerAddCommentRequestSchema,
  selectReturnDeliveryMethodRequestSchema,
} from '@b2b/contracts';
import type { ReturnCaseService } from './services/return-case-service.js';
import type { ReturnCommentService } from './services/return-comment-service.js';
import type { ReturnDeliveryMethodService } from './services/return-delivery-method-service.js';
import type { ReturnReasonService } from './services/return-reason-service.js';

/**
 * Returns customer (storefront) routes — feature 046 (US1, US4, US6). All
 * endpoints require an authenticated customer; ownership is enforced in the
 * service against `customer_account_id`.
 */
export interface ReturnsCustomerRoutesDeps {
  caseService: ReturnCaseService;
  commentService: ReturnCommentService;
  deliveryMethodService: ReturnDeliveryMethodService;
  reasonService: ReturnReasonService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerAccountId: (req: FastifyRequest) => string;
}

export async function registerReturnsCustomerRoutes(
  app: FastifyInstance,
  deps: ReturnsCustomerRoutesDeps,
): Promise<void> {
  const {
    caseService,
    commentService,
    deliveryMethodService,
    reasonService,
    requireCustomer,
    resolveCustomerAccountId,
  } = deps;

  app.get<{ Querystring: { kind?: 'return' | 'complaint' } }>(
    '/api/v1/returns/reasons',
    { preHandler: requireCustomer },
    async (request) => {
      const data = await reasonService.listActive(request.query.kind);
      return { data };
    },
  );

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

  app.post<{ Params: { id: string } }>(
    '/api/v1/returns/:id/comments',
    { preHandler: requireCustomer, schema: { body: customerAddCommentRequestSchema } },
    async (request, reply) => {
      const customerAccountId = resolveCustomerAccountId(request);
      const body = customerAddCommentRequestSchema.parse(request.body);
      const data = await commentService.addByCustomer(request.params.id, customerAccountId, body);
      reply.status(201);
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/returns/:id/select-delivery-method',
    { preHandler: requireCustomer, schema: { body: selectReturnDeliveryMethodRequestSchema } },
    async (request) => {
      const customerAccountId = resolveCustomerAccountId(request);
      const body = selectReturnDeliveryMethodRequestSchema.parse(request.body);
      const data = await deliveryMethodService.selectForCase(
        request.params.id,
        customerAccountId,
        body.returnDeliveryMethodId,
      );
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/returns/:id/cancel',
    { preHandler: requireCustomer },
    async (request) => {
      const customerAccountId = resolveCustomerAccountId(request);
      const data = await caseService.cancelByCustomer(request.params.id, customerAccountId);
      return { data };
    },
  );
}
