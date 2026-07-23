import type { FastifyInstance } from 'fastify';
import type { ImportExportService } from './services/import-export-service.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface ImportExportRoutesDeps {
  service: ImportExportService;
  requireAdmin: RequireAdminFactory;
}

const FILENAME_RE = /^[a-z][a-z0-9_]*$/;

export async function registerImportExportRoutes(
  app: FastifyInstance,
  deps: ImportExportRoutesDeps,
): Promise<void> {
  const { service, requireAdmin } = deps;

  app.get<{ Params: { entity: string } }>(
    '/api/v1/admin/export/:entity.csv',
    { preHandler: requireAdmin('catalog:write'), config: { streamingResponse: true } },
    async (request, reply) => {
      const { entity } = request.params;
      if (!FILENAME_RE.test(entity)) {
        reply.status(400);
        return { error: { code: 'VALIDATION_FAILED', message: 'invalid entity slug' } };
      }
      const body = await service.exportToCsv(entity);
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="${entity}-${new Date().toISOString().slice(0, 10)}.csv"`,
        );
      return body;
    },
  );

  app.post<{ Params: { entity: string }; Body: string }>(
    '/api/v1/admin/import/:entity',
    {
      preHandler: requireAdmin('catalog:write'),
      // Receive the raw CSV body — operators can `curl --data-binary @file.csv`
      // and the admin SPA can read the file as text and POST it directly.
    },
    async (request, reply) => {
      const { entity } = request.params;
      if (!FILENAME_RE.test(entity)) {
        reply.status(400);
        return { error: { code: 'VALIDATION_FAILED', message: 'invalid entity slug' } };
      }
      const body =
        typeof request.body === 'string'
          ? request.body
          : (request.body as unknown as Buffer | undefined)?.toString('utf8') ?? '';
      const report = await service.importFromCsv(entity, body);
      return { data: report };
    },
  );
}
