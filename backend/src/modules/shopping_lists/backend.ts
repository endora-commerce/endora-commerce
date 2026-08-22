import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { CartWritePort, CatalogProductReadPort, RfqCustomerPort } from '@endora-commerce/contracts';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { SalesChannelMembershipPort } from '../../kernel/ports/sales-channel.js';
import { shoppingListsModule, type ShoppingListsModuleOptions } from './plugin.js';
import { ShoppingListService } from './services/shopping-list-service.js';

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
 * The cart write surface is read as a port for the same reason — and deleting
 * the degraded copy this module used to build is the substantive half of that
 * change, not the tidy half.
 *
 * Feature 075 Phase C finished what those port names started. Both service
 * resolutions were *typed* by importing `carts`' and `quote_requests`'
 * classes, so the container name was decoupled and the type was not; they name
 * `CartWritePort` and `RfqCustomerPort` now. The third edge was the real one:
 * `ShoppingListService` queried `catalog`'s `products` table directly, which no
 * gate can reach, so a list kept accepting and converting items out of a
 * `catalog` an operator had switched off.
 */

/** What `shopping_lists` resolves from the container, and the names it owns. */
export interface ShoppingListsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly requireCustomer: ShoppingListsModuleOptions['requireCustomer'];
  readonly customerContextResolver: ShoppingListsModuleOptions['resolveCustomerContext'];
  readonly rfqService: RfqCustomerPort;
  /**
   * The composed cart write surface. Until T136 this module built its own,
   * degraded copy — no pricing, no approval re-arm, no audit row and no
   * recompute-cache invalidation on any line added through save-to-list.
   */
  readonly cartWritePort: CartWritePort;
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
          // Three published ports, never captured: the proxies resolve per
          // call, so a switched-off owner answers 503 `MODULE_DISABLED` at the
          // call rather than through a gate frozen at composition time.
          // `cartWritePort` replaces `cartService`, which handed out the class;
          // it carries the four operations a caller outside `carts` has any
          // business making.
          new ShoppingListService(
            emFactory,
            lazyPort<CartWritePort>(ctx, 'cartWritePort'),
            lazyPort<RfqCustomerPort>(ctx, 'rfqService'),
            lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            // Issue #259 — the channel assortment gate on the save seam. A
            // kernel registration, not a module's, so there is no edge to
            // declare here.
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
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
