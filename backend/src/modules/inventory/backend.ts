import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { DictionaryValidator } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type { EventBus } from '../../events/bus.js';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  EmailDefaultsRegistryPort,
  EmailMailerPort,
  InventoryFulfilmentPlanningPort,
  InventoryProductThresholdWritePort,
  InventoryStockImportPort,
  InventoryStockReadPort,
  PromptActionToolRegistryPort,
} from '@b2b/contracts';
import { resolveAllocations, resolveEffectiveFulfilmentStrategy } from '@b2b/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelResolverService } from '../../kernel/sales-channels/sales-channel-resolver.service.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { inventoryModule, type InventoryModuleOptions } from './plugin.js';
import type { AdjustedPayload } from './services/availability-worker.js';
import type { SettingsValueChangedPayload } from './services/threshold-settings-mirror.js';
import { StockLevelService } from './services/stock-level-service.js';
import { InventoryStockReadService } from './services/inventory-read-port.js';
import { InventoryStockImportService } from './services/stock-import.service.js';
import { InventoryProductThresholdWriteService } from './services/product-threshold-write.service.js';
import { WarehouseChannelService } from './services/warehouse-channel-service.js';
import { WarehouseChannelReconciler } from './services/warehouse-channel-reconciler.js';
import { AVAILABILITY_BACK_IN_STOCK_DEFAULT, LOW_STOCK_ALERT_DEFAULT } from './email-templates/transactional-defaults.js';
import { inventoryPromptTools } from './prompt-tools.js';

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
  /** D-74 — the bulk stock import is one Command and one audit row per run. */
  readonly commandBus: CommandBus;
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
   * Owned by `prompt_actions`: the assistant's tool catalogue. An ungated
   * registration this module pushes into once, from a boot hook — declared as a
   * `contributes-to` edge rather than a dependency (D-44).
   */
  readonly promptActionToolRegistry: PromptActionToolRegistryPort;
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
          // Feature 075, Phase C — the four reads and one write this module used
          // to take by importing `catalog`'s, `customer_accounts`' and `email`'s
          // files. Every one of them kept answering with its owner switched off.
          catalogProducts: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
          catalogCategories: lazyPort<CatalogCategoryReadPort>(ctx, 'catalogCategoryReadPort'),
          catalogCategoryWrites: lazyPort<CatalogCategoryWritePort>(
            ctx,
            'catalogCategoryWritePort',
          ),
          customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          mailer: lazyPort<EmailMailerPort>(ctx, 'emailMailer'),
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

  /**
   * Feature 075, Phase P — the stock read model.
   *
   * `orders` assembles candidate warehouses for a line from three of this
   * module's tables today, inside its own transaction, reaching them through a
   * **dynamic** import. `candidatesFor` is that assembly, on this side of the
   * boundary; the three list methods beside it are the transcriptions
   * `import_export` and the dev seed need.
   */
  ctx.di.providePort<InventoryStockReadPort>(
    'inventoryStockReadPort',
    ctx
      .asFunction(({ emFactory }: InventoryCradle) => new InventoryStockReadService(emFactory))
      .singleton(),
  );

  /**
   * D-94.4 — the warehouse-picking policy, published.
   *
   * `orders` reached both functions through `await import(
   * '../../inventory/services/…')` inside the placement method body. They are
   * pure over their arguments, so nothing here reads a table and nothing takes
   * an `EntityManager`; what the port buys is that the policy is asked of its
   * owner rather than re-implemented by whoever edits the import next.
   *
   * A separate port from `inventoryStockReadPort` on purpose: a read port that
   * also decides policy makes its own name a lie.
   *
   * The gate `providePort` wraps this in is real but never reached from
   * placement: `orders` declares this name `degrades-without` and asks
   * `effectiveState.isPresent('inventory')` before the reservation block, so
   * with this module off there is no plan to compute rather than a 503 in the
   * middle of one.
   */
  ctx.di.providePort<InventoryFulfilmentPlanningPort>(
    'inventoryFulfilmentPlanningPort',
    ctx
      .asFunction((): InventoryFulfilmentPlanningPort => ({
        resolveEffectiveStrategy: resolveEffectiveFulfilmentStrategy,
        planAllocations: resolveAllocations,
      }))
      .singleton(),
  );

  /**
   * D-74 — the bulk stock import. `import_export` wrote `stock_levels` from its
   * own transaction, with no Command, no audit row and the seeded warehouse id
   * pasted in as a literal; all three come back here, where the rows live.
   *
   * `catalogProductReadPort` is resolved lazily and per call: a spreadsheet
   * addresses a product by SKU, and this module already declares `catalog`.
   */
  ctx.di.providePort<InventoryStockImportPort>(
    'inventoryStockImportPort',
    ctx
      .asFunction(
        ({ commandBus }: InventoryCradle) =>
          new InventoryStockImportService(
            commandBus,
            lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
          ),
      )
      .singleton(),
  );

  /**
   * Issue #185 — the per-warehouse threshold copy, published.
   *
   * `catalog`'s product duplication wrote these rows itself, with an
   * `insert … select` naming this module's table. It named no import specifier,
   * so `check:module-boundary`'s specifier pass could not see it; it asked no
   * gate, so it kept writing with this module switched off; and it left no
   * audit row here, so the rows arrived with nothing on this side having decided
   * they should. The port is the whole remedy: one Command, one audit row, and
   * the gate `providePort` wraps it in.
   *
   * `catalog` declares this name `degrades-without` and decides presence in
   * front of the gate, so the duplication itself never meets a 503 — see the
   * contract's note on why the copy owns its own transaction.
   */
  ctx.di.providePort<InventoryProductThresholdWritePort>(
    'inventoryProductThresholdWritePort',
    ctx
      .asFunction(
        ({ commandBus }: InventoryCradle) =>
          new InventoryProductThresholdWriteService(commandBus),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'inventoryAvailabilityPort',
    ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: InventoryCradle) => {
        const warehouseChannels = new WarehouseChannelService(emFactory, auditLogService);
        const stockLevels = new StockLevelService(
          emFactory,
          lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
          lazyPort<CatalogCategoryReadPort>(ctx, 'catalogCategoryReadPort'),
          eventBus,
          auditLogService,
        );
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

  /**
   * The three reactors this module owns (issue #107).
   *
   * All three were bare `eventBus.on` calls inside the plugin body, so a
   * switched-off `inventory` still sent back-in-stock mail, still sent low-stock
   * alerts and still wrote the mirrored threshold row — three writes on a module
   * an operator believed was absent. `ctx.subscribe` puts each behind
   * `subscribeForModule`, which reads the effective state per event.
   *
   * The threshold mirror re-reads the changed setting, and reads the value that
   * was just written: `SettingsAdminService` drops the settings cache at the
   * write seam and awaits the drop before it emits (issue #45). This used to
   * depend on the kernel's invalidator being registered ahead of this handler —
   * true, but only by composition order, which nothing preserved.
   */
  const handle = (): ReturnType<typeof inventoryModule>['handle'] =>
    ctx.cradle<InventoryCradle>().inventory.handle;

  ctx.subscribe('inventory.adjusted.v1', async (payload) => {
    await handle().availabilityWorker.handleAdjusted(payload as AdjustedPayload);
  });

  ctx.subscribe('inventory.adjusted.v1', async (payload) => {
    await handle().lowStockAlertService.handleAdjusted(payload as AdjustedPayload);
  });

  ctx.subscribe('settings.value_changed', async (payload) => {
    await handle().thresholdSettingsMirror?.onSettingChanged(
      payload as SettingsValueChangedPayload,
    );
  });

  ctx.routes(async (app) => {
    await ctx.cradle<InventoryCradle>().inventory.plugin(app);
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
    // Presence is decided here — first, and outside anything that could catch it
    // (issue #146, D-68). The reconciler creates a
    // `warehouse_channel_assignments` row per sales channel, so with the module
    // switched off it wrote this module's tables at every boot. A boot hook has
    // no caller to answer, so the question is asked rather than thrown:
    // `runBootHooks` re-throws as `ModuleCompositionError`, which `index.ts`
    // turns into `process.exit(1)`.
    //
    // The consequence of returning: a sales channel created while `inventory` is
    // off gets its default warehouse assignment at the **next boot** rather than
    // at reactivation. That is acceptable because the reconcile is idempotent
    // and every read of those rows is gated anyway. If it stops being
    // acceptable, the repair is to drive the reconcile from the activation
    // event — not to un-probe this hook.
    if (!effectiveState.isPresent('inventory')) return;
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
    const defaults = lazyPort<EmailDefaultsRegistryPort>(ctx, 'emailDefaultsPort');
    defaults.register('low_stock_alert', LOW_STOCK_ALERT_DEFAULT, 'inventory');
    defaults.register('availability_back_in_stock', AVAILABILITY_BACK_IN_STOCK_DEFAULT, 'inventory');
  });

  /**
   * The assistant tools this module contributes (D-44).
   *
   * Both roots built the warehouse resolver and the `set_stock_level` mutation
   * from this module's own services and pushed them into `prompt_actions`'
   * registry, because pushing from here would have made `prompt_actions` a
   * declared dependency — and that declaration is what would have made an
   * optional assistant undeactivatable while `inventory` is present.
   * `nonBindingDependencies` declares the edge without that claim.
   *
   * A push, not a pull. The registry is a plain registration, so this resolves
   * no gate, and the host drops every tool whose recorded owner is not
   * effectively present.
   */
  ctx.onBoot(() => {
    const cradle = ctx.cradle<InventoryCradle>();
    const registry = cradle.promptActionToolRegistry;
    for (const tool of inventoryPromptTools({
      emFactory: cradle.emFactory,
      catalogProducts: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
      catalogCategories: lazyPort<CatalogCategoryReadPort>(ctx, 'catalogCategoryReadPort'),
      eventBus: cradle.eventBus,
      auditLogService: cradle.auditLogService,
    })) {
      registry.register(tool);
    }
  });
}
