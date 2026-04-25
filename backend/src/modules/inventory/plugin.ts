import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AvailabilityNotificationService } from './services/availability-notification-service.js';
import { registerInventoryRoutes } from './routes.js';

/** Composition root for the inventory module (US1 polish). */
export interface InventoryModuleOptions {
  emFactory: () => EntityManager;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

export function inventoryModule(options: InventoryModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const availabilityService = new AvailabilityNotificationService(options.emFactory);
    await registerInventoryRoutes(app, {
      availabilityService,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
    });
  };
}
