import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CatalogQueryService } from '../catalog/services/catalog-query.service.js';
import type { CatalogAttributeReadService } from '../catalog/services/catalog-attribute-read.service.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { ShareTokenGenerator } from './services/share-token-generator.js';
import { ComparableAttributeProjection } from './services/comparable-attribute-projection.js';
import { ComparisonService } from './services/comparison-service.js';
import { ComparisonAdminService } from './services/comparison-admin.service.js';
import { ComparisonPdfRenderer } from './services/comparison-pdf-renderer.js';
import { registerComparisonsPublicRoutes } from './routes.public.js';
import { registerComparisonsShareRoutes } from './routes.share.js';
import { registerComparisonsAdminRoutes } from './routes.admin.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Composition root for the comparisons module — feature 007.
 *
 * Phase 2 introduced the module shell; US1 (T028) wires the
 * customer-facing CRUD endpoints. Per-story phases extend the handle:
 *
 *   - US2: registers `routes.share.ts`.
 *   - US4: adds {@link ComparisonPdfRenderer} and the `GET /me/pdf` route.
 *   - US5: adds {@link ComparisonAdminService} and `routes.admin.ts`.
 *
 * Module isolation (Constitution I):
 *   - Reads catalog through {@link CatalogQueryService}.
 *   - Reads settings through {@link SettingsService}.
 *   - Reads `request.salesChannel` via the sales-channels resolver.
 *   - Does NOT depend on the carts module — the storefront calls
 *     `/cart/items` directly from the comparison page (research.md R-9).
 */

export interface ComparisonsModuleOptions {
  emFactory: () => EntityManager;
  catalogQueryService: CatalogQueryService;
  /** Feature 061 — the catalog's composed attribute read model (Principle I). */
  catalogAttributeRead?: CatalogAttributeReadService;
  settingsService?: SettingsService;
  /** When provided, admin routes mount under `/api/v1/admin/comparisons/*` (US5). */
  requireAdmin?: RequireAdminFactory;
}

export interface ComparisonsModuleHandle {
  comparisonService: ComparisonService;
  adminService: ComparisonAdminService;
  tokens: ShareTokenGenerator;
  projection: ComparableAttributeProjection;
  pdfRenderer: ComparisonPdfRenderer;
}

export interface ComparisonsModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: ComparisonsModuleHandle;
}

export function comparisonsModule(
  options: ComparisonsModuleOptions,
): ComparisonsModuleResult {
  const tokens = new ShareTokenGenerator();
  const projection = new ComparableAttributeProjection();
  const comparisonService = new ComparisonService(
    options.emFactory,
    options.catalogQueryService,
    projection,
    tokens,
    options.settingsService,
    options.catalogAttributeRead,
  );
  const pdfRenderer = new ComparisonPdfRenderer();
  const adminService = new ComparisonAdminService(
    options.emFactory,
    comparisonService,
  );

  return {
    handle: { comparisonService, adminService, tokens, projection, pdfRenderer },
    plugin: async (app: FastifyInstance): Promise<void> => {
      await registerComparisonsPublicRoutes(app, {
        comparisonService,
        tokens,
        pdfRenderer,
      });
      await registerComparisonsShareRoutes(app, { comparisonService });
      // US5 — admin routes only mount when the gate factory is wired.
      // Foundation tests that omit `requireAdmin` get a backend without
      // the admin surface, which keeps their fixtures small.
      if (options.requireAdmin) {
        await registerComparisonsAdminRoutes(app, {
          adminService,
          requireAdmin: options.requireAdmin,
        });
      }
    },
  };
}
