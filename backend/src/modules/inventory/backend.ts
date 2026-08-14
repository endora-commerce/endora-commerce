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
import { StockLevelService } from './services/stock-level-service.js';
import { WarehouseChannelService } from './services/warehouse-channel-service.js';
import { WarehouseChannelReconciler } from './services/warehouse-channel-reconciler.js';
import { AVAILABILITY_BACK_IN_STOCK_DEFAULT, LOW_STOCK_ALERT_DEFAULT } from './email-templates/transactional-defaults.js';
import type { EmailDefaultsRegistry } from '../transactional_emails/services/email-defaults-registry.js';

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
  /**
   * `transactional_emails`' shared template adapter (T120). It used to be
   * `inventoryTemplateEmail`, built by each root from a helper `organizations`
   * owned and passed down — one converted module's helper reaching another
   * through the composition root.
   */
  readonly templateEmailPort: NonNullable<InventoryModuleOptions['templateEmail']>;
  /** The two halves the warehouse allow-list is composed from (T138). */
  readonly customerOrganizationIdResolver: (req: FastifyRequest) => string | null;
  readonly organizationRestrictionPort: {
    allowedIdsFor(
      organizationId: string,
      kind: 'paymentMethodIds' | 'deliveryMethodIds' | 'warehouseIds',
    ): Promise<string[] | null>;
  };
  readonly inventory: ReturnType<typeof inventoryModule>;
  /**
   * Availability bands for a set of products, scoped to the warehouses the
   * caller's sales channel is bound to (T143a).
   *
   * `catalog`'s external namespace and `product_feeds` both need exactly this,
   * and both got it from a root that built a **second** `StockLevelService` and
   * `WarehouseChannelService` — while this module built its own pair inside its
   * plugin — then spelled the same two-step lookup twice. The two-step is the
   * port: a caller has a channel, not a warehouse list.
   *
   * The root's copies were also ungated. They kept answering with `inventory`
   * switched off, because only a module's own registration goes through
   * `providePort`.
   */
  readonly inventoryAvailabilityPort: {
    resolveAvailabilityBands(
      productIds: string[],
      salesChannelId: string,
    ): Promise<Awaited<ReturnType<StockLevelService['resolveAvailabilityBands']>>>;
  };
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
            >[0]) => ctx.cradle<InventoryCradle>().templateEmailPort.trySend(input),
          },
          // Composed from the two halves, without a `catch` — the root closure
          // this replaces had one, which would have read a disabled-module
          // throw as "every warehouse is allowed" (T138).
          resolveOrganizationWarehouseAllowList: async (req: FastifyRequest) => {
            const cradle = ctx.cradle<InventoryCradle>();
            const organizationId = cradle.customerOrganizationIdResolver(req);
            if (organizationId === null) return null;
            return cradle.organizationRestrictionPort.allowedIdsFor(organizationId, 'warehouseIds');
          },
        }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'inventoryAvailabilityPort',
    ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: InventoryCradle) => {
        const warehouseChannels = new WarehouseChannelService(emFactory, auditLogService);
        const stockLevels = new StockLevelService(emFactory, eventBus, auditLogService);
        return {
          async resolveAvailabilityBands(productIds: string[], salesChannelId: string) {
            const candidateWarehouseIds =
              await warehouseChannels.resolveCandidateWarehouseIds(salesChannelId);
            return stockLevels.resolveAvailabilityBands(
              productIds,
              candidateWarehouseIds.length > 0 ? candidateWarehouseIds : undefined,
            );
          },
        };
      })
      .singleton(),
  );

  ctx.routes(async (app) => {
    await ctx.cradle<InventoryCradle>().inventory(app);
  });

  /**
   * Migration 030 seeds the Default warehouse and tries to bind it to every
   * channel, but it runs *before* the default-channel reconciler creates the
   * system channel at boot. This catches up at runtime so a channel is never
   * seen without at least one warehouse assignment (feature 026 US3).
   *
   * It ran from `composition.ts` until T143a — which meant it ran with this
   * module switched off, and did not run in the harness at all
   * (`harness-parity` carried it as a production-only construct). As a boot
   * hook it does neither.
   */
  ctx.onBoot(async () => {
    await new WarehouseChannelReconciler(ctx.cradle<InventoryCradle>().emFactory()).run();
  });

  /**
   * The default subject and content for the 2 transactional emails this
   * module declares in its manifest (T143a).
   *
   * These were fourteen `emailDefaultsRegistry.register(...)` calls in
   * `composition.ts`, each importing a template constant out of the module that
   * owns it — a root reaching into seven modules to hand their own content to
   * an eighth. Each module registers its own now.
   *
   * `ctx.onBoot` rather than a registration: the registry is *read* once, by
   * `transactional_emails`' boot reconciler inside its plugin body. Boot hooks
   * run during composition and plugin bodies only when the Fastify app is
   * built, so this always lands first — by construction, not by ordering luck.
   */
  ctx.onBoot(async () => {
    const defaults = lazyPort<EmailDefaultsRegistry>(ctx, 'emailDefaultsPort');
    defaults.register('low_stock_alert', LOW_STOCK_ALERT_DEFAULT, 'inventory');
    defaults.register('availability_back_in_stock', AVAILABILITY_BACK_IN_STOCK_DEFAULT, 'inventory');
  });

}
