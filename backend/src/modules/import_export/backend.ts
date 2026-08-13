import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { ImportExportService } from './services/import-export-service.js';
import { registerImportExportRoutes } from './routes.js';

/**
 * `import_export` — the shortest conversion in the wave (feature 072, wave 2,
 * T122).
 *
 * Nothing about it is unusual, which is worth one sentence rather than none:
 * the module took two arguments, both roots passed both, neither consumed its
 * handle, and it owns no entity and no migration. Deleting the directory now
 * leaves nothing behind at all, so it does not appear in the residue ledger —
 * the fourth module in the transition to reach that state, after
 * `health_checks`, `audit_logs` and `google_tag_manager`.
 *
 * The one thing to preserve is the `text/csv` body parser. It is registered
 * inside `ctx.routes`, which hands this module an **encapsulated** Fastify
 * context, so the parser applies to this module's routes and nowhere else.
 * That is what we want — a CSV parser is not something the rest of the platform
 * should acquire because one admin endpoint accepts a CSV upload — and it is
 * also stricter than the old arrangement, where the plugin was registered onto
 * whatever context a root handed it.
 */

export interface ImportExportCradle {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly importExportService: ImportExportService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    importExportService: ctx
      .asFunction(({ emFactory }: ImportExportCradle) => new ImportExportService(emFactory))
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { importExportService, requireAdmin } = ctx.cradle<ImportExportCradle>();
    // A raw `text/csv` body, so `POST /admin/import/:entity` needs no multipart
    // machinery. Scoped to this module's context by `ctx.routes`.
    if (!app.hasContentTypeParser('text/csv')) {
      app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => {
        done(null, body);
      });
    }
    await registerImportExportRoutes(app, { service: importExportService, requireAdmin });
  });
}
