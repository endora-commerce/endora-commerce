import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { CommandBus } from '../../commands/index.js';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { SalesChannelMembershipPort } from '../../kernel/ports/sales-channel.js';
import type { Redis } from 'ioredis';
import type { EmailMailerPort } from '@endora-commerce/contracts';
import {
  OrderService,
  type OrderEventBus,
  // The five em-carrying interfaces their owners write (D-94.5, D-169),
  // re-exported by `order-service.ts` — which is where each seam is stated and
  // where the permanent ledger entries sit.
  type CartPlacementApplyPort,
  type CreditLimitPort,
  type InventoryReservationApplyPort,
  type InvoicePlacementApplyPort,
  type PromotionUsageFinalizer,
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
import { CustomerOrderCancellationService } from './services/order-cancellation-service.js';
import { OrderApiIntakeService } from './services/order-api-intake-service.js';
import { registerOrdersExternalRoutes } from './routes.external.js';
import type { OrganizationConfirmationEmailsPort } from './ports/organization-confirmation-emails.port.js';
import type {
  AddressReadPort,
  AddressServicePort,
  AssetReadPort,
  CustomFieldValuePort,
  CartReadPort,
  CartWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  DeliveryMethodReadPort,
  FulfilmentStrategy,
  InventoryFulfilmentPlanningPort,
  InventoryStockReadPort,
  InvoicePdfPort,
  InvoiceReadPort,
  LinePricePort,
  OrderStatusRegistry,
  OrderTransitionPort,
  OrganizationDetailsPort,
  PaymentAdapterRegistryPort,
  PaymentMethodReadPort,
  PromotionApplyPort,
  RfqCustomerPort,
  ShippingAdapterRegistryPort,
} from '@endora-commerce/contracts';
import { createBusinessIdGenerator } from './services/business-id-generator.js';
import { registerOrderRoutes } from './routes.js';
import type { PurchaseConversionService } from './services/purchase-conversion-service.js';
import type { OrderConfirmationRenderers } from './email-templates/order-confirmation.js';
import { mayHoldCreditLimitReservation } from './domain/credit-limit-reservation.js';
// Feature 035 — shipping-method adapter framework + shipment lifecycle.
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Composition root for the commerce surface — carts + orders + invoice
 * download. CartService is also returned so the organizations module's login
 * flow can merge anonymous baskets.
 */

export interface OrdersModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  /** Feature 054 — audits order-config/comment writes co-transactionally when provided. */
  commandBus?: CommandBus;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
    impersonatorAdminUserId?: string | null;
  };
  /** Audit-log writer; OrderService stamps order.place_on_behalf rows on impersonated checkouts. */
  auditLogService?: AuditPort;
  /** Feature 055 — validates + persists Order custom-field values on the admin edit path. */
  customFieldValues?: CustomFieldValuePort;
  /** Feature 034 — mailer for the order-confirmation e-mail (best-effort, post-commit). */
  mailer?: EmailMailerPort;
  /**
   * Feature 047 — late-bound transactional-email sender. When provided, the order
   * confirmation is rendered from the admin-editable template instead of the
   * in-code builder.
   */
  getTransactionalEmailSender?: () => import('@endora-commerce/contracts').TransactionalEmailSender | undefined;
  /** Optional CreditLimit driver — wired by the credit_limits module composition root. */
  creditLimit?: CreditLimitPort;
  /**
   * Feature 075 — the order-confirmation e-mail's two adapter-rendered lines.
   *
   * An accessor, read per send: `payments` and `shipments` own the two renderer
   * registries and both are deactivatable, so the answer is theirs to give at
   * the moment the message is built. Omit ⇒ this module's own baselines.
   */
  confirmationRenderers?: () => OrderConfirmationRenderers;
  /**
   * Feature 005 / T027b — when injected, newly-created PaymentMethods and
   * DeliveryMethods auto-bind to the system-default Sales Channel (FR-011).
   */
  salesChannelMembership?: SalesChannelMembershipPort;
  /**
   * The pricing engine. Cart-line creation uses
   * `PricingService.resolveLinePrice()` for the unit price and the
   * displayMode='none' guard (T076 / T084).
   *
   * Required since issue #124. It was optional, and "omitted" and "the module
   * an operator switched off" were the same thing at every call site: both
   * produced `null`, and every consumer then priced the line from the
   * catalogue's legacy `defaultPrice` attribute. Absence is now a `lazyPort`
   * gate that throws `MODULE_DISABLED`, which nothing can mistake for a price.
   */
  pricingService: LinePricePort;
  /**
   * Feature 038 (US3) — the org address book. The admin create-order flow and
   * the external intake persist (and clean up) addresses typed inline on the
   * form through it.
   *
   * Required since feature 072 (T090). It used to fall back to a bare
   * `AddressService` built from `emFactory` alone — no dictionary validator and
   * no audit writer — so a caller that forgot the option got silently
   * unvalidated, unaudited address writes on the checkout path.
   *
   * `AddressServicePort` since feature 075: it is `addresses`' published write
   * surface, and the one-default-per-kind invariant and the country-code
   * validation stay on that side of it, where they already are.
   */
  addressService: AddressServicePort;
  /** `addresses`' read surface — placement snapshots the two chosen addresses. */
  addressRead: AddressReadPort;
  /**
   * `carts`' published write surface. **`cartWritePort`, not `cartService`**:
   * `carts/backend.ts` registers both, and the second hands out the class,
   * which still passes `Cart` and `CartItem` entities across the boundary.
   * The admin create-order path and the external intake seed a cart with it.
   */
  cartWritePort: CartWritePort;
  /**
   * `carts`' basket-half-of-placement seam (feature 080, T048).
   *
   * A third `carts` name beside `cartWritePort` and `cartRead`, and the three
   * differ on the transaction they run in — which is the only axis that
   * matters here. `cartWritePort` opens its own; `cartRead` reads on the
   * owner's own `EntityManager`; this one takes **placement's**, because
   * `carts_completed_order_fk` holds the completion and the order together.
   * `carts` is non-deactivatable, so it is a value and not an accessor.
   */
  cartPlacementApply: CartPlacementApplyPort;
  /**
   * `carts`' standalone read — the total preview, which opens no transaction.
   * Handing it an `EntityManager` would re-open a write seam to serve a read
   * (D-169), which is why it is a different port from the one above.
   */
  cartRead: CartReadPort;
  /**
   * The read models the route surface, the external intake and the admin
   * create path resolve from the modules that own the rows (feature 075).
   */
  catalogProductRead: CatalogProductReadPort;
  customerAccountRead: CustomerAccountReadPort;
  organizationDetails: OrganizationDetailsPort;
  /** Accessors: both owners are deactivatable `degrades-without` edges. */
  deliveryMethodRead: () => DeliveryMethodReadPort | null;
  paymentMethodRead: () => PaymentMethodReadPort | null;
  /**
   * This module's own lifecycle-write port (feature 085).
   *
   * Handed in rather than reached for: the port is registered in `backend.ts`,
   * which is where every gate in this module is applied, and the buyer's
   * cancellation is a caller of the seam like any other. Resolving it here
   * would need the container, which a module does not see.
   */
  orderTransitionPort: OrderTransitionPort;
  /**
   * The three `inventory` ports the stock reservation runs on, as one accessor
   * (D-94.4, issue #188; feature 080, T048). `null` ⇒ `inventory` is not
   * effectively present, and placement skips the reservation whole and the
   * cancellation releases nothing — `orders` declares the edges
   * `degrades-without` with exactly those sentences.
   */
  inventory: () => {
    readonly stockRead: InventoryStockReadPort;
    readonly planning: InventoryFulfilmentPlanningPort;
    readonly reservationApply: InventoryReservationApplyPort;
  } | null;
  assetRead: AssetReadPort;
  /**
   * `invoices` is deactivatable and declares this module, so its two ports are
   * accessors and the edge is `degrades-without`: `null` ⇒ no invoice surface.
   */
  invoiceRead: () => InvoiceReadPort | null;
  invoicePdf: () => InvoicePdfPort | null;
  /**
   * The proforma placement opens (feature 080, T048). An accessor for the same
   * reason the two above are: the module is switchable, this one is not, and
   * with invoicing off placement opens no document and changes nothing else.
   */
  invoicePlacementApply: () => InvoicePlacementApplyPort | null;
  /**
   * The two method modules' registries and the delivery-eligibility service.
   * `orders` reads them for placement dispatch and for the `statusOn*`
   * references (feature 072, T095/T097), so it receives them instead of
   * building them — and receives them as **accessors** rather than as values
   * (feature 074, FR-024).
   *
   * The difference is when the container is asked. Passing the values meant
   * `orders` resolved four of another module's registrations at the moment its
   * own registration was constructed, and held them for the life of the
   * process: the deactivation ledger's first unacceptable shape, because a
   * captured registration keeps answering after its owner is switched off, and
   * no manifest entry can make that untrue. An accessor is read where it is
   * used, so the answer is the one the container has then.
   */
  paymentAdapterRegistry: () => PaymentAdapterRegistryPort;
  shippingAdapterRegistry: () => ShippingAdapterRegistryPort;
  paymentOrderStatusRegistry: () => OrderStatusRegistry;
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
   * Feature 027 US2 — promotion engine used by the cart's coupon flow.
   * When provided, `POST /api/v1/cart/coupon` validates the code via
   * `applyToCart`. Optional so legacy compositions still build.
   *
   * `PromotionApplyPort` since D-94.5 — the contract `promotions` publishes,
   * rather than a near-identical interface this module used to declare and
   * nothing checked the provider against.
   */
  promotionService?: PromotionApplyPort;
  /**
   * The redemption row placement writes on its own `EntityManager` (D-94.5).
   * A separate name because it is a separate port: `promotions` declares the
   * interface, because the signature carries a MikroORM type that FR-034 keeps
   * out of `@endora-commerce/contracts`.
   */
  promotionUsageFinalizer?: PromotionUsageFinalizer;
  /**
   * Feature 027 US3 — getter for the RFQ service used by Cart → Quote
   * Request and Quote Request → Cart conversions. Getter (not direct
   * reference) so the QR module can be constructed AFTER commerceModule
   * in composition.ts; the closure resolves lazily at request time.
   */
  getRfqService?: () => RfqCustomerPort | null;
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
   * Feature 085 — exposes the configured OrderStatusGraphService, so
   * `orderTransitionPort` reads terminality and edge existence from the same
   * instance the routes and the transition engine use. It caches the graph
   * in-process and invalidates only on its own writes, so a second instance
   * built beside it would answer from a cache no admin edit ever clears.
   */
  exposeOrderStatusGraphService?: (service: OrderStatusGraphService) => void;
  /**
   * Feature 027 §R5 — Redis client used by the cart-pricing-recompute
   * cache. When provided alongside `pricingService`, every full-cart
   * read re-resolves unit prices through PricingService with a 30 s
   * Redis cache. Without it, the snapshotted unit_price is returned.
   */
  redis?: Redis;
  /**
   * Issue #277 — the per-order claim on the GA4 `purchase` conversion. Built
   * by this module's `backend.ts` so that the placement subscriber and the
   * buyer-facing route spend the same one.
   */
  purchaseConversion: PurchaseConversionService;
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
  /**
   * Feature 038 US3/FR-035 — resolves `orders.min_order_value` per Sales
   * Channel. Omit ⇒ no minimum; `null` ⇒ read it platform-wide (issue #103).
   */
  resolveMinOrderValue?: (salesChannelId: string | null) => Promise<number>;
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
   * product line from its tax class, billing country, and org VAT status.
   *
   * Required since issue #124: omitting it used to mean "price the order at a
   * flat 23%", which is a figure no rule in the deployment supports, printed on
   * a real invoice. An absent `taxes` module surfaces through this resolver as
   * the 503 `MODULE_DISABLED` envelope instead.
   */
  resolveTaxRate: (input: {
    country: string | null;
    productType: string;
    vatStatus: string;
  }) => Promise<number>;
  /**
   * Feature 062 — bound-api-key gate from the api_keys module handle. When
   * provided, the external orders namespace (`/api/v1/external/orders*`) is
   * mounted (routes.external.ts); the customer surface stays untouched.
   */
  requireBoundApiKey?: (
    scope: string,
  ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /**
   * Feature 062 / FR-021 — the org's payment/delivery allow-lists (feature
   * 026 restriction service; empty list = unrestricted). The external intake
   * enforces them at submit with the customer flow's method-unavailable
   * refusal, since this surface has no listing/preflight step.
   */
  resolveOrganizationMethodAllowLists?: (organizationId: string) => Promise<{
    paymentMethodIds: string[];
    deliveryMethodIds: string[];
  } | null>;
}

export function commerceModule(options: OrdersModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    // Feature 072 (T136) — every cart service moved to `carts`, which registers
    // them unconditionally. This root used to build them here in a chain where
    // each optional argument disabled the next thing, so a missing
    // `auditLogService` silently removed the organization approval routes and a
    // missing `redis` silently stopped prices being re-resolved. `orders` reads
    // the one service it genuinely consumes as a required option.
    // Feature 072 (T095/T097) — the two method modules own their registries,
    // their eligibility services and their routes now. `orders` still reads
    // them for placement and for the order-status references, so it takes them
    // as options rather than building them — as accessors since feature 074,
    // read here rather than when this module's registration was constructed.
    const paymentAdapterRegistry = options.paymentAdapterRegistry();
    const shippingAdapterRegistry = options.shippingAdapterRegistry();
    const orderStatusRegistry = options.paymentOrderStatusRegistry();

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
        // Feature 075 — the addresses an organisation wants copied on every
        // confirmation are `organizations`' column, read over its port. This
        // used to be `em.findOne(Organization, …)` on this module's manager.
        const org = await options.organizationDetails.findById(organizationId);
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
        // Feature 036 (US3) — threaded so placeOrder stamps the cart's coupon
        // discount onto the Order, and D-94.5's finalizer beside it for the
        // redemption row that goes in the same transaction.
        ...(options.promotionService ? { promotion: options.promotionService } : {}),
        ...(options.promotionUsageFinalizer
          ? { promotionUsageFinalizer: options.promotionUsageFinalizer }
          : {}),
        resolveTaxRate: options.resolveTaxRate,
        neighbours: {
          organizationDetails: options.organizationDetails,
          customerAccountRead: options.customerAccountRead,
          addressRead: options.addressRead,
          catalogProductRead: options.catalogProductRead,
          paymentMethodRead: options.paymentMethodRead,
          deliveryMethodRead: options.deliveryMethodRead,
          inventory: options.inventory,
          cartPlacementApply: options.cartPlacementApply,
          cartRead: options.cartRead,
          invoicePlacementApply: options.invoicePlacementApply,
        },
        ...(options.mailer ? { mailer: options.mailer } : {}),
        ...(options.confirmationRenderers
          ? { confirmationRenderers: options.confirmationRenderers }
          : {}),
        ...(options.getTransactionalEmailSender
          ? { getTransactionalEmailSender: options.getTransactionalEmailSender }
          : {}),
      },
    );

    // Feature 038 — configurable lifecycle. The transition engine validates
    // against the DB-backed graph, runs veto guards, and emits the templated
    // status events. Cancellation side-effects (release stock allocations +
    // credit-limit reservation) are applied through the side-effects hook.
    const orderStatusGraphService = new OrderStatusGraphService(options.emFactory, options.commandBus);
    const orderTransitionService = new OrderTransitionService(
      options.emFactory,
      options.eventBus,
      orderStatusGraphService,
      async ({ order, to }) => {
        if (to === 'cancelled') {
          // D-179.3 — only an order placed against a credit limit holds a
          // reservation, and `paymentMethodSnapshot.kind` is this module's own
          // record of that. Asking the gated port about every cancellation is
          // what made an operator who switched `credit_limits` off unable to
          // cancel any order at all; an order that did draw credit still
          // refuses, which is the half that must not be caught.
          if (options.creditLimit && mayHoldCreditLimitReservation(order)) {
            await options.creditLimit.releaseByOrder({ orderId: order.id, reason: 'order_cancelled' });
          }
          await orderService.releaseAllocations(order.id);
        }
      },
      options.auditLogService,
    );
    // Feature 043 — hand the configured transition engine to composition so the
    // orders prompt-action tools reuse it (guards + cancel side-effects).
    if (options.exposeOrderTransitionService) {
      options.exposeOrderTransitionService(orderTransitionService);
    }
    if (options.exposeOrderStatusGraphService) {
      options.exposeOrderStatusGraphService(orderStatusGraphService);
    }
    // Feature 085 (US3) — the buyer's own cancellation. It writes through
    // `orderTransitionPort` rather than through the service beside it: the port
    // is the seam as this module publishes it, it answers a refusal as a value,
    // and going through it means the buyer's cancellation gets the stock and
    // credit release and the audit entry by exactly the path every other
    // cancellation now takes.
    const customerOrderCancellation = new CustomerOrderCancellationService({
      emFactory: options.emFactory,
      transitions: options.orderTransitionPort,
      graphService: orderStatusGraphService,
      paymentMethodRead: options.paymentMethodRead,
      // Issue #284 — the kernel audit log, read back. The transition entries
      // this same module writes are what say whether a hold was the settlement
      // ingress's or an operator's, which on the shipped `status_on_failure`
      // default is the only thing that does.
      transitionHistory: options.auditLogService ?? null,
    });
    // Feature 038 US2 — orders list query, saved views, CSV export.
    const orderListService = new OrderListService(
      options.emFactory,
      orderStatusGraphService,
      options.organizationDetails,
      options.customerAccountRead,
    );
    if (options.exposeOrderListService) options.exposeOrderListService(orderListService);
    const orderListViewService = new OrderListViewService(options.emFactory);
    const orderExportService = new OrderExportService(orderListService);
    const orderCommentService = new OrderCommentService(
      options.emFactory,
      orderStatusGraphService,
      options.customerAccountRead,
      options.mailer,
      options.getTransactionalEmailSender,
    );
    const orderReorderService = new OrderReorderService(
      options.emFactory,
      options.cartWritePort,
      options.catalogProductRead,
      options.customerAccountRead,
      options.resolveReorderEnabled,
      options.mailer,
      options.getTransactionalEmailSender,
    );
    const orderCloneToQuoteService = new OrderCloneToQuoteService(
      options.emFactory,
      () => options.getRfqService?.() ?? null,
    );
    const orderCreationAdminService = new OrderCreationAdminService(
      options.emFactory,
      options.cartWritePort,
      orderService,
      options.addressService,
      options.customerAccountRead,
      options.mailer,
      options.getTransactionalEmailSender,
    );

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
      customerOrderCancellation,
      purchaseConversion: options.purchaseConversion,
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      requireAdmin: options.requireAdmin,
      resolveCustomerContext: options.resolveCustomerContext,
      pricingService: options.pricingService,
      resolveTaxRate: options.resolveTaxRate,
      catalogProductRead: options.catalogProductRead,
      customerAccountRead: options.customerAccountRead,
      organizationDetails: options.organizationDetails,
      deliveryMethodRead: options.deliveryMethodRead,
      paymentMethodRead: options.paymentMethodRead,
      invoiceRead: options.invoiceRead,
      invoicePdf: options.invoicePdf,
      assetRead: options.assetRead,
      ...(options.assertOrganizationCanTransact
        ? { assertOrganizationCanTransact: options.assertOrganizationCanTransact }
        : {}),
      ...(options.resolveAdminOrdersScope
        ? { resolveAdminOrdersScope: options.resolveAdminOrdersScope }
        : {}),
      ...(options.customFieldValues ? { customFieldValues: options.customFieldValues } : {}),
      ...(options.commandBus ? { commandBus: options.commandBus } : {}),
    });

    // Feature 062 — external orders namespace for bound api keys. Mounted only
    // when the api_keys gate is wired; the customer routes above are untouched.
    if (options.requireBoundApiKey) {
      const orderApiIntakeService = new OrderApiIntakeService({
        emFactory: options.emFactory,
        cartService: options.cartWritePort,
        orderService,
        addressService: options.addressService,
        catalogProductRead: options.catalogProductRead,
        organizationDetails: options.organizationDetails,
        salesChannelMembership: options.salesChannelMembership,
        pricingService: options.pricingService,
        redis: options.redis,
        resolveOrganizationMethodAllowLists: options.resolveOrganizationMethodAllowLists,
        auditLogService: options.auditLogService,
      });
      await registerOrdersExternalRoutes(app, {
        emFactory: options.emFactory,
        orderService,
        intakeService: orderApiIntakeService,
        requireBoundApiKey: options.requireBoundApiKey,
        assertOrganizationCanTransact: options.assertOrganizationCanTransact,
      });
    }

    // Feature 034 — the payment lifecycle moved out in feature 072 (T126), for
    // the same reason the shipment lifecycle did in T124: this root constructed
    // both services and mounted the routes, so switching `payments` off did
    // nothing at all.

    // Feature 035 — the shipment lifecycle moved out in feature 072 (T124).
    // `shipments` owns its services and its routes now, and gates them on its
    // own state; this root used to construct all three and mount them here,
    // which is why switching `shipments` off did nothing.

    // Feature 072 (T136) — the abandonment sweep, the organization approval
    // routes and the admin cart routes all moved to `carts`. Each used to mount
    // only when a chain of optional arguments happened to reach it, so the route
    // surface itself was a function of composition arguments; the module's own
    // activation control is the intentional gate now.
  };
}
