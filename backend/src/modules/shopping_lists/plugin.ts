import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ShoppingListService } from './services/shopping-list-service.js';
import { registerShoppingListRoutes } from './routes.js';

/**
 * Composition root for `shopping_lists`.
 *
 * It used to be the composition root for `quick_order` as well — two lifecycle
 * participants behind one factory, so neither had presence of its own. Feature
 * 072 (T139) moved that module's five route groups and four services into its
 * own `backend.ts`, where three nested `if (options.…)` conditionals that
 * decided which of its endpoints existed became unconditional registrations.
 *
 * `rfqService` is injected (built by the quote_requests module) so the
 * shopping-list "convert to RFQ" flow uses the one-call `createForCustomer`
 * API, with revisions, events and notifications wired in (feature 008).
 */

export interface ShoppingListsModuleOptions {
  emFactory: () => EntityManager;
  /**
   * The module's one service, built in `backend.ts` (issue #107).
   *
   * It used to be constructed here, inside the route registrar, which is why the
   * `customer_account.created.v1` reaction had to be a bare `eventBus.on`: this
   * was the only place holding the instance. It is a container registration now,
   * so the subscription can live at the seam that gates it.
   */
  shoppingListService: ShoppingListService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /**
   * Feature 027 — exposes the ShoppingListService back to commerceModule so
   * its `/api/v1/cart/items/:itemId/save-to-shopping-list` endpoint can
   * push lines into a list (cross-module call through this public
   * service, not via direct entity access).
   */
  exposeShoppingListService?: (service: ShoppingListService) => void;
  // Nine options lived here until T139 and every one of them served the
  // `quick_order` surfaces this module used to mount: the settings service and
  // channel for the import cap, `requireAdmin` for the admin on-behalf routes,
  // `auditLog` + `organizationRestriction` + `resolveAdminContext` for the
  // preference routes, and `getOrderService` + `resolveOneClickEnabled` for
  // one-click buy. They moved with the module that reads them.
}

export function shoppingListsModule(options: ShoppingListsModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const shoppingListService = options.shoppingListService;
    if (options.exposeShoppingListService) options.exposeShoppingListService(shoppingListService);

    await registerShoppingListRoutes(app, {
      service: shoppingListService,
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
    });
  };
}
