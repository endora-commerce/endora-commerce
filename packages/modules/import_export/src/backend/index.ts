import type {
  CatalogAttributeReadPort,
  CatalogBulkImportPort,
  CatalogCategoryReadPort,
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  InventoryStockImportPort,
  InventoryStockReadPort,
  OrderReadPort,
  OrganizationDetailsPort,
  OrganizationRoleReadPort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type {
  RequireAdminAnyFactory,
  RequireAdminFactory,
  SalesChannelResolutionPort,
} from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { ImportExportService } from './services/import-export-service.js';
import { ImportProfileService } from './services/import-profile.service.js';
import { ImportProfile } from './entities/import-profile.entity.js';
import { registerImportExportRoutes } from './routes.js';

/**
 * `import_export` — the shortest conversion in the wave (feature 072, wave 2,
 * T122).
 *
 * Nothing about it is unusual, which is worth one sentence rather than none:
 * the module took two arguments, both roots passed both, and neither consumed its
 * handle. Feature 174 gave it its first entity and migration (import profiles,
 * `import_profiles`), so it now leaves that table behind when removed.
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
  readonly requireAdminAny: RequireAdminAnyFactory;
  readonly importExportService: ImportExportService;
  readonly importProfileService: ImportProfileService;
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
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
            // Feature 174 — the products file's attributes, channel memberships and channels.
            catalogAttributes: lazyPort<CatalogAttributeReadPort>(ctx, 'catalogAttributeReadPort'),
            catalogAvailability: lazyPort<CatalogProductAvailabilityPort>(ctx, 'catalogProductAvailabilityPort'),
            // A kernel registration: no module edge, nothing to switch off.
            salesChannels: lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort'),
            organizationRoles: lazyPort<OrganizationRoleReadPort>(ctx, 'organizationRoleReadPort'),
          }),
      )
      .singleton(),

    /** Feature 174 (FR-048) — import profiles; every write a Command (Constitution XIII). */
    importProfileService: ctx
      .asFunction(
        ({ emFactory, commandBus }: ImportExportCradle) => new ImportProfileService({ emFactory, commandBus }),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { importExportService, importProfileService, requireAdmin, requireAdminAny } =
      ctx.cradle<ImportExportCradle>();
    // A raw `text/csv` body, so `POST /admin/import/:entity` needs no multipart
    // machinery. Scoped to this module's context by `ctx.routes`.
    if (!app.hasContentTypeParser('text/csv')) {
      app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => {
        done(null, body);
      });
    }
    await registerImportExportRoutes(app, {
      service: importExportService,
      profiles: importProfileService,
      requireAdmin,
      requireAdminAny,
    });
  });
}


/**
 * The module's persisted entity classes (D-168). Feature 174 added the first, the import
 * profile, together with the module's first migration (`./migrations`).
 */
export const entities = [ImportProfile];
