import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { DictionaryValidator,
  DictionaryReferenceRegistryPort,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  EmailDefaultsRegistryPort,
  EmailMailerPort,
  InventoryAvailabilityPort,
  InventoryFulfilmentPlanningPort,
  InventoryProductThresholdWritePort,
  InventoryStockImportPort,
  InventoryStockReadPort,
  PromptActionToolRegistryPort,
} from '@endora-commerce/contracts';
import { resolveAllocations, resolveEffectiveFulfilmentStrategy } from '@endora-commerce/contracts';
import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
/**
 * This module's own `EntityManager`-taking interface (feature 080, T048;
 * D-169), which cannot live beside the four above: `@endora-commerce/contracts`
 * may name no MikroORM type, because `admin` and `storefront` both compile it
 * (FR-034).
 */
import type { InventoryReservationApplyPort } from '../ports/index.js';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import { effectiveState } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { inventoryModule, type InventoryModuleOptions } from './plugin.js';
import type { AdjustedPayload } from './services/availability-worker.js';
import type { SettingsValueChangedPayload } from './services/threshold-settings-mirror.js';
import { StockLevelService } from './services/stock-level-service.js';
import { InventoryStockReadService } from './services/inventory-read-port.js';
import { InventoryReservationApplyService } from './services/inventory-reservation-apply-port.js';
import { InventoryStockImportService } from './services/stock-import.service.js';
import { InventoryProductThresholdWriteService } from './services/product-threshold-write.service.js';
import { WarehouseChannelService } from './services/warehouse-channel-service.js';
import { WarehouseChannelReconciler } from './services/warehouse-channel-reconciler.js';
import { AVAILABILITY_BACK_IN_STOCK_DEFAULT, LOW_STOCK_ALERT_DEFAULT } from './email-templates/transactional-defaults.js';
import { inventoryPromptTools } from './prompt-tools.js';
import { registerWarehouseCountryReferences } from './services/warehouse-country-reference.js';
import { registerInventoryAuditReferences } from './services/audit-references.js';
import { AvailabilityNotification } from './entities/availability-notification.entity.js';
import { InventoryThreshold } from './entities/inventory-threshold.entity.js';
import { ProductWarehouseLowStockThreshold } from './entities/product-warehouse-low-stock-threshold.entity.js';
import { StockAllocation } from './entities/stock-allocation.entity.js';
import { StockLevel } from './entities/stock-level.entity.js';
import { WarehouseChannelAssignment } from './entities/warehouse-channel-assignment.entity.js';
import { Warehouse } from './entities/warehouse.entity.js';

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
  readonly auditLogService: AuditPort;
  /** D-74 — the bulk stock import is one Command and one audit row per run. */
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: InventoryModuleOptions['requireCustomer'];
  readonly customerContextResolver: InventoryModuleOptions['resolveCustomerContext'];
  readonly settingsReadPort: SettingsReadPort;
  readonly salesChannelResolutionPort: SalesChannelResolutionPort;
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
   *
   * The shape was written out inline here and again in each root's local type,
   * and the `providePort` call carried **no type argument**, so nothing
   * compared the registration to anything and a consumer had no name to import.
   * `specs/110-instance-repository/` T118c published it as
   * {@link InventoryAvailabilityPort}, when `product_feeds` stopped reaching it
   * through a composition root and `check:port-shape`'s third signal — a module
   * resolving a container name no contract publishes — became what stood in the
   * way.
   */
  readonly inventoryAvailabilityPort: InventoryAvailabilityPort;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    inventory: ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: InventoryCradle) =>
        inventoryModule({
          emFactory,
          eventBus,
          auditLogService,
          settingsService: lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
          channelResolver: lazyPort<SalesChannelResolutionPort>(
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
          // Issue #259 — the channel assortment gate on the notify-me seam. A
          // kernel registration, not a module's, so there is no edge to declare
          // in the manifest.
          salesChannelMembership: lazyPort<SalesChannelMembershipPort>(
            ctx,
            'salesChannelMembershipPort',
          ),
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
   * Feature 080, T048 / D-169 — the stock reservation, published.
   *
   * `orders` reached this module's `StockLevel` and `StockAllocation` classes
   * for it, statically for the reservation and through an `await import()` for
   * the release, and wrote both tables itself: the `FOR UPDATE` read, the
   * `reserved` increment, the allocation insert and the release loop. D-168
   * leaves a packaged `inventory` no entity class for a stranger to name, so
   * the reach had to go before this module moves; the transaction it runs in
   * did not change, and `stock_allocations_order_item_fk` is untouched.
   *
   * A third `inventory` name rather than a widening of either port above, and
   * the three differ in exactly which transaction they run in:
   * `inventoryStockReadPort` reads on this module's own `EntityManager`,
   * `inventoryFulfilmentPlanningPort` opens none at all — it is pure over its
   * arguments — and this one takes placement's, because the
   * `PESSIMISTIC_WRITE` has to be held until the order commits and the
   * allocation rows cannot exist before their order items do.
   *
   * The gate `providePort` wraps this in is real but never reached from
   * placement, for the same reason `inventoryFulfilmentPlanningPort`'s is not:
   * `orders` declares this name `degrades-without` and asks
   * `effectiveState.isPresent('inventory')` before the reservation block and
   * before the cancellation release, so with this module off nothing is
   * reserved and nothing is released — rather than a 503 in the middle of a
   * placement.
   */
  ctx.di.providePort<InventoryReservationApplyPort>(
    'inventoryReservationApplyPort',
    ctx.asFunction(() => new InventoryReservationApplyService()).singleton(),
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

  ctx.di.providePort<InventoryAvailabilityPort>(
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

  /**
   * This module's rows carry a country code, so it answers "who still points at
   * this country?" about its own tables (feature 077, D-87), where the owner used
   * to count them with SQL naming this module's tables.
   *
   * A **contribution** hook: it pushes an inert descriptor into `countryReferenceRegistry`,
   * an ungated registry, and carries no presence probe (D-62/D-68). Probing
   * would be wrong in the dangerous direction — a switched-off module still owns
   * the rows, so its country must still refuse the delete, which is the
   * enumeration policy the registry states.
   */
  ctx.onBoot(() => {
    registerWarehouseCountryReferences(
      lazyPort<DictionaryReferenceRegistryPort>(ctx, 'countryReferenceRegistry'),
      ctx.cradle<InventoryCradle>().emFactory,
    );
  });

  /**
   * What an audit row about a warehouse is called, and where the admin app shows it
   * (feature 075, D-87 drain).
   *
   * `audit_logs` used to answer both by hand — one SQL statement naming this
   * module's table, and this module's admin route spelled into its own switch.
   * A read port would have been the wrong repair: `audit_logs` is a
   * cross-cutting reader, and five ports into it would be five edges pointing
   * from the record towards the things it records. One of the five contributors
   * (`inventory`) is switchable, and `audit_logs` is `nonDeactivatable`, so that
   * edge would also have taken the operator's switch away. A push costs nothing
   * and reads the same for all five.
   *
   * A **contribution** hook: it pushes an inert resolver into
   * `auditReferenceRegistry`, an ungated registry, and carries no presence probe
   * (D-67/D-68). The registry's own enumeration policy is what drops this entry
   * while the module is absent — probing here would make the drop survive a
   * reactivation until the next restart.
   */
  ctx.onBoot(() => {
    registerInventoryAuditReferences(
      lazyPort<AuditReferenceRegistryPort>(ctx, 'auditReferenceRegistry'),
      ctx.cradle<InventoryCradle>().emFactory,
    );
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table->owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 *
 * The order is the one `db/entities-registry.generated.ts` declared before this
 * module became a package, so the registered set is the same list in the same
 * sequence.
 */
export const entities = [
  AvailabilityNotification,
  InventoryThreshold,
  ProductWarehouseLowStockThreshold,
  StockAllocation,
  StockLevel,
  WarehouseChannelAssignment,
  Warehouse,
];

/**
 * The warehouse↔channel reconciler and this module's system warehouse id,
 * published **by name** on `./backend`.
 *
 * The host's demo composition runs the reconciler, and a host program is
 * composed against this package's `dist` while the ORM is registered from the
 * same `entities` array above — so a filesystem path into this file's source
 * would evaluate `warehouse.entity.ts` a second time and the reconciler would
 * `em.create` a `WarehouseChannelAssignment` class the ORM has never heard of
 * (D-160.6.1). D-168 bars an entity class from leaving by this door; a service
 * and a constant are not entities, and `price_lists`' `DefaultPriceListMigrator`
 * / `DEFAULT_PRICE_LIST_ID` pair is the precedent for exactly this shape.
 */
export { WarehouseChannelReconciler } from './services/warehouse-channel-reconciler.js';
export { DEFAULT_WAREHOUSE_ID } from './entities/warehouse.entity.js';
