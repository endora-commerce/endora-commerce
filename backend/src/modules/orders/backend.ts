import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type {
  AddressReadPort,
  AddressServicePort,
  AssetReadPort,
  CartWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  DeliveryMethodReadPort,
  EmailDefaultsRegistryPort,
  InventoryFulfilmentPlanningPort,
  InventoryStockReadPort,
  InvoicePdfPort,
  InvoiceReadPort,
  OrderListPort,
  OrderPlacementPort,
  OrderReadPort,
  OrderStatusAnnouncePort,
  OrderTransitionPort,
  OrganizationDetailsPort,
  OrganizationRestrictionPort,
  PaymentEmailRendererPort,
  PaymentMethodReadPort,
  PromptActionToolRegistryPort,
  ResolvedTax,
  SalesChannelAttributionRegistryPort,
  ShippingEmailRendererPort,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { CommandBus } from '../../commands/index.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { OrganizationReadPort } from '../../kernel/ports/organizations.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsReadPort } from '../../kernel/ports/settings.js';
import { commerceModule, type OrdersModuleOptions } from './plugin.js';
import { PurchaseConversionService } from './services/purchase-conversion-service.js';
import { emitOrderStatusAfter } from './events/order-status-events.js';
import { OrderReadService, toOrderRecord } from './services/order-read-port.js';
import { OrderReturnContextProvider } from './services/order-return-context.js';
import { registerOrderSalesChannelAttributions } from './services/sales-channel-attributions.js';
import type { OrderService } from './services/order-service.js';
import type { OrderListService } from './services/order-list-service.js';
import type { OrderTransitionService } from './services/order-transition-service.js';
import type { OrderStatusGraphService } from './services/order-status-graph-service.js';
import { OrderTransitionPortService } from './services/order-transition-port.js';
import { ORDER_CONFIRMATION_DEFAULT } from './email-templates/order-confirmation.default.js';
import { ADMIN_CREATED_ORDER_DEFAULT, ORDER_COMMENT_DEFAULT, REORDER_CREATED_DEFAULT } from './email-templates/secondary-defaults.js';
import { ordersPromptTools } from './prompt-tools.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import type { OrderConfirmationRenderers } from './email-templates/order-confirmation.js';
import {
  noCarrierShippingLineRenderer,
  noGatewayPaymentLineRenderer,
} from './email-templates/adapter-line-baselines.js';

/**
 * `orders` — forty options, twenty-seven of them optional, and nine settings
 * closures the harness mostly did not pass (feature 072, wave 4, T141).
 *
 * **Seven per-channel settings were wired in production and by no test.**
 * `commerceModule` takes nine `resolve…(salesChannelId)` closures; the harness
 * passed two. Each of the other seven is documented as *"Omit ⇒ <the feature is
 * off>"*, so their absence did not change a value — it removed a behaviour:
 *
 *   - `resolveMinOrderValue` — "Omit ⇒ no minimum", so the minimum-order-value
 *     checkout gate (feature 038 US3 / FR-035) was enforced in production and by
 *     nothing in the suite;
 *   - `resolveOrderConfirmationRecipients` — "Omit ⇒ none", so no test ever sent
 *     a confirmation to the configured recipients;
 *   - `resolveChannelFulfilmentStrategy` / `…WarehouseOrder` — omitted, placement
 *     falls back to the global strategy, so the sales-channel layer of the
 *     precedence chain was never exercised;
 *   - `resolveOrderBusinessIdPrefix` / `…Suffix` — per-channel order numbering,
 *     silently bare-numeric in every test;
 *   - `resolveReorderEnabled` — the reorder surface.
 *
 * All nine are this module's own settings and every closure was identical in
 * the roots that had it, so they are read here now, through the settings port,
 * so both compositions run the same code.
 *
 * Running the same code is not the same as reading a value back, and this note
 * used to claim the second (issue #62). `test/integration/orders/channel-settings.test.ts`
 * is where the seven are exercised: each is written to the channel a request
 * resolves to, through the admin write seam, and the behaviour observed over
 * HTTP — because a settings test that asserts a value the harness itself
 * hard-coded proves the harness rather than the read.
 *
 * **The three `expose…` sinks become ports.** `OrderService`,
 * `OrderListService` and `OrderTransitionService` are constructed inside the
 * plugin body, so they do not exist until route registration — which is why
 * they were handed out through callbacks into root-held mutable variables, and
 * why `quick_order`, `customers` and `prompt_actions` each read them through a
 * getter a root supplied. The module holds that binding itself now and provides
 * three accessors; the getters drain from `HOST_REGISTERED_PORTS` with them.
 * The accessor shape stays because the timing is real: an accessor resolved
 * before the plugin registers legitimately answers `null`.
 *
 * `assertOrganizationCanTransact` and the two organization allow-lists move
 * inside, composed from the same two halves every other consumer uses since
 * T138 — and, as there, without a `catch` around the port call.
 */

/** What `orders` resolves from the container, and the names it owns. */
export interface OrdersCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly commandBus: CommandBus;
  readonly auditLogService: AuditPort;
  readonly settingsReadPort: SettingsReadPort;
  /**
   * The platform Redis connection, **not** `moduleQueueRedis`.
   *
   * `orders` builds no queue — its only use of Redis is the distributed lock
   * that makes concurrent external intakes with the same Idempotency-Key
   * resolve to one order (`order-api-intake-service.ts#acquireLock`, which
   * returns `null` and skips locking entirely when Redis is absent).
   *
   * T141 first wired this to `moduleQueueRedis`, which is the connection a
   * module may build a BullMQ *producer* on and which the harness sets to
   * `undefined` on purpose — "this composition wants no queues". That silently
   * removed the lock from every test, and the concurrent-duplicate case went
   * from asserting `intake_busy` to two intakes proceeding side by side. A lock
   * is not a queue, and the two names exist precisely so a composition can
   * refuse one without losing the other.
   */
  readonly redis: Redis;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: OrdersModuleOptions['requireCustomer'];
  readonly customerContextResolver: OrdersModuleOptions['resolveCustomerContext'];
  readonly customerOrganizationIdResolver: (req: FastifyRequest) => string | null;
  readonly cartWritePort: OrdersModuleOptions['cartWritePort'];
  readonly addressService: OrdersModuleOptions['addressService'];
  readonly customFieldValueService: NonNullable<OrdersModuleOptions['customFieldValues']>;
  readonly creditLimitService: NonNullable<OrdersModuleOptions['creditLimit']>;
  readonly pricingService: NonNullable<OrdersModuleOptions['pricingService']>;
  readonly promotionService: NonNullable<OrdersModuleOptions['promotionService']>;
  readonly promotionUsageFinalizer: NonNullable<OrdersModuleOptions['promotionUsageFinalizer']>;
  readonly rfqService: NonNullable<ReturnType<NonNullable<OrdersModuleOptions['getRfqService']>>>;
  /**
   * `ResolvedTax` rather than `{ rate: number }` (issue #124): the narrower
   * hand-written shape was a structural lie the moment the resolver grew an
   * answer that carries no rate, and `tsc` had no way to say so.
   */
  readonly taxService: { taxRateFor(input: TaxRateInput): Promise<ResolvedTax> };
  readonly salesChannelMembershipPort: NonNullable<OrdersModuleOptions['salesChannelMembership']>;
  /**
   * The two method modules' registrations, as the container holds them. The
   * options object below takes an accessor over each (feature 074, FR-024): a
   * cradle read written into a factory body resolves when the registration is
   * constructed, and a registration another module owns must not be frozen
   * there — it is a name whose owner an operator may switch off.
   */
  readonly paymentAdapterRegistry: ReturnType<OrdersModuleOptions['paymentAdapterRegistry']>;
  readonly shippingAdapterRegistry: ReturnType<OrdersModuleOptions['shippingAdapterRegistry']>;
  readonly paymentOrderStatusRegistry: ReturnType<OrdersModuleOptions['paymentOrderStatusRegistry']>;
  readonly requireBoundApiKey: NonNullable<OrdersModuleOptions['requireBoundApiKey']>;
  readonly emailMailer: NonNullable<OrdersModuleOptions['mailer']>;
  readonly organizationReadPort: OrganizationReadPort;
  readonly organizationRestrictionPort: OrganizationRestrictionPort;
  /** `transactional_emails`' own accessor since T120, late-bound by that module. */
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  /** Root-shaped, owner `auth`: which organizations a sales-rep admin may see. */
  readonly ordersAdminScopeResolver: NonNullable<OrdersModuleOptions['resolveAdminOrdersScope']>;
  readonly orderServiceAccessor: () => OrderService | null;
  readonly orderListServiceAccessor: () => OrderListService | null;
  readonly orderTransitionServiceAccessor: () => OrderTransitionService | null;
  /** Issue #277 — the per-order claim on the GA4 `purchase` conversion. */
  readonly orderPurchaseConversion: PurchaseConversionService;
  readonly orders: ReturnType<typeof commerceModule>;
  /**
   * Owned by `prompt_actions`: the assistant's tool catalogue. An ungated
   * registration this module pushes into once, from a boot hook — declared as a
   * `contributes-to` edge rather than a dependency (D-44).
   */
  readonly promptActionToolRegistry: PromptActionToolRegistryPort;
}

type TaxRateInput = {
  country: string;
  productType: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
};

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): OrdersCradle => ctx.cradle<OrdersCradle>();

  /**
   * The four services `commerceModule` hands out at route-registration time.
   * Held here rather than in a root variable — the binding is this module's
   * property, and the modules that read it should not depend on a composition
   * having remembered to wire a sink.
   *
   * The graph service joined them for `orderTransitionPort` (feature 085): the
   * port has to know whether an edge exists and whether a status is terminal,
   * and the graph is cached in-process and invalidated only by the instance
   * that writes it — so it is this instance or a stale one.
   */
  const exposed: {
    orderService: OrderService | null;
    orderListService: OrderListService | null;
    orderTransitionService: OrderTransitionService | null;
    orderStatusGraphService: OrderStatusGraphService | null;
  } = {
    orderService: null,
    orderListService: null,
    orderTransitionService: null,
    orderStatusGraphService: null,
  };

  /**
   * A published port answers a caller, so "the plugin has not registered yet"
   * has to be an error rather than a `null` the caller may forget to test.
   * 503 is the same status `quick_order` already produces from the null branch,
   * and the same one the module gate produces when `orders` is switched off —
   * which is right, because from a caller's side the two are the same fact.
   * The envelope code follows `quick_order`'s existing spelling rather than
   * introducing a sixth "unavailable" code for one branch.
   */
  const requireExposed = <T>(service: T | null, what: string): T => {
    if (service === null) {
      throw new HttpError(503, ERROR_CODES.NOT_FOUND, `Orders: ${what} is unavailable.`);
    }
    return service;
  };

  /**
   * One read of one of this module's own settings, scoped to the channel the
   * caller is on, degrading to the manifest default. The identical try/catch
   * stood in the production root nine times over.
   */
  const readSetting = async <T>(
    code: string,
    /** `null` = read it platform-wide; only the two business-ID affixes do. */
    salesChannelId: string | null,
    schema: Parameters<SettingsReadPort['get']>[2],
    fallback: T,
  ): Promise<T> => {
    try {
      return (await cradle().settingsReadPort.get(code, salesChannelId, schema)) as T;
    } catch {
      return fallback;
    }
  };

  /**
   * The order-confirmation e-mail's two adapter-rendered lines (feature 034
   * FR-016/FR-017, feature 035), resolved per send.
   *
   * `payments` and `shipments` each host a registry an adapter may push a
   * custom renderer into, and each publishes it as a gated port. Both declare
   * `orders` in their own `dependencies`, so declaring them here would close a
   * cycle `test/unit/db/module-graph.test.ts` fails on; and recording them in
   * `acknowledgedDependencies` — which drops the ordering and keeps the bind —
   * would make two deactivatable modules undeactivatable for as long as the
   * platform takes orders, because `orders` is non-deactivatable. A buyer who
   * paid on invoice must still get their confirmation.
   *
   * So both edges are `degrades-without`, and this is the presence check that
   * declaration obliges. It is asked at the send rather than at composition,
   * because an operator may flip either module between two orders.
   */
  /**
   * The two `inventory` ports the stock reservation runs on (D-94.4, issue
   * #188), as one accessor over one presence question.
   *
   * `inventory` is declared `degrades-without` in this module's manifest —
   * `stock_allocations_order_item_fk` obliges `inventory` to declare `orders`,
   * so the edge cannot be declared back, and an acknowledged edge would keep
   * the bind and make `inventory.enabled` a control no operator could use,
   * because this module is non-deactivatable. So presence is asked here, per
   * placement, and `order-service.ts` skips the reservation block whole on
   * `null`. Before D-94.4 there was no port and no question: four dynamic
   * imports and a knex join meant every placement wrote `inventory`'s tables
   * whatever the operator had chosen.
   */
  const inventoryPorts = (): {
    readonly stockRead: InventoryStockReadPort;
    readonly planning: InventoryFulfilmentPlanningPort;
  } | null =>
    effectiveState.isPresent('inventory')
      ? {
          stockRead: lazyPort<InventoryStockReadPort>(ctx, 'inventoryStockReadPort'),
          planning: lazyPort<InventoryFulfilmentPlanningPort>(
            ctx,
            'inventoryFulfilmentPlanningPort',
          ),
        }
      : null;

  const confirmationRenderers = (): OrderConfirmationRenderers => ({
    payment: effectiveState.isPresent('payments')
      ? lazyPort<PaymentEmailRendererPort>(ctx, 'paymentEmailRendererPort')
      : noGatewayPaymentLineRenderer,
    shipping: effectiveState.isPresent('shipments')
      ? lazyPort<ShippingEmailRendererPort>(ctx, 'shippingEmailRendererPort')
      : noCarrierShippingLineRenderer,
  });

  /**
   * The per-order claim on a GA4 `purchase` conversion (issue #277).
   *
   * Registered on its own so the module has one instance of it, and built
   * over the EntityManager factory rather than over Redis: the claim is a
   * column on the order, which is what makes it survive a restart and never
   * expire. Nothing opens a claim here — `placeOrder` sets the column inside
   * the placement transaction, which is where an order first exists.
   */
  ctx.di.register({
    orderPurchaseConversion: ctx
      .asFunction(({ emFactory }: OrdersCradle) => new PurchaseConversionService(emFactory))
      .singleton(),
  });

  ctx.di.register({
    orders: ctx
      .asFunction(
        ({
          emFactory,
          eventBus,
          commandBus,
          auditLogService,
          redis,
          orderPurchaseConversion,
        }: OrdersCradle) =>
          commerceModule({
            emFactory,
            eventBus,
            commandBus,
            auditLogService,
            redis,
            purchaseConversion: orderPurchaseConversion,
            // Ports, every one of them read lazily: this registration is a
            // singleton and a gate may not be frozen inside one.
            cartWritePort: lazyPort<CartWritePort>(ctx, 'cartWritePort'),
            catalogProductRead: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            customerAccountRead: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
            organizationDetails: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            deliveryMethodRead: () =>
              effectiveState.isPresent('delivery_methods')
                ? lazyPort<DeliveryMethodReadPort>(ctx, 'deliveryMethodReadPort')
                : null,
            paymentMethodRead: () =>
              effectiveState.isPresent('payment_methods')
                ? lazyPort<PaymentMethodReadPort>(ctx, 'paymentMethodReadPort')
                : null,
            // This module's own lifecycle write (feature 085, Phase F), for the
            // buyer's cancellation. Resolved lazily like every other port and
            // for the same reason: the registration below is a singleton and a
            // gate may not be frozen inside one.
            orderTransitionPort: lazyPort<OrderTransitionPort>(ctx, 'orderTransitionPort'),
            assetRead: lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
            invoiceRead: () =>
              effectiveState.isPresent('invoices')
                ? lazyPort<InvoiceReadPort>(ctx, 'invoiceReadPort')
                : null,
            invoicePdf: () =>
              effectiveState.isPresent('invoices')
                ? lazyPort<InvoicePdfPort>(ctx, 'invoicePdfPort')
                : null,
            // Feature 075, Phase C (issue #195) — `addressServicePort`, the
            // record-mapping adapter, rather than the `addressService` class
            // registration beside it. The class hands back `addresses`' entity
            // and `Address` is structurally assignable to `AddressRecord`, so
            // the old name compiled while the entity crossed the boundary.
            addressService: lazyPort<AddressServicePort>(ctx, 'addressServicePort'),
            addressRead: lazyPort<AddressReadPort>(ctx, 'addressReadPort'),
            customFieldValues: lazyPort<OrdersCradle['customFieldValueService']>(
              ctx,
              'customFieldValueService',
            ),
            creditLimit: lazyPort<OrdersCradle['creditLimitService']>(ctx, 'creditLimitService'),
            pricingService: lazyPort<OrdersCradle['pricingService']>(ctx, 'pricingService'),
            promotionService: lazyPort<OrdersCradle['promotionService']>(ctx, 'promotionService'),
            promotionUsageFinalizer: lazyPort<OrdersCradle['promotionUsageFinalizer']>(
              ctx,
              'promotionUsageFinalizer',
            ),
            inventory: inventoryPorts,
            salesChannelMembership: lazyPort<OrdersCradle['salesChannelMembershipPort']>(
              ctx,
              'salesChannelMembershipPort',
            ),
            // Accessors, not values: read where the plugin uses them rather
            // than here, where this factory body runs once (feature 074).
            paymentAdapterRegistry: () => cradle().paymentAdapterRegistry,
            shippingAdapterRegistry: () => cradle().shippingAdapterRegistry,
            paymentOrderStatusRegistry: () => cradle().paymentOrderStatusRegistry,
            mailer: lazyPort<OrdersCradle['emailMailer']>(ctx, 'emailMailer'),
            confirmationRenderers,
            getTransactionalEmailSender: () => cradle().transactionalEmailSenderAccessor(),
            getRfqService: () => lazyPort<OrdersCradle['rfqService']>(ctx, 'rfqService'),
            requireAdmin: (permission) => async (req, reply) =>
              cradle().requireAdmin(permission)(req, reply),
            requireCustomer: (req, reply) => cradle().requireCustomer(req, reply),
            requireBoundApiKey: (...args: Parameters<OrdersCradle['requireBoundApiKey']>) =>
              cradle().requireBoundApiKey(...args),
            resolveCustomerContext: (req: FastifyRequest) => cradle().customerContextResolver(req),
            resolveAdminOrdersScope: (req: FastifyRequest) =>
              cradle().ordersAdminScopeResolver(req),

            // The tenancy reads, composed from the same two halves every other
            // consumer uses since T138 — and, as there, with no `catch` around
            // a port call, which would read a disabled-module throw as "no
            // restriction" on a path whose job is to restrict.
            assertOrganizationCanTransact: async (organizationId: string): Promise<void> => {
              await cradle().organizationReadPort.assertCanTransact(organizationId);
            },
            resolveOrganizationPaymentMethodAllowList: (req: FastifyRequest) =>
              resolveAllowList(req, 'paymentMethodIds'),
            resolveOrganizationDeliveryMethodAllowList: (req: FastifyRequest) =>
              resolveAllowList(req, 'deliveryMethodIds'),
            resolveOrganizationMethodAllowLists: async (organizationId: string) => {
              const lists = await cradle().organizationRestrictionPort.allowedIdsFor(
                organizationId,
                'paymentMethodIds',
              );
              const delivery = await cradle().organizationRestrictionPort.allowedIdsFor(
                organizationId,
                'deliveryMethodIds',
              );
              if (lists === null || delivery === null) return null;
              return { paymentMethodIds: lists, deliveryMethodIds: delivery };
            },

            // The nine settings reads. Seven of them were passed by production
            // and by no test at all — see the note at the top of this file.
            resolveOrderBusinessIdPrefix: (channelId) =>
              readSetting('orders.business_id.prefix', channelId, z.string(), ''),
            resolveOrderBusinessIdSuffix: (channelId) =>
              readSetting('orders.business_id.suffix', channelId, z.string(), ''),
            resolveReorderEnabled: (channelId) =>
              readSetting('orders.reorder_enabled', channelId, z.boolean(), true),
            resolveOrderConfirmationRecipients: (channelId) =>
              readSetting(
                'orders.confirmation_recipients',
                channelId,
                z.array(z.string()),
                [] as string[],
              ),
            resolveMinOrderValue: (channelId) =>
              readSetting('orders.min_order_value', channelId, z.number(), 0),
            resolveChannelFulfilmentStrategy: (channelId) =>
              readSetting(
                'inventory.fulfilment_strategy',
                channelId,
                z.enum([
                  'any',
                  'default_first',
                  'lowest_stock_first',
                  'highest_stock_first',
                  'defined_order',
                ]),
                'default_first' as const,
              ),
            resolveChannelFulfilmentWarehouseOrder: (channelId) =>
              readSetting(
                'inventory.fulfilment_strategy_warehouse_order',
                channelId,
                z.array(z.string()),
                [] as string[],
              ),
            resolveChannelAllowNegativeStock: (channelId) =>
              readSetting('inventory.allow_negative_stock', channelId, z.boolean(), false),
            // Real per-product VAT from the tax rules. No `catch` (issue #84):
            // `taxRateFor` answers "no rule and no default" as `{ source:
            // 'none' }`, so the only errors it raises are a failing database and
            // `taxes` being switched off — and a flat 23% invented for either is
            // a tax figure on a real order, printed on a real invoice, that no
            // rule in the deployment supports.
            resolveTaxRate: async ({ country, productType, vatStatus }) => {
              const resolved = await cradle().taxService.taxRateFor({
                country: country ?? 'PL',
                productType: productType as TaxRateInput['productType'],
                vatStatus: vatStatus as TaxRateInput['vatStatus'],
              });
              // Narrowed rather than read (issue #124): the `none` arm carries
              // no `rate`, and this closure is typed against the cradle's own
              // structural declaration, so reading it would compile and hand
              // `undefined` to the totals as a rate.
              return resolved.source === 'none' ? 0 : resolved.rate;
            },

            exposeOrderService: (service) => {
              exposed.orderService = service;
            },
            exposeOrderListService: (service) => {
              exposed.orderListService = service;
            },
            exposeOrderTransitionService: (service) => {
              exposed.orderTransitionService = service;
            },
            exposeOrderStatusGraphService: (service) => {
              exposed.orderStatusGraphService = service;
            },
          }),
      )
      .singleton(),
  });

  /** Anonymous callers and customers with no organisation are unrestricted. */
  const resolveAllowList = async (
    request: FastifyRequest,
    kind: 'paymentMethodIds' | 'deliveryMethodIds',
  ): Promise<string[] | null> => {
    const organizationId = cradle().customerOrganizationIdResolver(request);
    if (organizationId === null) return null;
    return cradle().organizationRestrictionPort.allowedIdsFor(organizationId, kind);
  };

  // The three accessors. Each answers `null` until the plugin registers, which
  // is the same contract the root-held getters had — the difference is that the
  // binding belongs to this module rather than to whichever root remembered a
  // sink.
  ctx.di.providePort(
    'orderServiceAccessor',
    ctx.asFunction((): (() => OrderService | null) => () => exposed.orderService).singleton(),
  );
  ctx.di.providePort(
    'orderListServiceAccessor',
    ctx
      .asFunction((): (() => OrderListService | null) => () => exposed.orderListService)
      .singleton(),
  );
  ctx.di.providePort(
    'orderTransitionServiceAccessor',
    ctx
      .asFunction((): (() => OrderTransitionService | null) => () => exposed.orderTransitionService)
      .singleton(),
  );

  /** The transition service the assistant's status-change tools call at confirm time. */
  const transitionService = (): OrderTransitionService | null =>
    cradle().orderTransitionServiceAccessor();

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // The three accessors above hand out a *class*, and eleven modules type their
  // holder with it. The four ports below are what they rewire to: the same
  // behaviour, expressed in shapes that carry no `Order` entity and no
  // `EventBus`. The accessors stay for the consumers Phase C has not reached.
  //
  // `orderPlacementPort` and `orderListPort` keep the accessors' timing —
  // both services are constructed inside the plugin body, so a call made
  // before route registration legitimately has nothing to call. They answer
  // that with a 503 rather than a `null` a caller has to remember to check;
  // a `null` accessor is indistinguishable from a wiring mistake, and
  // `quick_order` already translates it into a 503 by hand.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<OrderReadPort>(
    'orderReadPort',
    ctx.asFunction(({ emFactory }: OrdersCradle) => new OrderReadService(emFactory)).singleton(),
  );

  ctx.di.providePort<OrderListPort>(
    'orderListPort',
    ctx
      .asFunction((): OrderListPort => ({
        list: (query, scope) => requireExposed(exposed.orderListService, 'order list').list(query, scope),
      }))
      .singleton(),
  );

  ctx.di.providePort<OrderPlacementPort>(
    'orderPlacementPort',
    ctx
      .asFunction((): OrderPlacementPort => ({
        // `nextAction` is carried across explicitly. It is a virtual column, so
        // `toOrderRecord` — which maps a *stored* order — does not and should
        // not know about it; but it is the whole point of the reply to a
        // placement, and publishing `OrderRecord` alone would have dropped the
        // payment redirect from `quick_order`'s one-click response (feature
        // 075, corrected in the `quick_order` cut).
        placeOrder: async (customerContext, req) => {
          const order = await requireExposed(
            exposed.orderService,
            'order placement',
          ).placeOrder(customerContext, req);
          return { ...toOrderRecord(order), nextAction: order.nextAction ?? null };
        },
      }))
      .singleton(),
  );

  /**
   * The templated status-change announcement (feature 038 FR-007).
   *
   * `payments` and `shipments` move an order's status inside their own
   * transaction and then announce it, which they do today by importing this
   * module's event builder and handing it their own `EventBus`. The four event
   * names are not known at compile time — the status set is
   * admin-configurable — so the naming scheme has to live in exactly one
   * place, and that place is this module.
   */
  ctx.di.providePort<OrderStatusAnnouncePort>(
    'orderStatusAnnouncePort',
    ctx
      .asFunction(({ eventBus }: OrdersCradle): OrderStatusAnnouncePort => ({
        announceStatusChanged: (change) => {
          emitOrderStatusAfter(eventBus, change);
        },
      }))
      .singleton(),
  );

  /**
   * The lifecycle write (feature 085, Phase B).
   *
   * `payments` and `shipments` move an order's status by assigning
   * `order.status` on an entity they imported, which skips graph validation,
   * the veto guards, the audit entry and the side-effects that release stock
   * and free a credit-limit reservation. This is the seam that lets them stop,
   * and the write twin of `orderStatusAnnouncePort` above — the two are called
   * in sequence by the same handlers, which is why both take the same
   * `OrderStatusActor` rather than each carrying an actor shape of its own.
   *
   * No consumer resolves it yet: it is published here so the three bypasses
   * have somewhere to go.
   */
  ctx.di.providePort<OrderTransitionPort>(
    'orderTransitionPort',
    ctx
      .asFunction(
        ({ emFactory }: OrdersCradle) =>
          new OrderTransitionPortService(
            emFactory,
            () => requireExposed(exposed.orderTransitionService, 'order transitions'),
            () => requireExposed(exposed.orderStatusGraphService, 'the order status graph'),
          ),
      )
      .singleton(),
  );

  /**
   * The order facts a return settlement needs (feature 046 R4), as this
   * module's port instead of a class both roots constructed (T143c).
   *
   * `OrderReturnContextProvider` reads `orders` tables and implements an
   * interface `returns` declares, so it was always this module's to build — but
   * a root's instance is ungated: it kept answering with `orders` switched off,
   * which is the Constitution XVII hole the restated SC-001 names. The bridge
   * `returns` receives forwards to this name per settlement, so the gate is
   * asked at the call rather than at composition.
   */
  ctx.di.providePort(
    'orderReturnContextPort',
    ctx
      .asFunction(
        ({ emFactory }: OrdersCradle) => new OrderReturnContextProvider(emFactory),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    await cradle().orders(app);
  });

  /**
   * The default subject and content for the 4 transactional emails this
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
    defaults.register('order_confirmation', ORDER_CONFIRMATION_DEFAULT, 'orders');
    defaults.register('order_comment', ORDER_COMMENT_DEFAULT, 'orders');
    defaults.register('reorder_created', REORDER_CREATED_DEFAULT, 'orders');
    defaults.register('admin_created_order', ADMIN_CREATED_ORDER_DEFAULT, 'orders');
  });

  /**
   * The assistant tools this module contributes (D-44).
   *
   * The production root built these and the harness did not, so the order
   * resolver and the status-change mutations were exercised by no test at all.
   * Composing them here composes them in both, which closes that parity gap as
   * a side effect of the move.
   *
   * A push, not a pull: the registry is a plain registration, so this resolves
   * no gate, and the host drops every tool whose recorded owner is not
   * effectively present. `getTransitionService` stays a getter — it is read at
   * confirm time, long after boot, and answers `null` until the plugin binds —
   * and it is declared **outside** this hook: the port resolution inside it
   * would be a boot-site read of a gated port whichever function it sits in,
   * because `siteAt` is lexical, and this module's own gate is one that can
   * close.
   */
  /**
   * How many orders are attributed to a sales channel (feature 075, D-87).
   *
   * `sales_channels` used to count them itself, naming this module's table and
   * this module's column in raw SQL. A read port would have been the wrong
   * repair for the whole seam: `sales_channels` is `nonDeactivatable`, and the
   * lifecycle refuses to disable a module a non-deactivatable one depends on,
   * so the same edge onto `quote_requests` — switchable, and the other half of
   * that one statement — would have taken the operator's RFQ switch away in
   * order to count rows before a channel delete.
   *
   * A **contribution** hook: it pushes an inert counter into
   * `salesChannelAttributionRegistry`, an ungated registry, and carries no
   * presence probe (D-67/D-68). It contributes nothing else and does no work of
   * its own, so it stays separate from every hook that does.
   */
  ctx.onBoot(() => {
    registerOrderSalesChannelAttributions(
      lazyPort<SalesChannelAttributionRegistryPort>(ctx, 'salesChannelAttributionRegistry'),
      cradle().emFactory,
    );
  });

  ctx.onBoot(() => {
    const registry = cradle().promptActionToolRegistry;
    for (const tool of ordersPromptTools({
      emFactory: cradle().emFactory,
      organizationDetails: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
      customerAccountRead: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
      getTransitionService: transitionService,
    })) {
      registry.register(tool);
    }
  });
}
