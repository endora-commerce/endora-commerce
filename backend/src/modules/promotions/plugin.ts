import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PromotionService } from './services/promotion-service.js';
import { registerPromotionRoutes } from './routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { SalesChannelMembershipService } from '../sales_channels/services/sales-channel-membership.service.js';

export interface PromotionsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Feature 005 / T027b — when injected, new Promotions auto-bind to the system default. */
  salesChannelMembership?: SalesChannelMembershipService;
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
  );
  return {
    handle: { promotionService },
    plugin: async (app: FastifyInstance) => {
      await registerPromotionRoutes(app, {
        promotionService,
        requireAdmin: options.requireAdmin,
      });
    },
  };
}
