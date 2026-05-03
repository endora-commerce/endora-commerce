import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CartService } from '../carts/services/cart-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';
import { ShoppingListService } from './services/shopping-list-service.js';
import { QuickOrderCsvImporter } from '../quick_order/services/csv-importer.js';
import { registerShoppingListRoutes } from './routes.js';
import { registerQuickOrderRoutes } from '../quick_order/routes.js';

/**
 * Composition root for the shopping_lists + quick_order modules (US5).
 *
 * `rfqService` is injected (built by the quote_requests module) so the
 * shopping-list "convert to RFQ" flow uses the same one-call
 * `createForCustomer` API as the storefront, with revisions, events,
 * and notifications wired in (feature 008).
 */

export interface ShoppingListsModuleOptions {
  emFactory: () => EntityManager;
  rfqService: RfqService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

export function shoppingListsModule(options: ShoppingListsModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const cartService = new CartService(options.emFactory);
    const shoppingListService = new ShoppingListService(
      options.emFactory,
      cartService,
      options.rfqService,
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
