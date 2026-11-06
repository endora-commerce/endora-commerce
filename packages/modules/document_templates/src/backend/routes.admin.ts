import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createDocumentTemplateBodySchema,
  deleteDocumentTemplateBodySchema,
  documentLanguageRe,
  documentTemplateListQuerySchema,
  documentTypeCodeSchema,
  previewDocumentBodySchema,
  renameDocumentTemplateBodySchema,
  saveDocumentTemplateContentBodySchema,
  versionedBodySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { DocumentTemplateService } from './services/document-template-service.js';

/**
 * `/api/v1/admin/document-templates*` — the twelve routes of
 * `specs/152-compare-pdf-template/contracts/document-templates-api.md`.
 *
 * Registered through `ctx.routes`, so a switched-off facility answers 503
 * `MODULE_DISABLED` on all of them. The permission is each route's
 * `preHandler`, so a caller without it is answered 401/403 before its input is
 * validated. Reads — the preview included — need `document_templates:read`;
 * every write needs `document_templates:write`.
 *
 * `types` is a static segment registered before `/:id`, and every `:id` is a
 * uuid, so the two never meet.
 */

export interface DocumentTemplatesRouteDeps {
  readonly service: DocumentTemplateService;
  readonly requireAdmin: RequireAdminFactory;
}

const READ = 'document_templates:read';
const WRITE = 'document_templates:write';
const NO_STORE = 'private, no-store';

/**
 * The id is not checked for shape here: a malformed id names no template, so
 * the service answers it with the same `404` as an unknown one (issue #781),
 * where a params schema would answer `400`.
 */
const idParams = z.object({ id: z.string() });
const typeParams = z.object({ code: documentTypeCodeSchema });
const contentParams = z.object({ id: z.string(), language: z.string().regex(documentLanguageRe) });
const typeQuery = z.object({ language: z.string().regex(documentLanguageRe).optional() });

export async function registerDocumentTemplatesAdminRoutes(
  app: FastifyInstance,
  deps: DocumentTemplatesRouteDeps,
): Promise<void> {
  const { service, requireAdmin } = deps;
  const base = '/api/v1/admin/document-templates';

  // 1
  app.get(`${base}/types`, { preHandler: requireAdmin(READ) }, async (_request, reply) => {
    reply.header('Cache-Control', NO_STORE);
    return { data: await service.listTypes() };
  });

  // 2
  app.get(`${base}/types/:code`, { preHandler: requireAdmin(READ) }, async (request, reply) => {
    const { code } = typeParams.parse(request.params);
    const { language } = typeQuery.parse(request.query ?? {});
    reply.header('Cache-Control', NO_STORE);
    return { data: await service.getType(code, language) };
  });

  // 3
  app.get(`${base}/types/:code/builder-config`, { preHandler: requireAdmin(READ) }, async (request, reply) => {
    const { code } = typeParams.parse(request.params);
    reply.header('Cache-Control', NO_STORE);
    return { data: service.builderConfig(code) };
  });

  // 4
  app.get(base, { preHandler: requireAdmin(READ) }, async (request, reply) => {
    const query = documentTemplateListQuerySchema.parse(request.query ?? {});
    reply.header('Cache-Control', NO_STORE);
    return { data: await service.list(query) };
  });

  // 12 — before `/:id` only for readability; `preview` is not a uuid.
  app.post(
    `${base}/preview`,
    { preHandler: requireAdmin(READ), config: { streamingResponse: true } },
    async (request, reply) => {
      const body = previewDocumentBodySchema.parse(request.body ?? {});
      const bytes = await service.preview(body);
      reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', 'inline; filename="preview.pdf"')
        .header('Cache-Control', 'no-store');
      return reply.send(Buffer.from(bytes));
    },
  );

  // 5
  app.get(`${base}/:id`, { preHandler: requireAdmin(READ) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.header('Cache-Control', NO_STORE);
    return { data: await service.get(id) };
  });

  // 6
  app.post(base, { preHandler: requireAdmin(WRITE) }, async (request, reply) => {
    const body = createDocumentTemplateBodySchema.parse(request.body ?? {});
    const data = await service.create(body);
    reply.status(201);
    return { data };
  });

  // 7
  app.patch(`${base}/:id`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = renameDocumentTemplateBodySchema.parse(request.body ?? {});
    return { data: await service.rename(id, body) };
  });

  // 8
  app.put(`${base}/:id/content/:language`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { id, language } = contentParams.parse(request.params);
    const body = saveDocumentTemplateContentBodySchema.parse(request.body ?? {});
    return { data: await service.saveContent(id, language, body) };
  });

  // 9
  app.post(`${base}/:id/set-default`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = versionedBodySchema.parse(request.body ?? {});
    return { data: await service.setDefault(id, body) };
  });

  // 10
  app.post(`${base}/:id/clear-default`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = versionedBodySchema.parse(request.body ?? {});
    return { data: await service.clearDefault(id, body) };
  });

  // 11 — the two fields travel in the body or, for a client that sends no body
  // with DELETE (the admin's own API client), as query parameters.
  app.delete(`${base}/:id`, { preHandler: requireAdmin(WRITE) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const raw =
      request.body && typeof request.body === 'object' && Object.keys(request.body).length > 0
        ? request.body
        : {
            ...(query['expectedVersion'] !== undefined ? { expectedVersion: Number(query['expectedVersion']) } : {}),
            ...(query['confirmDefault'] !== undefined ? { confirmDefault: query['confirmDefault'] === 'true' } : {}),
          };
    const body = deleteDocumentTemplateBodySchema.parse(raw);
    await service.delete(id, body);
    reply.status(204);
    return null;
  });
}
