import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Composition root for the comparisons module — feature 007.
 *
 * Phase 2 (foundational) introduces the module shell: a registered
 * Fastify plugin, a typed handle, and the wiring point for the manifest
 * (`comparisonsManifest`, exported from `./manifest.js` and appended to
 * the platform's `settingsManifests` array in `composition.ts`).
 *
 * Per-user-story phases populate the handle:
 *   - US1 (T021–T028): adds {@link ShareTokenGenerator},
 *     {@link ComparableAttributeProjection}, {@link ComparisonService}
 *     and registers `routes.public.ts`.
 *   - US2 (T038–T041): registers `routes.share.ts`.
 *   - US4 (T055–T056): adds {@link ComparisonPdfRenderer} +
 *     {@link AssetByteFetcher} and the `GET /me/pdf` route.
 *   - US5 (T063–T065): adds {@link ComparisonAdminService} and
 *     registers `routes.admin.ts`.
 *
 * Module isolation (Constitution I): the comparisons module reads
 * catalog through `CatalogQueryService` (a documented service port,
 * never internal entity imports), reads settings through
 * `SettingsService.get(...)`, and reads `request.salesChannel` via the
 * sales-channels resolver middleware. It does **not** depend on the
 * carts module — the storefront calls `/cart/items` directly from the
 * comparison page (research.md R-9).
 */

export interface ComparisonsModuleOptions {
  emFactory: () => EntityManager;
}

export interface ComparisonsModuleHandle {
  // Populated by per-user-story phases. Empty in Phase 2.
}

export interface ComparisonsModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: ComparisonsModuleHandle;
}

export function comparisonsModule(
  // Underscore-prefixed because Phase 2 does not yet consume the EM —
  // the route/service tasks in US1 / US2 / US4 / US5 will replace this
  // signature with the live consumers. Keeping the parameter shape now
  // means `composition.ts` does not have to change again when those
  // services land.
  _options: ComparisonsModuleOptions,
): ComparisonsModuleResult {
  return {
    handle: {},
    plugin: async (_app: FastifyInstance): Promise<void> => {
      // Routes are registered by per-user-story phases. The foundational
      // plugin exists so `composition.ts` can wire the module today and
      // every later phase only edits this file.
    },
  };
}
