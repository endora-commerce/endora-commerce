// `config: { rateLimit }` is a declaration-merging augmentation of
// `@fastify/rate-limit`, which the host registers globally (see
// `routes.customer.ts`).
import type {} from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  quoteRequestPdfQuerySchema,
  quoteRequestPdfSendRequestSchema,
  setQuoteRequestDocumentTemplateSchema,
  type Actor,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { QuoteRequestDocumentService } from './document/document-service.js';
import type { AdminContextResolver } from './routes.admin.js';

/**
 * The quote PDF's four admin routes
 * (`specs/153-quote-request-pdf-template/contracts/quote-request-document.md` §6).
 *
 * Every one is behind `rfqs:handle` as its `preHandler`, so a caller without it
 * is answered 401/403 before its input is validated, and behind the quote's
 * visibility (an invisible quote is an unknown one, 404). None probes
 * `document_templates`: the service resolves its gated port per request, so
 * while the facility is off every route answers 503 `MODULE_DISABLED`.
 */

export interface QuoteRequestDocumentRouteDeps {
  readonly service: QuoteRequestDocumentService;
  readonly requireAdmin: RequireAdminFactory;
  readonly resolveAdminContext: AdminContextResolver;
}

/** Sends per administrator per minute (owner answer Q4, FR-098). */
export const QUOTE_REQUEST_PDF_SEND_RATE_LIMIT = {
  max: 10,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (request: FastifyRequest): string => {
    const actor = request.actor as Actor | undefined;
    return `quote-request-pdf-send:${actor?.kind === 'admin' ? actor.adminUserId : request.ip}`;
  },
};

/**
 * The id is not checked for shape here: a malformed id names no quote request,
 * so the service answers it with the same `404` as an unknown one (issue #781),
 * where a params schema would answer `400`.
 */
const params = z.object({ id: z.string() });
const NO_STORE = 'private, no-store';

export async function registerQuoteRequestDocumentRoutes(
  app: FastifyInstance,
  deps: QuoteRequestDocumentRouteDeps,
): Promise<void> {
  const { service, requireAdmin, resolveAdminContext } = deps;
  const guard = requireAdmin('rfqs:handle');
  const base = '/api/v1/admin/quote-requests/:id';

  // Q1
  app.get(`${base}/document-templates`, { preHandler: guard, schema: { params } }, async (request, reply) => {
    const ctx = await resolveAdminContext(request);
    const { id } = params.parse(request.params);
    reply.header('Cache-Control', NO_STORE);
    return { data: await service.choices(ctx, id) };
  });

  // Q2
  app.put(
    `${base}/document-template`,
    { preHandler: guard, schema: { params, body: setQuoteRequestDocumentTemplateSchema } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const { id } = params.parse(request.params);
      const body = setQuoteRequestDocumentTemplateSchema.parse(request.body);
      reply.header('Cache-Control', NO_STORE);
      return { data: await service.remember(ctx, id, body.documentTemplateId) };
    },
  );

  // Q3
  app.get(
    `${base}/pdf`,
    { preHandler: guard, schema: { params, querystring: quoteRequestPdfQuerySchema } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const { id } = params.parse(request.params);
      const query = quoteRequestPdfQuerySchema.parse(request.query ?? {});
      const rendered = await service.render(ctx, id, query);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${rendered.fileName}"`)
        .header('Cache-Control', NO_STORE)
        .header('X-Document-Template-Id', rendered.result.templateId ?? '')
        .header('X-Document-Template-Version', rendered.result.templateVersion === null ? '' : String(rendered.result.templateVersion))
        .header('X-Document-Template-Source', rendered.result.source)
        .header('X-Document-Template-Missing', String(rendered.result.requestedTemplateMissing));
      return reply.send(Buffer.from(rendered.result.bytes));
    },
  );

  // Q4 — owner answer Q4.
  app.post(
    `${base}/pdf/send`,
    {
      preHandler: guard,
      schema: { params, body: quoteRequestPdfSendRequestSchema },
      config: { rateLimit: QUOTE_REQUEST_PDF_SEND_RATE_LIMIT },
    },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const { id } = params.parse(request.params);
      const body = quoteRequestPdfSendRequestSchema.parse(request.body);
      reply.header('Cache-Control', NO_STORE);
      return { data: await service.send(ctx, id, body) };
    },
  );
}
