import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import { CartService } from '../carts/services/cart-service.js';
import { RfqService, type RfqEventBus } from '../quote_requests/services/rfq-service.js';
import { ShoppingListService } from './services/shopping-list-service.js';
import { QuickOrderCsvImporter } from '../quick_order/services/csv-importer.js';
import { registerShoppingListRoutes } from './routes.js';
import { registerQuickOrderRoutes } from '../quick_order/routes.js';

/**
 * Composition root for the shopping_lists + quick_order modules (US5).
 *
 * Both modules are buyer-facing and need a CustomerContext + the
 * downstream Cart + RFQ services. Cart and RFQ services are stateless
 * (ctor only takes the EM factory + event bus), so we instantiate fresh
 * here rather than threading them through the test-server.
 */

export interface ShoppingListsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

export function shoppingListsModule(options: ShoppingListsModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const cartService = new CartService(options.emFactory);
    const rfqService = new RfqService(options.emFactory, options.eventBus as RfqEventBus);
    const shoppingListService = new ShoppingListService(
      options.emFactory,
      cartService,
      rfqService,
    );
    const csvImporter = new QuickOrderCsvImporter(options.emFactory);

    await registerShoppingListRoutes(app, {
      service: shoppingListService,
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
    });
    await registerQuickOrderRoutes(app, {
      importer: csvImporter,
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
    });
  };
}
