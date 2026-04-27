import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerGroupService } from './services/customer-group-service.js';
import { PriceListService } from './services/price-list-service.js';
import { PricingService } from './services/pricing-service.js';
import { registerPricingRoutes } from './routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface PriceListsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

export interface PriceListsModuleHandle {
  customerGroupService: CustomerGroupService;
  priceListService: PriceListService;
  pricingService: PricingService;
}

export function priceListsModule(options: PriceListsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: PriceListsModuleHandle;
} {
  const customerGroupService = new CustomerGroupService(options.emFactory);
  const priceListService = new PriceListService(options.emFactory);
  const pricingService = new PricingService(options.emFactory);

  return {
    handle: { customerGroupService, priceListService, pricingService },
    plugin: async (app: FastifyInstance) => {
      await registerPricingRoutes(app, {
        customerGroupService,
        priceListService,
        pricingService,
        emFactory: options.emFactory,
        requireAdmin: options.requireAdmin,
      });
    },
  };
}
