import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CatalogQueryService } from '../catalog/services/catalog-query.service.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import { ShareTokenGenerator } from './services/share-token-generator.js';
import { ComparableAttributeProjection } from './services/comparable-attribute-projection.js';
import { ComparisonService } from './services/comparison-service.js';
import { ComparisonPdfRenderer } from './services/comparison-pdf-renderer.js';
import { registerComparisonsPublicRoutes } from './routes.public.js';
import { registerComparisonsShareRoutes } from './routes.share.js';

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
  settingsService?: SettingsService;
}

export interface ComparisonsModuleHandle {
  comparisonService: ComparisonService;
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
  );
  const pdfRenderer = new ComparisonPdfRenderer();

  return {
    handle: { comparisonService, tokens, projection, pdfRenderer },
    plugin: async (app: FastifyInstance): Promise<void> => {
      await registerComparisonsPublicRoutes(app, {
        comparisonService,
        tokens,
        pdfRenderer,
      });
      await registerComparisonsShareRoutes(app, { comparisonService });
    },
  };
}
