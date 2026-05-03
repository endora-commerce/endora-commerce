import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import { AvailabilityNotificationService } from './services/availability-notification-service.js';
import { WarehouseService } from './services/warehouse-service.js';
import { StockLevelService } from './services/stock-level-service.js';
import { registerInventoryRoutes } from './routes.js';
import { registerInventoryAdminRoutes } from './routes.admin.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Composition root for the inventory module — feature 010.
 *
 * Adds WarehouseService + StockLevelService alongside the existing
 * AvailabilityNotificationService. Routes are registered via the
 * plug-in factory so test harnesses get the same wiring.
 */
export interface InventoryModuleOptions {
  emFactory: () => EntityManager;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** When supplied, the admin stock-level read + set routes are registered. */
  requireAdmin?: RequireAdminFactory;
  /** Optional event bus for `inventory.adjusted.v1` emission. */
  eventBus?: EventBus;
}

export function inventoryModule(options: InventoryModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const availabilityService = new AvailabilityNotificationService(options.emFactory);
    await registerInventoryRoutes(app, {
      availabilityService,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
    });
    if (options.requireAdmin) {
      const warehouseService = new WarehouseService(options.emFactory);
      const stockLevelService = new StockLevelService(options.emFactory, options.eventBus);
      await registerInventoryAdminRoutes(app, {
        emFactory: options.emFactory,
        warehouseService,
        stockLevelService,
        requireAdmin: options.requireAdmin,
      });
    }
  };
}
