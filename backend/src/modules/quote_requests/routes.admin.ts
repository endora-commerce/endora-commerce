import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  adminApproveQuoteRequestSchema,
  adminAssignQuoteRequestSchema,
  adminCancelQuoteRequestSchema,
  adminCreateQuoteRequestSchema,
  adminPatchQuoteRequestSchema,
  rfqStatusSchema,
} from '@endora-commerce/contracts';
import type { RfqAdminService, AdminContext, AdminAssignmentScope } from './services/rfq-admin-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface AdminContextResolver {
  (request: FastifyRequest): Promise<AdminContext>;
}

export interface QuoteRequestsAdminDeps {
  adminService: RfqAdminService;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: AdminContextResolver;
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

export async function registerQuoteRequestsAdminRoutes(
  app: FastifyInstance,
  deps: QuoteRequestsAdminDeps,
): Promise<void> {
  const { adminService, requireAdmin, resolveAdminContext } = deps;
  const guard = requireAdmin('rfqs:handle');

  app.get('/api/v1/admin/quote-requests', { preHandler: guard }, async (request) => {
    const ctx = await resolveAdminContext(request);
    const q = (request.query ?? {}) as Record<string, string | undefined>;

    const status = q['status']
      ? q['status']
          .split(',')
          .map((s) => s.trim())
          .filter((s) => rfqStatusSchema.safeParse(s).success)
      : undefined;
    const scope = (q['assignmentScope'] as AdminAssignmentScope | undefined) ?? undefined;

    const data = await adminService.listAll(ctx, {
      ...(q['organizationId'] ? { organizationId: q['organizationId']! } : {}),
      ...(status && status.length > 0 ? { status: status as never } : {}),
      ...(scope ? { scope } : {}),
    });
    return {
      data,
      pagination: { limit: 50, nextCursor: null, hasMore: false },
    };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id',
    { preHandler: guard },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const rfq = await adminService.getById(ctx, request.params.id);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  app.post(
    '/api/v1/admin/quote-requests',
    { preHandler: guard, schema: { body: adminCreateQuoteRequestSchema } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const body = adminCreateQuoteRequestSchema.parse(request.body);
      const rfq = await adminService.createOnBehalf(ctx, body);
      setEtag(reply, rfq.version);
      reply.code(201);
      return { data: rfq };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id',
    { preHandler: guard, schema: { body: adminPatchQuoteRequestSchema } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const body = adminPatchQuoteRequestSchema.parse(request.body);
      const expectedVersion = parseIfMatch(request);
      const rfq = await adminService.modify(ctx, request.params.id, expectedVersion, body);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/approve',
    { preHandler: guard, schema: { body: adminApproveQuoteRequestSchema.optional() } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const body = adminApproveQuoteRequestSchema.parse(request.body ?? {});
      const expectedVersion = parseIfMatch(request);
      const rfq = await adminService.approve(ctx, request.params.id, expectedVersion, body.note);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/cancel',
    { preHandler: guard, schema: { body: adminCancelQuoteRequestSchema.optional() } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const body = adminCancelQuoteRequestSchema.parse(request.body ?? {});
      const expectedVersion = parseIfMatch(request);
      const rfq = await adminService.cancel(ctx, request.params.id, expectedVersion, body.reason);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/assign',
    { preHandler: guard, schema: { body: adminAssignQuoteRequestSchema } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const body = adminAssignQuoteRequestSchema.parse(request.body);
      const rfq = await adminService.assign(ctx, request.params.id, body.adminUserId);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );
}
