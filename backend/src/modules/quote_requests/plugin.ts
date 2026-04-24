import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import { RfqService, type RfqEventBus } from './services/rfq-service.js';
import { RfqAdminService } from './services/rfq-admin-service.js';
import {
  registerQuoteRequestsCustomerRoutes,
  type CustomerContextResolver,
  type RequireCustomerGuard,
} from './routes.customer.js';
import {
  registerQuoteRequestsAdminRoutes,
  type AdminContextResolver,
} from './routes.admin.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface QuoteRequestsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  requireCustomer: RequireCustomerGuard;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: CustomerContextResolver;
  resolveAdminContext: AdminContextResolver;
}

export function quoteRequestsModule(options: QuoteRequestsModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const rfqService = new RfqService(options.emFactory, options.eventBus as RfqEventBus);
    const adminService = new RfqAdminService(options.emFactory, options.eventBus as RfqEventBus);

    await registerQuoteRequestsCustomerRoutes(app, {
      rfqService,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
      emFactory: options.emFactory,
    });
    await registerQuoteRequestsAdminRoutes(app, {
      adminService,
      requireAdmin: options.requireAdmin,
      resolveAdminContext: options.resolveAdminContext,
      emFactory: options.emFactory,
    });
  };
}

// Re-export so the composition root can import the types from one place.
export type { CustomerContextResolver, AdminContextResolver, RequireCustomerGuard, FastifyRequest };
