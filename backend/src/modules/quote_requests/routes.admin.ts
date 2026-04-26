import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sendQuoteRequestSchema, declineRfqRequestSchema } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { RfqAdminService } from './services/rfq-admin-service.js';
import { loadRfqWithItems } from './services/rfq-service.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface AdminContextResolver {
  (request: FastifyRequest): { adminUserId: string };
}

export interface QuoteRequestsAdminDeps {
  adminService: RfqAdminService;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: AdminContextResolver;
  emFactory: () => EntityManager;
}

export async function registerQuoteRequestsAdminRoutes(
  app: FastifyInstance,
  deps: QuoteRequestsAdminDeps,
): Promise<void> {
  const { adminService, requireAdmin, resolveAdminContext, emFactory } = deps;

  app.get(
    '/api/v1/admin/quote-requests',
    { preHandler: requireAdmin('rfqs:handle') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const rfqs = await adminService.listAll({
        ...(q['filter[organizationId]'] ? { organizationId: q['filter[organizationId]']! } : {}),
        ...(q['filter[status]'] ? { status: q['filter[status]']! } : {}),
        ...(q['filter[assignedAdminUserId]']
          ? { assignedAdminUserId: q['filter[assignedAdminUserId]']! }
          : {}),
      });
      const em = emFactory();
      return {
        data: await Promise.all(rfqs.map((r) => loadRfqWithItems(em, r))),
        pagination: { cursor: null, hasMore: false, limit: 50 },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id',
    { preHandler: requireAdmin('rfqs:handle') },
    async (request) => {
      const rfq = await adminService.getById(request.params.id);
      return { data: await loadRfqWithItems(emFactory(), rfq) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/claim',
    { preHandler: requireAdmin('rfqs:handle') },
    async (request) => {
      const ctx = resolveAdminContext(request);
      const rfq = await adminService.claim(request.params.id, ctx.adminUserId);
      return { data: await loadRfqWithItems(emFactory(), rfq) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/quote',
    { preHandler: requireAdmin('rfqs:handle'), schema: { body: sendQuoteRequestSchema } },
    async (request) => {
      const body = sendQuoteRequestSchema.parse(request.body);
      const rfq = await adminService.sendQuote(request.params.id, body);
      return { data: await loadRfqWithItems(emFactory(), rfq) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/decline',
    { preHandler: requireAdmin('rfqs:handle'), schema: { body: declineRfqRequestSchema } },
    async (request) => {
      const body = declineRfqRequestSchema.parse(request.body);
      const rfq = await adminService.decline(request.params.id, body.message);
      return { data: await loadRfqWithItems(emFactory(), rfq) };
    },
  );
}
