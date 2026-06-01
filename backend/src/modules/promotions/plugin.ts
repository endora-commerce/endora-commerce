import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PromotionService } from './services/promotion-service.js';
import { registerPromotionRoutes } from './routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { SalesChannelMembershipService } from '../sales_channels/services/sales-channel-membership.service.js';
import type { CatalogQueryService } from '../catalog/services/catalog-query.service.js';
import type { DictionaryValidator } from '@b2b/contracts';

export interface PromotionsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Feature 005 / T027b — when injected, new Promotions auto-bind to the system default. */
  salesChannelMembership?: SalesChannelMembershipService;
  /**
   * Feature 012 / US8 — cross-module read port. When provided, the
   * promotions module can validate `attribute` criteria against the
   * catalog's authoritative metadata and feed the rule-target picker
   * endpoint.
   */
  catalogQueryService?: CatalogQueryService;
  dictionaryValidator?: DictionaryValidator;
  /**
   * Feature 026 US5 — Resolver returning the current `status` of an
   * Organization. When wired, org-targeted promotions only apply if the
   * Organization is `active`. Defaults to "skip" the gate when omitted
   * (legacy composition).
   */
  resolveOrganizationStatus?: (orgId: string) => Promise<string | null>;
}

export interface PromotionsModuleHandle {
  promotionService: PromotionService;
}

export function promotionsModule(options: PromotionsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: PromotionsModuleHandle;
} {
  const promotionService = new PromotionService(
    options.emFactory,
    options.salesChannelMembership,
    options.catalogQueryService,
    options.dictionaryValidator,
    undefined, // auditLogger — default console
    options.resolveOrganizationStatus,
  );
  return {
    handle: { promotionService },
    plugin: async (app: FastifyInstance) => {
      await registerPromotionRoutes(app, {
        promotionService,
        requireAdmin: options.requireAdmin,
        ...(options.catalogQueryService
          ? { catalogQueryService: options.catalogQueryService }
          : {}),
      });
    },
  };
}
