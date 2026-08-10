import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ImportExportService } from './services/import-export-service.js';
import { registerImportExportRoutes } from './routes.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface ImportExportModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

export interface ImportExportModuleHandle {
  service: ImportExportService;
}

export function importExportModule(options: ImportExportModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: ImportExportModuleHandle;
} {
  const service = new ImportExportService(options.emFactory);
  return {
    handle: { service },
    plugin: async (app: FastifyInstance) => {
      // Register a CSV body parser so POST /admin/import/:entity can receive
      // a raw text/csv body without multipart machinery.
      if (!app.hasContentTypeParser('text/csv')) {
        app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => {
          done(null, body);
        });
      }
      await registerImportExportRoutes(app, {
        service,
        requireAdmin: options.requireAdmin,
      });
    },
  };
}
