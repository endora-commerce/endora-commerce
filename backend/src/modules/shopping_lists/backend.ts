import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import { shoppingListsModule, type ShoppingListsModuleOptions } from './plugin.js';
import type { ShoppingListService } from './services/shopping-list-service.js';

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
  readonly eventBus: EventBus;
  readonly auditLogService: AuditLogService;
  readonly requireCustomer: ShoppingListsModuleOptions['requireCustomer'];
  readonly customerContextResolver: ShoppingListsModuleOptions['resolveCustomerContext'];
  readonly rfqService: ShoppingListsModuleOptions['rfqService'];
  /**
   * The composed cart service. Until T136 this module built its own, degraded
   * copy — see the option's own comment for what that skipped.
   */
  readonly cartService: ShoppingListsModuleOptions['cartService'];
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

    shoppingLists: ctx
      .asFunction(({ emFactory, eventBus }: ShoppingListsCradle) =>
        shoppingListsModule({
          emFactory,
          eventBus,
          rfqService: lazyPort<ShoppingListsCradle['rfqService']>(ctx, 'rfqService'),
          cartService: lazyPort<ShoppingListsCradle['cartService']>(ctx, 'cartService'),
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

  ctx.routes(async (app) => {
    await ctx.cradle<ShoppingListsCradle>().shoppingLists(app);
  });
}
