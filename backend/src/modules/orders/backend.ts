import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { z } from 'zod';
import type { TransactionalEmailSender } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { OrganizationReadPort } from '../../kernel/ports/organizations.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import type { OrganizationRestrictionService } from '../organizations/services/organization-restriction-service.js';
import { commerceModule, type OrdersModuleOptions } from './plugin.js';
import type { OrderService } from './services/order-service.js';
import type { OrderListService } from './services/order-list-service.js';
import type { OrderTransitionService } from './services/order-transition-service.js';

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
 * the roots that had it, so they are read here now, through the settings port.
 * Both compositions run the same code and the seven behaviours are under test
 * for the first time.
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
  readonly auditLogService: AuditLogService;
  readonly settingsReadPort: SettingsService;
  readonly moduleQueueRedis: Redis | undefined;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: OrdersModuleOptions['requireCustomer'];
  readonly customerContextResolver: OrdersModuleOptions['resolveCustomerContext'];
  readonly customerOrganizationIdResolver: (req: FastifyRequest) => string | null;
  readonly cartService: OrdersModuleOptions['cartService'];
  readonly addressService: OrdersModuleOptions['addressService'];
  readonly customFieldValueService: NonNullable<OrdersModuleOptions['customFieldValues']>;
  readonly creditLimitService: NonNullable<OrdersModuleOptions['creditLimit']>;
  readonly pricingService: NonNullable<OrdersModuleOptions['pricingService']>;
  readonly promotionService: NonNullable<OrdersModuleOptions['promotionService']>;
  readonly rfqService: NonNullable<ReturnType<NonNullable<OrdersModuleOptions['getRfqService']>>>;
  readonly taxService: { taxRateFor(input: TaxRateInput): Promise<{ rate: number }> };
  readonly salesChannelMembershipPort: NonNullable<OrdersModuleOptions['salesChannelMembership']>;
  readonly paymentAdapterRegistry: OrdersModuleOptions['paymentAdapterRegistry'];
  readonly shippingAdapterRegistry: OrdersModuleOptions['shippingAdapterRegistry'];
  readonly paymentOrderStatusRegistry: OrdersModuleOptions['paymentOrderStatusRegistry'];
  readonly shippingMethodEligibility: OrdersModuleOptions['shippingMethodEligibility'];
  readonly requireBoundApiKey: NonNullable<OrdersModuleOptions['requireBoundApiKey']>;
  readonly emailMailer: NonNullable<OrdersModuleOptions['mailer']>;
  readonly organizationReadPort: OrganizationReadPort;
  readonly organizationRestrictionPort: OrganizationRestrictionService;
  /** `transactional_emails`' own accessor since T120, late-bound by that module. */
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  /** Root-shaped, owner `auth`: which organizations a sales-rep admin may see. */
  readonly ordersAdminScopeResolver: NonNullable<OrdersModuleOptions['resolveAdminOrdersScope']>;
  readonly orderServiceAccessor: () => OrderService | null;
  readonly orderListServiceAccessor: () => OrderListService | null;
  readonly orderTransitionServiceAccessor: () => OrderTransitionService | null;
  readonly orders: ReturnType<typeof commerceModule>;
}

type TaxRateInput = {
  country: string;
  productType: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
};

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): OrdersCradle => ctx.cradle<OrdersCradle>();

  /**
   * The three services `commerceModule` hands out at route-registration time.
   * Held here rather than in a root variable — the binding is this module's
   * property, and the modules that read it should not depend on a composition
   * having remembered to wire a sink.
   */
  const exposed: {
    orderService: OrderService | null;
    orderListService: OrderListService | null;
    orderTransitionService: OrderTransitionService | null;
  } = { orderService: null, orderListService: null, orderTransitionService: null };

  /**
   * One read of one of this module's own settings, scoped to the channel the
   * caller is on, degrading to the manifest default. The identical try/catch
   * stood in the production root nine times over.
   */
  const readSetting = async <T>(
    code: string,
    salesChannelId: string,
    schema: Parameters<SettingsService['get']>[2],
    fallback: T,
  ): Promise<T> => {
    try {
      return (await cradle().settingsReadPort.get(code, salesChannelId, schema)) as T;
    } catch {
      return fallback;
    }
  };

  ctx.di.register({
    orders: ctx
      .asFunction(
        ({ emFactory, eventBus, commandBus, auditLogService, moduleQueueRedis }: OrdersCradle) =>
          commerceModule({
            emFactory,
            eventBus,
            commandBus,
            auditLogService,
            ...(moduleQueueRedis === undefined ? {} : { redis: moduleQueueRedis }),
            // Ports, every one of them read lazily: this registration is a
            // singleton and a gate may not be frozen inside one.
            cartService: lazyPort<OrdersCradle['cartService']>(ctx, 'cartService'),
            addressService: lazyPort<OrdersCradle['addressService']>(ctx, 'addressService'),
            customFieldValues: lazyPort<OrdersCradle['customFieldValueService']>(
              ctx,
              'customFieldValueService',
            ),
            creditLimit: lazyPort<OrdersCradle['creditLimitService']>(ctx, 'creditLimitService'),
            pricingService: lazyPort<OrdersCradle['pricingService']>(ctx, 'pricingService'),
            promotionService: lazyPort<OrdersCradle['promotionService']>(ctx, 'promotionService'),
            salesChannelMembership: lazyPort<OrdersCradle['salesChannelMembershipPort']>(
              ctx,
              'salesChannelMembershipPort',
            ),
            paymentAdapterRegistry: cradle().paymentAdapterRegistry,
            shippingAdapterRegistry: cradle().shippingAdapterRegistry,
            paymentOrderStatusRegistry: cradle().paymentOrderStatusRegistry,
            shippingMethodEligibility: cradle().shippingMethodEligibility,
            mailer: lazyPort<OrdersCradle['emailMailer']>(ctx, 'emailMailer'),
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
            // Real per-product VAT from the tax rules; a failure degrades to a
            // flat 23% rather than blocking the order.
            resolveTaxRate: async ({ country, productType, vatStatus }) => {
              try {
                const resolved = await cradle().taxService.taxRateFor({
                  country: country ?? 'PL',
                  productType: productType as TaxRateInput['productType'],
                  vatStatus: vatStatus as TaxRateInput['vatStatus'],
                });
                return resolved.rate;
              } catch {
                return 0.23;
              }
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

  ctx.routes(async (app) => {
    await cradle().orders(app);
  });
}
