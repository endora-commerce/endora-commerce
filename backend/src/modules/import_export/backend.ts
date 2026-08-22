import type {
  CatalogBulkImportPort,
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  InventoryStockImportPort,
  InventoryStockReadPort,
  OrderReadPort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
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
  readonly requireAdmin: RequireAdminFactory;
  readonly importExportService: ImportExportService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    /**
     * D-74 — the seven edges, all of them ports now.
     *
     * Each is a `lazyPort`, so the owner's presence gate is asked at the call
     * rather than at construction; the service also probes presence *before* it
     * offers an entity, which is what turns a switched-off owner into an entity
     * this deployment does not have rather than a 503 an operator has to read.
     */
    importExportService: ctx
      .asFunction(
        () =>
          new ImportExportService({
            catalogProducts: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            catalogCategories: lazyPort<CatalogCategoryReadPort>(ctx, 'catalogCategoryReadPort'),
            catalogBulkImport: lazyPort<CatalogBulkImportPort>(ctx, 'catalogBulkImportPort'),
            inventoryStock: lazyPort<InventoryStockReadPort>(ctx, 'inventoryStockReadPort'),
            inventoryStockImport: lazyPort<InventoryStockImportPort>(
              ctx,
              'inventoryStockImportPort',
            ),
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
            organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
          }),
      )
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
