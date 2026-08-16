import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import { shoppingListsModule, type ShoppingListsModuleOptions } from './plugin.js';
import { ShoppingListService } from './services/shopping-list-service.js';
import type { CartService } from '../carts/services/cart-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';

/**
 * `shopping_lists` — six optional options that decided which routes exist
 * (feature 072, wave 3, T133).
 *
 * `requireAdmin`, `auditLog`, `getOrderService` and `resolveOneClickEnabled`
 * did not merely change behaviour when omitted: each gates a *route group*, so
 * absence silently produced a module with fewer endpoints. Both compositions
 * passed all four, so the reduced shape was never anyone's deployment — but it
 * was reachable by forgetting an argument, which is the thing these conversions
 * remove.
 *
 * T139 took most of that with it. Six of those options — and three more —
 * existed only to serve the `quick_order` surfaces this module mounted, and
 * they moved to that module when it became a lifecycle participant of its own.
 * What is left is a module with one route file and one service.
 *
 * One name stays a composition's, and it is a genuine cross-module reach this
 * module must not make directly: the RFQ service it converts a list into.
 *
 * The third is gone. `exposeShoppingListService` was a contribution pointing
 * *outward*, and T136 inverted it: `carts` owns the bridge now and this module
 * provides `shoppingListService` as an ordinary port, which is what the comment
 * here predicted would happen when `carts` converted.
 *
 * `cartService` is read as a port for the same reason — and deleting the
 * degraded copy this module used to build is the substantive half of that
 * change, not the tidy half.
 */

/** What `shopping_lists` resolves from the container, and the names it owns. */
export interface ShoppingListsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly requireCustomer: ShoppingListsModuleOptions['requireCustomer'];
  readonly customerContextResolver: ShoppingListsModuleOptions['resolveCustomerContext'];
  readonly rfqService: RfqService;
  /**
   * The composed cart service. Until T136 this module built its own, degraded
   * copy — no pricing, no approval re-arm, no audit row and no recompute-cache
   * invalidation on any line added through save-to-list.
   */
  readonly cartService: CartService;
  /** This module's one service; the subscription below reads it per event. */
  readonly shoppingListService: ShoppingListService;
  /** Contribution outward: `carts` reads the service through this until it converts. */
  readonly shoppingListServiceSink: (service: ShoppingListService) => void;
  readonly shoppingLists: ReturnType<typeof shoppingListsModule>;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Contribution point, defaulted to a no-op: a composition with no `carts`
    // save-to-list bridge simply never asks for the service.
    shoppingListServiceSink: ctx
      .asFunction((): ShoppingListsCradle['shoppingListServiceSink'] => () => undefined)
      .singleton(),

    shoppingListService: ctx
      .asFunction(
        ({ emFactory }: ShoppingListsCradle) =>
          new ShoppingListService(
            emFactory,
            lazyPort<CartService>(ctx, 'cartService'),
            lazyPort<RfqService>(ctx, 'rfqService'),
          ),
      )
      .singleton(),

    shoppingLists: ctx
      .asFunction(({ emFactory, shoppingListService }: ShoppingListsCradle) =>
        shoppingListsModule({
          emFactory,
          shoppingListService,
          requireCustomer: (req, reply) =>
            ctx.cradle<ShoppingListsCradle>().requireCustomer(req, reply),
          resolveCustomerContext: (req: FastifyRequest) =>
            ctx.cradle<ShoppingListsCradle>().customerContextResolver(req),
          exposeShoppingListService: (service) => {
            ctx.cradle<ShoppingListsCradle>().shoppingListServiceSink(service);
          },
        }),
      )
      .singleton(),
  });

  /**
   * Eagerly provision a "Default" shopping list when an org-attached customer is
   * created — registration, admin direct-create, invitation accept — so the list
   * exists immediately instead of only on first storefront read. `ensureDefault`
   * is idempotent, so a redundant event is harmless.
   *
   * It was a bare `eventBus.on` inside the route registrar, so a switched-off
   * `shopping_lists` still created rows in its own tables while every route that
   * could show them refused (issue #107).
   */
  ctx.subscribe('customer_account.created.v1', async (payload) => {
    const { customerAccountId, organizationId } = payload as {
      customerAccountId: string;
      organizationId: string;
    };
    await ctx
      .cradle<ShoppingListsCradle>()
      .shoppingListService.ensureDefault({ customerAccountId, organizationId });
  });

  ctx.routes(async (app) => {
    await ctx.cradle<ShoppingListsCradle>().shoppingLists(app);
  });
}
