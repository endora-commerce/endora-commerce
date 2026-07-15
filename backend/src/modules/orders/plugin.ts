import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { SalesChannelMembershipService } from '../sales_channels/services/sales-channel-membership.service.js';
import { CartService } from '../carts/services/cart-service.js';
import { CartUpsellService } from '../carts/services/cart-upsell-service.js';
import { CartCouponService } from '../carts/services/cart-coupon-service.js';
import { CartConversionService } from '../carts/services/cart-conversion-service.js';
import { CartAdminService } from '../carts/services/cart-admin-service.js';
import { CartAuditService } from '../carts/services/cart-audit-service.js';
import { CartApprovalService } from '../carts/services/cart-approval-service.js';
import { CartOrganizationVisibilityService } from '../carts/services/cart-organization-visibility-service.js';
import { CartRecomputeCache } from '../carts/services/cart-recompute-cache.js';
import { CartPricingRecompute } from '../carts/services/cart-pricing-recompute.js';
import { CartAbandonmentWorker } from '../carts/services/cart-abandonment-worker.js';
import { registerCartsAdminRoutes } from '../carts/routes.admin.js';
import { registerCartsOrganizationRoutes } from '../carts/routes.organization.js';
import type { PricingService } from '../price_lists/services/pricing-service.js';
import { AddressService } from '../addresses/services/address-service.js';
import type { PromotionService } from '../promotions/services/promotion-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';
import type Redis from 'ioredis';
import type { Mailer } from '../email/services/mailer.js';
import {
  OrderService,
  type CreditLimitPort,
  type OrderEventBus,
} from './services/order-service.js';
import { OrderStatusGraphService } from './services/order-status-graph-service.js';
import { OrderTransitionService } from './services/order-transition-service.js';
import { OrderListService } from './services/order-list-service.js';
import { OrderListViewService } from './services/order-list-view-service.js';
import { OrderExportService } from './services/order-export-service.js';
import { OrderCommentService } from './services/order-comment-service.js';
import { OrderReorderService } from './services/order-reorder-service.js';
import { OrderCloneToQuoteService } from './services/order-clone-to-quote-service.js';
import { OrderConfirmationService } from './services/order-confirmation-service.js';
import { OrderCreationAdminService } from './services/order-creation-admin-service.js';
import type { OrganizationConfirmationEmailsPort } from './ports/organization-confirmation-emails.port.js';
import type { FulfilmentStrategy } from '@b2b/contracts';
import { Organization } from '../organizations/entities/organization.entity.js';
import { createBusinessIdGenerator } from './services/business-id-generator.js';
import { registerCartRoutes } from '../carts/routes.js';
import { registerOrderRoutes } from './routes.js';
import {
  registerDeliveryMethodsPublicRoutes,
  registerDeliveryMethodsAdminRoutes,
} from '../delivery_methods/routes.js';
import {
  registerPaymentMethodsPublicRoutes,
  registerPaymentMethodsAdminRoutes,
} from '../payment_methods/routes.js';
import { paymentAdapterRegistry } from '../payment_methods/services/registry-singleton.js';
import { EnumOrderStatusRegistry } from '../payment_methods/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../payments/adapters/built-in-adapters.js';
import { ReceivePaymentHandler, type PaymentEventBus } from '../payments/services/receive-payment-handler.js';
import { PaymentService } from '../payments/services/payment-service.js';
import { registerPaymentsRoutes } from '../payments/routes.js';
// Feature 035 — shipping-method adapter framework + shipment lifecycle.
import { shippingAdapterRegistry } from '../delivery_methods/services/registry-singleton.js';
import { EnumOrderStatusRegistry as ShippingEnumOrderStatusRegistry } from '../delivery_methods/services/order-status-registry.port.js';
import { ShippingMethodEligibilityService } from '../delivery_methods/services/shipping-method-eligibility.js';
import { builtInShippingAdapters } from '../delivery_methods/adapters/built-in-adapters.js';
import { ShipmentService } from '../shipments/services/shipment-service.js';
import { ReceiveShipmentHandler } from '../shipments/services/receive-shipment-handler.js';
import type { ShippingEventBus } from '../shipments/services/events.js';
import { registerShipmentsRoutes } from '../shipments/routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Composition root for the commerce surface — carts + orders + invoice
 * download. CartService is also returned so the organizations module's login
 * flow can merge anonymous baskets.
 */

export interface OrdersModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
    impersonatorAdminUserId?: string | null;
  };
  /** Audit-log writer; OrderService stamps order.place_on_behalf rows on impersonated checkouts. */
  auditLogService?: AuditLogService;
  /** Feature 034 — mailer for the order-confirmation e-mail (best-effort, post-commit). */
  mailer?: Mailer;
  /**
   * Feature 047 — late-bound transactional-email sender. When provided, the order
   * confirmation is rendered from the admin-editable template instead of the
   * in-code builder.
   */
  getTransactionalEmailSender?: () => import('@b2b/contracts').TransactionalEmailSender | undefined;
  /** Optional CreditLimit driver — wired by the credit_limits module composition root. */
  creditLimit?: CreditLimitPort;
  /**
   * Resolver for cart actor (customer OR anonymous). The test helper maps
   * stub cookies + real sessions here; production wires it to the real auth
   * plugin.
   */
  resolveCartActor: (req: FastifyRequest) => {
    customer?: { customerAccountId: string; organizationId: string | null };
    anonymousToken?: string;
  };
  /** Hook — returned cart service so the login route can merge anonymous baskets. */
  exposeCartService?: (service: CartService) => void;
  /**
   * Feature 005 / T027b — when injected, newly-created PaymentMethods and
   * DeliveryMethods auto-bind to the system-default Sales Channel (FR-011).
   */
  salesChannelMembership?: SalesChannelMembershipService;
  /**
   * Optional pricing-engine service. When wired, cart-line creation
   * uses `PricingService.resolveLinePrice()` for the unit price + the
   * displayMode='none' guard (T076 / T084). Foundation tests that
   * don't care about pricing engine semantics can omit it.
   */
  pricingService?: PricingService;
  /**
   * Feature 038 (US3) — org address book service. Used by the admin
   * create-order flow to persist (and clean up) addresses typed inline on the
   * form. Optional so foundation tests that never create inline addresses can
   * omit it.
   */
  addressService?: AddressService;
  /**
   * Feature 026 — optional gate that refuses cart-line-add, place-order, and
   * RFQ-submit when the Customer's Organization is not `active`. Threaded
   * through to both registerCartRoutes and registerOrderRoutes.
   */
  assertOrganizationCanTransact?: (organizationId: string) => Promise<void>;
  /**
   * Feature 026 US4 — When provided, the storefront payment-methods endpoint
   * intersects the active set with the caller's Organization allow-list.
   */
  resolveOrganizationPaymentMethodAllowList?: (req: FastifyRequest) => Promise<string[] | null>;
  /** Feature 026 US4 — same for delivery methods. */
  resolveOrganizationDeliveryMethodAllowList?: (req: FastifyRequest) => Promise<string[] | null>;
  /**
   * Feature 026 US6 — sales-rep ownership scoping for the admin orders list.
   * Platform admins return `{ allowAll: true }`; sales reps return the set
   * of organization ids they own.
   */
  resolveAdminOrdersScope?: (req: FastifyRequest) => Promise<
    | { allowAll: true }
    | { allowAll: false; allowedOrganizationIds: string[] }
  >;
  /**
   * Feature 027 — Cross-module port that pushes a cart line into one of
   * the buyer's shopping lists. The carts module calls this when the
   * buyer clicks "Save to Purchase List". Wired by the shopping_lists
   * module composition.
   */
  pushLineToShoppingList?: (input: {
    customerAccountId: string;
    organizationId: string | null;
    shoppingListId: string;
    productId: string;
    variantId: string | null;
    quantity: number;
  }) => Promise<void>;
  /**
   * Feature 027 US2 — promotion engine used by the cart's coupon flow.
   * When provided, `POST /api/v1/cart/coupon` validates the code via
   * `applyToCart`. Optional so legacy compositions still build.
   */
  promotionService?: PromotionService;
  /**
   * Feature 027 US3 — getter for the RFQ service used by Cart → Quote
   * Request and Quote Request → Cart conversions. Getter (not direct
   * reference) so the QR module can be constructed AFTER commerceModule
   * in composition.ts; the closure resolves lazily at request time.
   */
  getRfqService?: () => RfqService | null;
  /**
   * Feature 039 — late-bind the OrderService back to composition so the
   * quick_order module's one-click flow can reuse `placeOrder` without the
   * orders module depending on quick_order.
   */
  exposeOrderService?: (service: OrderService) => void;
  /**
   * Feature 040 — late-bind the OrderListService back to composition so the
   * customers module can list a single Customer's orders (self-service
   * history + admin customer-detail panel) without importing orders' internals.
   */
  exposeOrderListService?: (service: OrderListService) => void;
  /**
   * Feature 043 — exposes the configured OrderTransitionService (with its
   * cancellation side-effects + veto guards) so the orders prompt-action
   * tools route status changes through the exact same engine the admin
   * routes use, instead of a fresh, guard-less instance.
   */
  exposeOrderTransitionService?: (service: OrderTransitionService) => void;
  /**
   * Feature 027 US3 — port that appends a Shopping List's lines to the
   * buyer's cart. Wired by composition to ShoppingListService.convertToCart.
   */
  appendShoppingListToCart?: (input: {
    customerAccountId: string;
    organizationId: string | null;
    shoppingListId: string;
  }) => Promise<{
    cartId: string;
    appendedLineCount: number;
    droppedLines: Array<{ productId: string; productName: string; reason: string }>;
  }>;
  /**
   * Feature 027 §R5 — Redis client used by the cart-pricing-recompute
   * cache. When provided alongside `pricingService`, every full-cart
   * read re-resolves unit prices through PricingService with a 30 s
   * Redis cache. Without it, the snapshotted unit_price is returned.
   */
  redis?: Redis;
  /**
   * Feature 027 US5 — resolves the current
   * `carts.abandonment.inactivity_minutes` setting. Wired by composition.
   * `0` disables the sweep.
   */
  resolveCartAbandonmentInactivityMinutes?: () => Promise<number>;
  /**
   * Feature 027 US5 — resolves the current
   * `carts.abandonment.notification_recipient` setting. Wired by composition.
   * Empty string = no notification e-mail.
   */
  resolveCartAbandonmentNotificationRecipient?: () => Promise<string>;
  /**
   * Feature 027 US5 — outbound notification dispatch. When omitted, the
   * sweep still flips status but suppresses the e-mail.
   */
  dispatchCartAbandonmentNotification?: (input: {
    recipientEmail: string;
    cartId: string;
    ownerDisplayName: string | null;
    lineCount: number;
    organizationId: string | null;
  }) => Promise<void>;
  /**
   * Feature 027 US5 — hook for the future scheduler / test harness to
   * grab the worker handle. The worker exposes `sweep(now?)` for direct
   * invocation; production scheduling is an operational concern.
   */
  exposeCartAbandonmentWorker?: (worker: CartAbandonmentWorker) => void;
  /**
   * Feature 036 — resolves the channel-scoped `orders.business_id.prefix`
   * setting for the business Order ID. Wired by composition through
   * SettingsService; failures/defaults resolve to ''. Omit ⇒ no prefix.
   */
  resolveOrderBusinessIdPrefix?: (salesChannelId: string) => Promise<string>;
  /** Feature 036 — same for `orders.business_id.suffix`. */
  resolveOrderBusinessIdSuffix?: (salesChannelId: string) => Promise<string>;
  /** Feature 038 US6 — resolves `orders.reorder_enabled` per Sales Channel. Omit ⇒ enabled. */
  resolveReorderEnabled?: (salesChannelId: string) => Promise<boolean>;
  /** Feature 038 US4 — resolves `orders.confirmation_recipients` per Sales Channel. Omit ⇒ none. */
  resolveOrderConfirmationRecipients?: (salesChannelId: string) => Promise<string[]>;
  /** Feature 038 US3/FR-035 — resolves `orders.min_order_value` per Sales Channel. Omit ⇒ no minimum. */
  resolveMinOrderValue?: (salesChannelId: string) => Promise<number>;
  /**
   * Sales-channel layer of the fulfilment-strategy precedence chain — resolves
   * `inventory.fulfilment_strategy` (+ its warehouse order) per Sales Channel
   * via the Settings module. Omit ⇒ order placement falls back to
   * `default_first` / `[]`.
   */
  resolveChannelFulfilmentStrategy?: (salesChannelId: string) => Promise<FulfilmentStrategy>;
  resolveChannelFulfilmentWarehouseOrder?: (salesChannelId: string) => Promise<string[]>;
  /**
   * Global backorder gate (`inventory.allow_negative_stock`) resolved per
   * sales channel. When unwired the gate defaults to off.
   */
  resolveChannelAllowNegativeStock?: (salesChannelId: string) => Promise<boolean>;
  /**
   * Real per-product VAT — resolves the rate (fraction, e.g. `0.23`) for a
   * product line from its tax class, billing country, and org VAT status. Omit
   * ⇒ placeOrder falls back to a flat 23%.
   */
  resolveTaxRate?: (input: {
    country: string | null;
    productType: string;
    vatStatus: string;
  }) => Promise<number>;
}

export function commerceModule(options: OrdersModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    // Feature 027 — construct audit + approval services first so the
    // mutation surfaces (CartService, CartCouponService) can wire the
    // re-arm hook through their optional approvalService param.
    const cartAuditService = options.auditLogService
      ? new CartAuditService(options.emFactory, options.auditLogService)
      : undefined;
    const cartApprovalService = cartAuditService
      ? new CartApprovalService(options.emFactory, cartAuditService)
      : undefined;

    // Construct the recompute cache early so CartService can invalidate
    // it on every cart-side write (feature 027 data-model.md / §R5
    // "Cleared on every cart-side write").
    const cartRecomputeCacheEarly = options.redis
      ? new CartRecomputeCache(options.redis)
      : undefined;

    const cartService = new CartService(
      options.emFactory,
      options.pricingService,
      cartApprovalService,
      cartAuditService,
      cartRecomputeCacheEarly,
    );
    // Feature 034 — payment adapter framework. Built-in adapters are populated
    // into the process-wide singleton (registry-singleton.ts) idempotently, so
    // external payment-method modules that registered their adapter from a
    // lifecycle install hook share the same instance the live routes use. The
    // OrderStatusRegistry port resolves statusOn* references (enum-backed until
    // the Orders module ships a configurable registry).
    for (const adapter of builtInPaymentAdapters()) {
      if (!paymentAdapterRegistry.isRegistered(adapter.adapterKey)) {
        paymentAdapterRegistry.register(adapter);
      }
    }
    const orderStatusRegistry = new EnumOrderStatusRegistry();

    // Feature 035 — shipping-method adapter framework. Built-in offline adapters
    // are populated into the process-wide singleton idempotently, so external
    // shipping-method modules that registered their adapter from a lifecycle
    // install hook share the same instance the live routes use. The shipping
    // OrderStatusRegistry resolves statusOnSuccess/Failure references.
    for (const adapter of builtInShippingAdapters()) {
      if (!shippingAdapterRegistry.isRegistered(adapter.adapterKey)) {
        shippingAdapterRegistry.register(adapter);
      }
    }
    const shippingOrderStatusRegistry = new ShippingEnumOrderStatusRegistry();
    const shippingEligibility = new ShippingMethodEligibilityService(shippingAdapterRegistry);

    // Feature 036 — business Order ID generator. Adapts the composition-wired
    // prefix/suffix resolver closures (SettingsService-backed) to the
    // generator's settings port; the generator itself draws the sequence.
    const businessIdGenerator = createBusinessIdGenerator(
      options.resolveOrderBusinessIdPrefix || options.resolveOrderBusinessIdSuffix
        ? {
            resolvePrefix: (salesChannelId: string) =>
              options.resolveOrderBusinessIdPrefix?.(salesChannelId) ?? Promise.resolve(''),
            resolveSuffix: (salesChannelId: string) =>
              options.resolveOrderBusinessIdSuffix?.(salesChannelId) ?? Promise.resolve(''),
          }
        : undefined,
    );

    // Feature 038 US4 — additional confirmation recipients (per-org + scope).
    const orgConfirmationEmailsPort: OrganizationConfirmationEmailsPort = {
      getConfirmationEmails: async (organizationId: string) => {
        const org = await options.emFactory().findOne(Organization, { id: organizationId });
        return org?.orderConfirmationEmails ?? [];
      },
    };
    const orderConfirmationService = new OrderConfirmationService(
      orgConfirmationEmailsPort,
      options.resolveOrderConfirmationRecipients,
    );

    const orderService = new OrderService(
      options.emFactory,
      options.eventBus as OrderEventBus,
      options.auditLogService,
      options.creditLimit,
      undefined,
      {
        paymentAdapters: paymentAdapterRegistry,
        orderStatusRegistry,
        shippingAdapters: shippingAdapterRegistry,
        businessId: businessIdGenerator,
        confirmationRecipients: (input) =>
          orderConfirmationService.resolveAdditional(input.organizationId, input.salesChannelId),
        ...(options.resolveMinOrderValue ? { resolveMinOrderValue: options.resolveMinOrderValue } : {}),
        ...(options.resolveChannelFulfilmentStrategy
          ? { resolveChannelFulfilmentStrategy: options.resolveChannelFulfilmentStrategy }
          : {}),
        ...(options.resolveChannelFulfilmentWarehouseOrder
          ? { resolveChannelFulfilmentWarehouseOrder: options.resolveChannelFulfilmentWarehouseOrder }
          : {}),
        ...(options.resolveChannelAllowNegativeStock
          ? { resolveChannelAllowNegativeStock: options.resolveChannelAllowNegativeStock }
          : {}),
        // Feature 036 (US3) — PromotionService satisfies PromotionPort
        // structurally; threaded so placeOrder stamps the cart's coupon
        // discount onto the Order.
        ...(options.promotionService ? { promotion: options.promotionService } : {}),
        ...(options.resolveTaxRate ? { resolveTaxRate: options.resolveTaxRate } : {}),
        ...(options.mailer ? { mailer: options.mailer } : {}),
        ...(options.getTransactionalEmailSender
          ? { getTransactionalEmailSender: options.getTransactionalEmailSender }
          : {}),
      },
    );
    if (options.exposeCartService) options.exposeCartService(cartService);

    // Feature 038 — configurable lifecycle. The transition engine validates
    // against the DB-backed graph, runs veto guards, and emits the templated
    // status events. Cancellation side-effects (release stock allocations +
    // credit-limit reservation) are applied through the side-effects hook.
    const orderStatusGraphService = new OrderStatusGraphService(options.emFactory);
    const orderTransitionService = new OrderTransitionService(
      options.emFactory,
      options.eventBus,
      orderStatusGraphService,
      async ({ order, to }) => {
        if (to === 'cancelled') {
          if (options.creditLimit) {
            await options.creditLimit.releaseByOrder({ orderId: order.id, reason: 'order_cancelled' });
          }
          await orderService.releaseAllocations(order.id);
        }
      },
    );
    // Feature 043 — hand the configured transition engine to composition so the
    // orders prompt-action tools reuse it (guards + cancel side-effects).
    if (options.exposeOrderTransitionService) {
      options.exposeOrderTransitionService(orderTransitionService);
    }
    // Feature 038 US2 — orders list query, saved views, CSV export.
    const orderListService = new OrderListService(options.emFactory, orderStatusGraphService);
    if (options.exposeOrderListService) options.exposeOrderListService(orderListService);
    const orderListViewService = new OrderListViewService(options.emFactory);
    const orderExportService = new OrderExportService(orderListService);
    const orderCommentService = new OrderCommentService(
      options.emFactory,
      orderStatusGraphService,
      options.mailer,
      options.getTransactionalEmailSender,
    );
    const orderReorderService = new OrderReorderService(
      options.emFactory,
      options.resolveReorderEnabled,
      options.mailer,
      options.getTransactionalEmailSender,
    );
    const orderCloneToQuoteService = new OrderCloneToQuoteService(
      options.emFactory,
      () => options.getRfqService?.() ?? null,
    );
    const addressService = options.addressService ?? new AddressService(options.emFactory);
    const orderCreationAdminService = new OrderCreationAdminService(
      options.emFactory,
      cartService,
      orderService,
      addressService,
      options.mailer,
      options.getTransactionalEmailSender,
    );

    const cartUpsellService = new CartUpsellService(options.emFactory);
    const cartCouponService = options.promotionService
      ? new CartCouponService(
          options.emFactory,
          options.promotionService,
          cartApprovalService,
        )
      : undefined;
    const cartPricingRecompute =
      cartRecomputeCacheEarly && options.pricingService
        ? new CartPricingRecompute(
            options.emFactory,
            options.pricingService,
            cartRecomputeCacheEarly,
          )
        : undefined;
    const cartAdminService = cartAuditService
      ? new CartAdminService(
          options.emFactory,
          cartAuditService,
          ...(options.promotionService ? ([options.promotionService] as const) : ([] as const)),
        )
      : undefined;
    // Build a thin lazy-resolving wrapper so the QR service can be
    // injected after commerceModule is constructed (chicken-and-egg in
    // composition.ts).
    const lazyRfqProxy = options.getRfqService
      ? (new Proxy({} as RfqService, {
          get: (_target, prop) => {
            const svc = options.getRfqService?.();
            if (!svc) throw new Error('RfqService not yet available');
            return Reflect.get(svc, prop, svc);
          },
        }) as RfqService)
      : null;
    const cartConversionService = lazyRfqProxy
      ? new CartConversionService(options.emFactory, cartService, lazyRfqProxy)
      : undefined;

    await registerCartRoutes(app, {
      cartService,
      cartUpsellService,
      ...(cartCouponService ? { cartCouponService } : {}),
      ...(cartConversionService ? { cartConversionService } : {}),
      ...(cartPricingRecompute ? { cartPricingRecompute } : {}),
      resolveCartActor: options.resolveCartActor,
      emFactory: options.emFactory,
      ...(options.assertOrganizationCanTransact
        ? { assertOrganizationCanTransact: options.assertOrganizationCanTransact }
        : {}),
      ...(options.pushLineToShoppingList
        ? { pushLineToShoppingList: options.pushLineToShoppingList }
        : {}),
      ...(options.appendShoppingListToCart
        ? { appendShoppingListToCart: options.appendShoppingListToCart }
        : {}),
    });
    if (options.exposeOrderService) options.exposeOrderService(orderService);

    await registerOrderRoutes(app, {
      orderService,
      orderStatusGraphService,
      orderTransitionService,
      orderListService,
      orderListViewService,
      orderExportService,
      orderCommentService,
      orderReorderService,
      orderCloneToQuoteService,
      orderCreationAdminService,
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      requireAdmin: options.requireAdmin,
      resolveCustomerContext: options.resolveCustomerContext,
      ...(options.pricingService ? { pricingService: options.pricingService } : {}),
      ...(options.assertOrganizationCanTransact
        ? { assertOrganizationCanTransact: options.assertOrganizationCanTransact }
        : {}),
      ...(options.resolveAdminOrdersScope
        ? { resolveAdminOrdersScope: options.resolveAdminOrdersScope }
        : {}),
    });
    await registerDeliveryMethodsPublicRoutes(app, {
      emFactory: options.emFactory,
      registry: shippingAdapterRegistry,
      eligibility: shippingEligibility,
      ...(options.resolveOrganizationDeliveryMethodAllowList
        ? { resolveOrganizationDeliveryMethodAllowList: options.resolveOrganizationDeliveryMethodAllowList }
        : {}),
    });
    await registerPaymentMethodsPublicRoutes(app, {
      emFactory: options.emFactory,
      registry: paymentAdapterRegistry,
      ...(options.resolveOrganizationPaymentMethodAllowList
        ? { resolveOrganizationPaymentMethodAllowList: options.resolveOrganizationPaymentMethodAllowList }
        : {}),
    });
    await registerDeliveryMethodsAdminRoutes(app, {
      emFactory: options.emFactory,
      requireAdmin: options.requireAdmin,
      registry: shippingAdapterRegistry,
      orderStatusRegistry: shippingOrderStatusRegistry,
      ...(options.salesChannelMembership
        ? { salesChannelMembership: options.salesChannelMembership }
        : {}),
    });
    await registerPaymentMethodsAdminRoutes(app, {
      emFactory: options.emFactory,
      requireAdmin: options.requireAdmin,
      registry: paymentAdapterRegistry,
      orderStatusRegistry,
      ...(options.salesChannelMembership
        ? { salesChannelMembership: options.salesChannelMembership }
        : {}),
    });
    // Feature 034 — payment lifecycle: receive_payment ingress, retry, history.
    await registerPaymentsRoutes(app, {
      requireAdmin: options.requireAdmin,
      receiveHandler: new ReceivePaymentHandler(
        options.emFactory,
        orderStatusRegistry,
        options.eventBus as PaymentEventBus,
      ),
      paymentService: new PaymentService(options.emFactory),
    });

    // Feature 035 — shipment lifecycle: shipment_created, receive_shipment,
    // retry, history.
    await registerShipmentsRoutes(app, {
      requireAdmin: options.requireAdmin,
      receiveHandler: new ReceiveShipmentHandler(
        options.emFactory,
        shippingOrderStatusRegistry,
        options.eventBus as ShippingEventBus,
      ),
      shipmentService: new ShipmentService(
        options.emFactory,
        shippingAdapterRegistry,
        options.eventBus as ShippingEventBus,
      ),
    });

    // Feature 027 US5 — abandonment-sweep worker. Constructed when the
    // settings resolvers are wired; exposed via the optional hook so a
    // future scheduler / test harness can invoke `sweep(now?)` directly.
    if (
      cartAuditService &&
      options.resolveCartAbandonmentInactivityMinutes &&
      options.resolveCartAbandonmentNotificationRecipient
    ) {
      const abandonmentWorker = new CartAbandonmentWorker({
        emFactory: options.emFactory,
        cartAuditService,
        resolveInactivityMinutes: options.resolveCartAbandonmentInactivityMinutes,
        resolveNotificationRecipient: options.resolveCartAbandonmentNotificationRecipient,
        ...(options.dispatchCartAbandonmentNotification
          ? { dispatchNotification: options.dispatchCartAbandonmentNotification }
          : {}),
      });
      if (options.exposeCartAbandonmentWorker) {
        options.exposeCartAbandonmentWorker(abandonmentWorker);
      }
    }

    // Feature 027 US4 — Organization-Administrator visibility + approval
    // workflow. cartApprovalService already constructed above so the
    // re-arm hook works on every cart-mutation surface.
    if (cartApprovalService) {
      const visibilityService = new CartOrganizationVisibilityService(options.emFactory);
      await registerCartsOrganizationRoutes(app, {
        cartService,
        cartApprovalService,
        visibilityService,
        emFactory: options.emFactory,
        resolveCartActor: options.resolveCartActor,
      });
    }

    if (cartAdminService) {
      await registerCartsAdminRoutes(app, {
        cartAdminService,
        ...(cartApprovalService ? { cartApprovalService } : {}),
        requireAdmin: options.requireAdmin,
        resolveAdminUserId: (req: FastifyRequest): string | null => {
          // Production rig: `request.actor` (set by the auth plugin).
          // Test rig: `request.testActor` (set by test-actors.ts).
          const prodActor = (req as { actor?: { kind?: string; adminUserId?: string } }).actor;
          if (prodActor?.kind === 'admin' && prodActor.adminUserId) return prodActor.adminUserId;
          const testActor = (req as { testActor?: { kind?: string; adminUserId?: string } }).testActor;
          if (testActor?.kind === 'admin' && testActor.adminUserId) return testActor.adminUserId;
          return null;
        },
      });
    }
  };
}
