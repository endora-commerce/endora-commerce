import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { DictionaryValidator } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelResolverService } from '../../kernel/sales-channels/sales-channel-resolver.service.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { inventoryModule, type InventoryModuleOptions } from './plugin.js';

/**
 * `inventory` — three capabilities the test harness never had (feature 072,
 * wave 3, T129).
 *
 * Production passed `eventBus`, `channelResolver` and `settingsService`; the
 * harness passed none of the three, and each is guarded by an `if` inside the
 * factory. So in every test run the availability worker never attached, the
 * threshold-settings mirror never ran, and a storefront stock read never scoped
 * its candidate warehouses to the caller's channel binding. Three behaviours
 * this module exists to have, exercised by nothing — and no test could have
 * noticed, because the shape that omits them is the shape the tests compose.
 *
 * All three are unconditional now, which is the point of the conversion rather
 * than a side effect of it: a module that reads the event bus reads it in every
 * composition, and the subscription goes through `ctx.subscribe` so it stops
 * when the module does.
 *
 * `dictionaryValidator` was optional and **passed by neither root**, so
 * warehouse country codes have never been validated against the dictionary
 * registry. It is a declared dependency now — the same finding `sales_channels`
 * produced in T110, in a second module.
 *
 * `templateEmail` and `resolveOrganizationWarehouseAllowList` stay contributed.
 * The first is built over `transactional_emails`' late-announced sender, the
 * second over `organizations`' warehouse assignment — both are adapters a root
 * builds across a boundary this module must not reach through.
 */

/** What `inventory` resolves from the container, and the names it owns. */
export interface InventoryCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: InventoryModuleOptions['requireCustomer'];
  readonly customerContextResolver: InventoryModuleOptions['resolveCustomerContext'];
  readonly settingsReadPort: SettingsService;
  readonly salesChannelResolutionPort: SalesChannelResolverService;
  readonly settingsChannelResolver: () => Promise<string | null>;
  readonly dictionaryValidator: DictionaryValidator;
  /** Root-shaped: the two compositions name a non-admin caller differently. */
  readonly inventoryAdminAuditContext: NonNullable<
    InventoryModuleOptions['resolveAdminAuditContext']
  >;
  /** Contributed: built over `transactional_emails`' late-announced sender. */
  readonly inventoryTemplateEmail: NonNullable<InventoryModuleOptions['templateEmail']>;
  /** Contributed: built over `organizations`' warehouse assignment. */
  readonly inventoryWarehouseAllowList: NonNullable<
    InventoryModuleOptions['resolveOrganizationWarehouseAllowList']
  >;
  readonly inventory: ReturnType<typeof inventoryModule>;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    inventory: ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: InventoryCradle) =>
        inventoryModule({
          emFactory,
          eventBus,
          auditLogService,
          settingsService: lazyPort<SettingsService>(ctx, 'settingsReadPort'),
          channelResolver: lazyPort<SalesChannelResolverService>(
            ctx,
            'salesChannelResolutionPort',
          ),
          dictionaryValidator: lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<InventoryCradle>().requireAdmin(permission)(req, reply),
          requireCustomer: (req, reply) =>
            ctx.cradle<InventoryCradle>().requireCustomer(req, reply),
          resolveCustomerContext: (req: FastifyRequest) =>
            ctx.cradle<InventoryCradle>().customerContextResolver(req),
          resolveSystemDefaultChannelId: () =>
            ctx.cradle<InventoryCradle>().settingsChannelResolver(),
          resolveAdminAuditContext: (req: FastifyRequest) =>
            ctx.cradle<InventoryCradle>().inventoryAdminAuditContext(req),
          templateEmail: {
            trySend: (input: Parameters<
              NonNullable<InventoryModuleOptions['templateEmail']>['trySend']
            >[0]) => ctx.cradle<InventoryCradle>().inventoryTemplateEmail.trySend(input),
          },
          resolveOrganizationWarehouseAllowList: (req: FastifyRequest) =>
            ctx.cradle<InventoryCradle>().inventoryWarehouseAllowList(req),
        }),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    await ctx.cradle<InventoryCradle>().inventory(app);
  });
}
