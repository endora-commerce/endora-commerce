import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createQuoteRequestSchema,
  patchQuoteRequestSchema,
  acceptRevisionSchema,
  rejectRevisionSchema,
  resubmitQuoteRequestSchema,
} from '@b2b/contracts';
import type { RfqService, CustomerContext } from './services/rfq-service.js';

export type RequireCustomerGuard = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export interface CustomerContextResolver {
  (request: FastifyRequest): Promise<CustomerContext>;
}

export interface QuoteRequestsCustomerDeps {
  rfqService: RfqService;
  requireCustomer: RequireCustomerGuard;
  resolveCustomerContext: CustomerContextResolver;
}

function parseIfMatch(request: FastifyRequest): number | null {
  const header = request.headers['if-match'];
  if (!header || typeof header !== 'string') return null;
  const trimmed = header.replace(/^"|"$/g, '');
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function setEtag(reply: FastifyReply, version: number): void {
  reply.header('etag', `"${version}"`);
}

export async function registerQuoteRequestsCustomerRoutes(
  app: FastifyInstance,
  deps: QuoteRequestsCustomerDeps,
): Promise<void> {
  const { rfqService, requireCustomer, resolveCustomerContext } = deps;

  // GET /api/v1/quote-requests — list visible Quote Requests for the caller
  app.get('/api/v1/quote-requests', { preHandler: requireCustomer }, async (request) => {
    const ctx = await resolveCustomerContext(request);
    const data = await rfqService.listForCustomer(ctx);
    return {
      data,
      pagination: { limit: 50, nextCursor: null, hasMore: false },
    };
  });

  // GET /api/v1/quote-requests/:id — detail
  app.get<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const rfq = await rfqService.getForCustomer(request.params.id, ctx);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // POST /api/v1/quote-requests — create + submit a new Quote Request
  app.post(
    '/api/v1/quote-requests',
    { preHandler: requireCustomer, schema: { body: createQuoteRequestSchema } },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const body = createQuoteRequestSchema.parse(request.body);
      const rfq = await rfqService.createForCustomer(ctx, body);
      setEtag(reply, rfq.version);
      reply.code(201);
      return { data: rfq };
    },
  );

  // PATCH /api/v1/quote-requests/:id — customer-side draft edit
  app.patch<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id',
    { preHandler: requireCustomer, schema: { body: patchQuoteRequestSchema } },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const body = patchQuoteRequestSchema.parse(request.body);
      const expectedVersion = parseIfMatch(request);
      const rfq = await rfqService.patchDraft(request.params.id, ctx, body, expectedVersion);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // POST /api/v1/quote-requests/:id/accept-revision
  app.post<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id/accept-revision',
    { preHandler: requireCustomer, schema: { body: acceptRevisionSchema } },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const body = acceptRevisionSchema.parse(request.body);
      const rfq = await rfqService.acceptRevision(
        request.params.id,
        ctx,
        body.expectedRevisionNumber,
      );
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // POST /api/v1/quote-requests/:id/reject-revision
  app.post<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id/reject-revision',
    { preHandler: requireCustomer, schema: { body: rejectRevisionSchema } },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const body = rejectRevisionSchema.parse(request.body);
      const rfq = await rfqService.rejectRevision(
        request.params.id,
        ctx,
        body.expectedRevisionNumber,
        body.reason,
      );
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // POST /api/v1/quote-requests/:id/resubmit — clone into a new Pending RFQ
  app.post<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id/resubmit',
    { preHandler: requireCustomer, schema: { body: resubmitQuoteRequestSchema.optional() } },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const body = resubmitQuoteRequestSchema.parse(request.body ?? {});
      const rfq = await rfqService.resubmit(request.params.id, ctx, body);
      setEtag(reply, rfq.version);
      reply.code(201);
      return { data: rfq };
    },
  );
}
