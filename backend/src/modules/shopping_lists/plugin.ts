import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { CartService } from '../carts/services/cart-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';
import { ShoppingListService } from './services/shopping-list-service.js';
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
   * Feature 072 (T136) — the composed `CartService`, resolved as a port.
   *
   * This module used to build its own with `new CartService(options.emFactory)`
   * — no pricing service, no approval service, no audit service, no recompute
   * cache. Every line added through save-to-list, quick-order import or
   * one-click buy therefore skipped the pending-approval re-arm, wrote no cart
   * audit row, and left `b2b:cart:recompute:*` un-invalidated, so the *other*
   * instance kept serving a stale recomputed cart for the cache TTL. A shipped
   * defect, not a composition-shape smell.
   */
  cartService: CartService;
  rfqService: RfqService;
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
  /**
   * In-process event bus. When supplied, the module subscribes to
   * `customer_account.created.v1` and eagerly provisions the new customer's
   * default shopping list (otherwise the list is created lazily on first read).
   */
  eventBus?: EventBus;
}

export function shoppingListsModule(options: ShoppingListsModuleOptions) {
  const cartService = options.cartService;

  return async (app: FastifyInstance): Promise<void> => {
    const shoppingListService = new ShoppingListService(
      options.emFactory,
      cartService,
      options.rfqService,
    );
    if (options.exposeShoppingListService) options.exposeShoppingListService(shoppingListService);

    // Eagerly provision a "Default" shopping list when an org-attached customer
    // is created (registration / admin direct-create / invitation accept), so
    // the list exists immediately instead of only on first storefront read.
    // `ensureDefault` is idempotent, so a redundant event is harmless.
    options.eventBus?.on('customer_account.created.v1', async (payload) => {
      const { customerAccountId, organizationId } = payload as unknown as {
        customerAccountId: string;
        organizationId: string;
      };
      await shoppingListService.ensureDefault({ customerAccountId, organizationId });
    });

    await registerShoppingListRoutes(app, {
      service: shoppingListService,
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
    });
  };
}
