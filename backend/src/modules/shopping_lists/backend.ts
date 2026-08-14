import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { QUICK_ORDER_SETTING_CODES } from '../quick_order/manifest.js';
import type { FastifyRequest } from 'fastify';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
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
 * `settingsService` is the one the harness omitted, so the `quick_order`
 * import-row cap fell back to its manifest default in every test while
 * production read it per channel. The same shape `inventory` had in T129, and
 * the reason it is worth naming twice: an option that "falls back to the
 * manifest default when omitted (e.g. minimal test harnesses)" describes the
 * test composition as the exception, when the test composition is the one that
 * should look like production.
 *
 * Two names stay a composition's, and each is a genuine cross-module reach this
 * module must not make directly: the RFQ service it converts a list into, and
 * the order service one-click buy places through.
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
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: ShoppingListsModuleOptions['requireCustomer'];
  readonly customerContextResolver: ShoppingListsModuleOptions['resolveCustomerContext'];
  readonly adminContextResolver: NonNullable<ShoppingListsModuleOptions['resolveAdminContext']>;
  readonly settingsReadPort: SettingsService;
  readonly settingsChannelResolver: () => Promise<string | null>;
  readonly catalogAttributeReadPort: ShoppingListsModuleOptions['catalogAttributeRead'];
  readonly rfqService: ShoppingListsModuleOptions['rfqService'];
  /**
   * The composed cart service. Until T136 this module built its own, degraded
   * copy — see the option's own comment for what that skipped.
   */
  readonly cartService: ShoppingListsModuleOptions['cartService'];
  readonly organizationRestrictionPort: NonNullable<
    ShoppingListsModuleOptions['organizationRestriction']
  >;
  /** Late-bound: `orders` builds it, and it is null until then. */
  readonly oneClickOrderServiceGetter: NonNullable<
    ShoppingListsModuleOptions['getOrderService']
  >;
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
      .asFunction(({ emFactory, eventBus, auditLogService }: ShoppingListsCradle) =>
        shoppingListsModule({
          emFactory,
          eventBus,
          auditLog: auditLogService,
          settingsService: lazyPort<SettingsService>(ctx, 'settingsReadPort'),
          catalogAttributeRead: lazyPort<ShoppingListsCradle['catalogAttributeReadPort']>(
            ctx,
            'catalogAttributeReadPort',
          ),
          rfqService: lazyPort<ShoppingListsCradle['rfqService']>(ctx, 'rfqService'),
          cartService: lazyPort<ShoppingListsCradle['cartService']>(ctx, 'cartService'),
          organizationRestriction: lazyPort<
            ShoppingListsCradle['organizationRestrictionPort']
          >(ctx, 'organizationRestrictionPort'),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<ShoppingListsCradle>().requireAdmin(permission)(req, reply),
          requireCustomer: (req, reply) =>
            ctx.cradle<ShoppingListsCradle>().requireCustomer(req, reply),
          resolveCustomerContext: (req: FastifyRequest) =>
            ctx.cradle<ShoppingListsCradle>().customerContextResolver(req),
          resolveAdminContext: (req: FastifyRequest) =>
            ctx.cradle<ShoppingListsCradle>().adminContextResolver(req),
          getOrderService: () => ctx.cradle<ShoppingListsCradle>().oneClickOrderServiceGetter(),
          // This module's own setting, so it reads it itself rather than taking
          // a resolver from a root — which is where the identical
          // try/catch-to-false lived in both compositions before T133.
          resolveOneClickEnabled: async (salesChannelId: string) => {
            try {
              return await ctx
                .cradle<ShoppingListsCradle>()
                .settingsReadPort.get(
                  QUICK_ORDER_SETTING_CODES.ONE_CLICK_BUY_ENABLED,
                  salesChannelId,
                  z.boolean(),
                );
            } catch {
              return false;
            }
          },
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
