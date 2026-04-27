import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  addRfqItemRequestSchema,
  updateRfqItemRequestSchema,
  submitRfqRequestSchema,
  acceptRfqRequestSchema,
  rejectRfqRequestSchema,
  ERROR_CODES,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { RfqService } from './services/rfq-service.js';
import { loadRfqWithItems } from './services/rfq-service.js';
import type { EntityManager } from '@mikro-orm/postgresql';

export type RequireCustomerGuard = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export interface CustomerContextResolver {
  (request: FastifyRequest): { customerAccountId: string; organizationId: string };
}

export interface QuoteRequestsCustomerDeps {
  rfqService: RfqService;
  requireCustomer: RequireCustomerGuard;
  resolveCustomerContext: CustomerContextResolver;
  emFactory: () => EntityManager;
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
  const { rfqService, requireCustomer, resolveCustomerContext, emFactory } = deps;

  // GET /quote-requests/current — returns (or lazily creates) the customer's draft
  app.get('/api/v1/quote-requests/current', { preHandler: requireCustomer }, async (request, reply) => {
    const ctx = resolveCustomerContext(request);
    const rfq = await rfqService.getOrCreateDraft(ctx);
    setEtag(reply, rfq.version);
    return { data: await loadRfqWithItems(emFactory(), rfq) };
  });

  // POST /quote-requests/current/items
  app.post(
    '/api/v1/quote-requests/current/items',
    { preHandler: requireCustomer, schema: { body: addRfqItemRequestSchema } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = addRfqItemRequestSchema.parse(request.body);
      const rfq = await rfqService.addItem(ctx, body);
      setEtag(reply, rfq.version);
      return { data: await loadRfqWithItems(emFactory(), rfq) };
    },
  );

  // PATCH /quote-requests/current/items/:itemId
  app.patch<{ Params: { itemId: string } }>(
    '/api/v1/quote-requests/current/items/:itemId',
    { preHandler: requireCustomer, schema: { body: updateRfqItemRequestSchema } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = updateRfqItemRequestSchema.parse(request.body);
      const expectedVersion = parseIfMatch(request);
      const rfq = await rfqService.updateItem(
        ctx,
        request.params.itemId,
        {
          ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
          ...(body.requesterNote !== undefined ? { requesterNote: body.requesterNote } : {}),
        },
        expectedVersion,
      );
      setEtag(reply, rfq.version);
      return { data: await loadRfqWithItems(emFactory(), rfq) };
    },
  );

  // DELETE /quote-requests/current/items/:itemId
  app.delete<{ Params: { itemId: string } }>(
    '/api/v1/quote-requests/current/items/:itemId',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const rfq = await rfqService.removeItem(ctx, request.params.itemId);
      setEtag(reply, rfq.version);
      return { data: await loadRfqWithItems(emFactory(), rfq) };
    },
  );

  // POST /quote-requests/current/submit
  app.post(
    '/api/v1/quote-requests/current/submit',
    { preHandler: requireCustomer, schema: { body: submitRfqRequestSchema.optional() } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = submitRfqRequestSchema.parse(request.body ?? {});
      const rfq = await rfqService.submit(ctx, body.requesterNote);
      setEtag(reply, rfq.version);
      return { data: await loadRfqWithItems(emFactory(), rfq) };
    },
  );

  // POST /quote-requests/:id/accept
  app.post<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id/accept',
    { preHandler: requireCustomer, schema: { body: acceptRfqRequestSchema.optional() } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const rfq = await rfqService.accept(request.params.id, ctx);
      setEtag(reply, rfq.version);
      return { data: await loadRfqWithItems(emFactory(), rfq) };
    },
  );

  // POST /quote-requests/:id/reject
  app.post<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id/reject',
    { preHandler: requireCustomer, schema: { body: rejectRfqRequestSchema } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = rejectRfqRequestSchema.parse(request.body);
      const rfq = await rfqService.reject(request.params.id, ctx, {
        reason: body.reason,
        ...(body.message !== undefined ? { message: body.message } : {}),
        ...(body.requestChanges !== undefined ? { requestChanges: body.requestChanges } : {}),
      });
      setEtag(reply, rfq.version);
      return { data: await loadRfqWithItems(emFactory(), rfq) };
    },
  );

  // GET /quote-requests
  app.get('/api/v1/quote-requests', { preHandler: requireCustomer }, async (request) => {
    const ctx = resolveCustomerContext(request);
    const rfqs = await rfqService.list(ctx);
    const em = emFactory();
    return {
      data: await Promise.all(rfqs.map((r) => loadRfqWithItems(em, r))),
      pagination: { cursor: null, hasMore: false, limit: 50 },
    };
  });

  // GET /quote-requests/:id
  app.get<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      try {
        const rfq = await rfqService.getById(request.params.id, ctx);
        setEtag(reply, rfq.version);
        return { data: await loadRfqWithItems(emFactory(), rfq) };
      } catch (err) {
        if (err instanceof HttpError && err.code === ERROR_CODES.NOT_FOUND) throw err;
        throw err;
      }
    },
  );
}
