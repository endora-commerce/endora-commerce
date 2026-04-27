import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PromotionService } from './services/promotion-service.js';
import { registerPromotionRoutes } from './routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface PromotionsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

export interface PromotionsModuleHandle {
  promotionService: PromotionService;
}

export function promotionsModule(options: PromotionsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: PromotionsModuleHandle;
} {
  const promotionService = new PromotionService(options.emFactory);
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
