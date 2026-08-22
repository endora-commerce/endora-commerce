import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import {
  ERROR_CODES,
  type CartSnapshot,
  type FulfilmentStrategy,
  type InventoryFulfilmentPlanningPort,
  type InventoryStockReadPort,
  type NextAction,
  type PlaceOrderRequest,
  type PromotionApplication,
  type PromotionApplyPort,
  type StartPaymentResult,
} from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import {
  ModuleDisabledError,
  rethrowIfModuleDisabled,
} from '../../../kernel/lifecycle/plugin-helpers.js';
import type { BusinessIdGenerator } from './business-id-generator.js';
import {
  orderEmailNotSent,
  sendOrderTransactionalEmail,
  type OrderEmailResult,
} from './transactional-email-helper.js';

import type { AuditPort } from '../../../kernel/ports/audit.js';
import { actorFromContext } from '../../../commands/index.js';
import { getTenantContext } from '../../../tenancy/index.js';
import { Cart } from '../../carts/entities/cart.entity.js';
import { CartItem } from '../../carts/entities/cart-item.entity.js';
import { NoSystemDefaultChannel } from '../../../kernel/sales-channels/no-system-default-channel.error.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/order-item.entity.js';
import { OrderAppliedPromotion } from '../entities/order-applied-promotion.entity.js';
/**
 * The two rows placement opens in another module's table, and the two imports
 * feature 075 keeps on purpose (D-78 point 2, `check-module-boundary`'s
 * `permanent: true`).
 *
 * `payments_order_fk` and `invoices_order_fk` both reference `orders.id` with
 * `on delete restrict`, so each child row must see its order **inside the
 * placement transaction below** — a port would open a second transaction and
 * could not satisfy a foreign key against a row that has not committed. The
 * ledger entries name the constraints and what would retire them.
 */
import { Payment } from '../../payments/entities/payment.entity.js';
import { Invoice } from '../../invoices/entities/invoice.entity.js';
/**
 * The stock reservation, and the two `inventory` classes it writes on the
 * placement `EntityManager` (D-94.1 / D-94.4).
 *
 * `stock_allocations_order_item_fk` (`stock_allocations.order_item_id` ->
 * `order_items.id`, `on delete restrict`) means an allocation row cannot exist
 * before its order item does, and the order items are not committed until
 * placement returns. The `PESSIMISTIC_WRITE` on `stock_levels` is the other
 * half of the same fact: it has to be held by the transaction that writes the
 * order, or two placements allocate the same unit
 * (`test/contract/orders/place-stock-race.test.ts`), and a `reserved`
 * increment committed separately would survive a placement that then rolled
 * back. So this is D-78 point 2 — a co-transactional write the database holds
 * together — and the two ledger entries are `permanent: true` naming the
 * constraint.
 *
 * They were `await import(…)` inside the method body until D-94.4: a dynamic
 * import is invisible to a reviewer scanning this block, which is exactly the
 * property a permanent boundary exception must not have. Everything else the
 * reservation used to reach into this module for — the channel → warehouse
 * binding, the default-warehouse fallback and both strategy resolvers — is
 * gone, published as `inventoryStockReadPort.listChannelWarehouses` and
 * `inventoryFulfilmentPlanningPort`.
 */
import { StockLevel } from '../../inventory/entities/stock-level.entity.js';
import { StockAllocation } from '../../inventory/entities/stock-allocation.entity.js';
/**
 * The two em-carrying interfaces their owners write (D-94.5).
 *
 * Both name a MikroORM `EntityManager`, so neither can live in
 * `@b2b/contracts` (FR-034) — and both are held co-transactional by a foreign
 * key into `orders` (`promotion_usages_order_fk`,
 * `credit_limit_reservations_order_fk`). `orders` declared both itself until
 * D-94.5, which meant `lazyPort<T>`'s unchecked cast had nothing to check the
 * provider against. Each file states its own constraint.
 */
import type { CreditLimitPort } from '../../credit_limits/services/credit-limit-port.js';
import type { PromotionUsageFinalizer } from '../../promotions/services/promotion-usage-finalizer.js';
/**
 * Re-exported so `plugin.ts` names its own module for the same two types.
 * One seam, one ledger entry each: a second import specifier in the plugin
 * would be a second crossing of a boundary that has exactly one reason to be
 * crossed, and the reason is stated above and in each owner's file.
 */
export type { CreditLimitPort, PromotionUsageFinalizer };
import { OrderAccessService } from './order-access-service.js';
import type {
  AddressReadPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  DeliveryMethodReadPort,
  DeliveryMethodRecord,
  EmailMailerPort,
  OrderStatusRegistry,
  OrganizationDetailsPort,
  OrganizationRecord,
  PaymentAdapterRegistryPort,
  PaymentMethodReadPort,
  PaymentMethodRecord,
  ShippingAdapterRegistryPort,
  TransactionalEmailSender,
} from '@b2b/contracts';
import {
  buildOrderConfirmationEmail,
  buildOrderConfirmationVariables,
  type OrderConfirmationRenderers,
} from '../email-templates/order-confirmation.js';
import {
  noCarrierShippingLineRenderer,
  noGatewayPaymentLineRenderer,
} from '../email-templates/adapter-line-baselines.js';


export interface OrderEvents extends Record<string, EventBase> {
  'order.created.v1': EventBase & { orderId: string; organizationId: string };
  'order.status_changed.v1': EventBase & {
    orderId: string;
    // Feature 062 — additive: tenant key for org-scoped webhook delivery
    // (Principle XI), plus channel + human-readable order number.
    organizationId: string;
    salesChannelId: string;
    from: string;
    to: string;
    businessId?: string | null;
  };
  'order.cancelled.v1': EventBase & { orderId: string };
  // Feature 045 (T092) — fired post-commit per finalized promotion redemption.
  'promotion.used.v1': EventBase & {
    orderId: string;
    promotionId: string;
    couponId: string | null;
    amount: number;
  };
}
export type OrderEventBus = EventBus<OrderEvents>;

/**
 * Composed without a tax authority (issue #124).
 *
 * Not an `HttpError`: a module an operator switched off answers with the 503
 * `MODULE_DISABLED` envelope at the port gate, long before this. Reaching here
 * means the service was constructed with no `resolveTaxRate` at all — a wiring
 * mistake in a composition root or a test rig, which used to be papered over
 * with a flat 23% and shipped as a real order total.
 */
export class MissingTaxAuthorityError extends Error {
  constructor() {
    super(
      'OrderService was composed without `resolveTaxRate`, so this order has no tax authority. ' +
        'Wire the `taxes` port through `OrdersModuleOptions.resolveTaxRate`; there is no default rate.',
    );
    this.name = 'MissingTaxAuthorityError';
  }
}

export interface CustomerContext {
  customerAccountId: string;
  organizationId: string;
  /**
   * When the request is from an Admin User impersonating this Customer,
   * carry the Admin's id here so OrderService can stamp it onto the Order
   * (FR-042 / R-12) and emit an audit entry.
   */
  impersonatorAdminUserId?: string | null;
}

/**
 * OrderService (T143). Transactional placeOrder:
 *   1. Cart must be non-empty → else 409 CART_EMPTY.
 *   2. Organization must be active → else 423 ORGANIZATION_SUSPENDED.
 *   3. Addresses must belong to the org → else 403 ADDRESS_NOT_OWNED.
 *   4. Delivery + payment methods must be active.
 *   5. For each item with a StockLevel row, reserve via SELECT … FOR UPDATE —
 *      if (on_hand - reserved) < quantity, raise 409 STOCK_UNAVAILABLE.
 *   6. Persist Order + OrderItems + Payment row.
 *   7. Generate a proforma Invoice row (status='pending'). For US2 we
 *      synthesize a tiny %PDF bytes blob inline so GET /orders/:id/invoice
 *      returns something real — Meilisearch and real templating come later.
 *   8. Clear the cart.
 *   9. Emit order.created.v1.
 */
/**
 * The neighbouring modules' published surfaces `placeOrder` and the preview
 * read (feature 075, Phase C).
 *
 * A group rather than seven constructor parameters, because they arrive
 * together from `backend.ts` and are never wired one at a time.
 */
export interface OrderServiceNeighbourPorts {
  readonly organizationDetails: OrganizationDetailsPort;
  readonly customerAccountRead: CustomerAccountReadPort;
  readonly addressRead: AddressReadPort;
  readonly catalogProductRead: CatalogProductReadPort;
  /** `null` ⇒ `payment_methods` is not effectively present. */
  readonly paymentMethodRead: () => PaymentMethodReadPort | null;
  /** `null` ⇒ `delivery_methods` is not effectively present. */
  readonly deliveryMethodRead: () => DeliveryMethodReadPort | null;
  /**
   * The two `inventory` ports placement reserves through — `null` when that
   * module is not effectively present (D-94.4, issue #188).
   *
   * One accessor for both, because there is one presence question and one
   * answer to it: with `inventory` off the reservation block is skipped whole,
   * and an order is placed without reserving stock — which is exactly what
   * this module's `degrades-without` entry for it declares. Two accessors
   * would have let half the block run.
   */
  readonly inventory: () => {
    readonly stockRead: InventoryStockReadPort;
    readonly planning: InventoryFulfilmentPlanningPort;
  } | null;
}

export class OrderService {
  private readonly accessService: OrderAccessService;

  private readonly paymentAdapters: PaymentAdapterRegistryPort | undefined;
  private readonly orderStatusRegistry: OrderStatusRegistry | undefined;
  private readonly shippingAdapters: ShippingAdapterRegistryPort | undefined;
  private readonly mailer: EmailMailerPort | undefined;
  /**
   * The neighbouring modules' published read models (feature 075).
   *
   * Required, and grouped, because they replace `em.findOne(Organization, …)`
   * and its six siblings: a read that used to run against another module's
   * table through this module's `EntityManager` now runs through the owner's,
   * where its tenant filter applies and where a switched-off owner refuses
   * instead of answering from tables deactivation leaves in place.
   *
   * The two method catalogues are **accessors**: `payment_methods` and
   * `delivery_methods` are deactivatable and declared `degrades-without`, so
   * presence is asked per placement rather than captured here.
   */
  private readonly neighbours: OrderServiceNeighbourPorts;
  /**
   * Feature 075 — the order-confirmation e-mail's two adapter-rendered lines.
   *
   * An accessor rather than a value: `payments` and `shipments` own the two
   * renderer registries and are both deactivatable, so which renderer answers
   * is a question with a different answer per send. `orders` declares both as
   * `degrades-without`, and the accessor answers with this module's own
   * baselines when the owner is not effectively present.
   */
  private readonly confirmationRenderers: (() => OrderConfirmationRenderers) | undefined;
  /** Feature 036 — generates the customer-facing business Order ID. */
  private readonly businessId: BusinessIdGenerator | undefined;
  /**
   * Feature 036 (US3) — recomputes the cart's coupon discount at placement.
   *
   * `PromotionApplyPort` since D-94.5: the read half of the seam is a contract
   * `promotions` publishes and `carts` already resolves under the same
   * container name, so the near-identical interface this file used to declare
   * was a second copy of it that nothing checked against the provider.
   */
  private readonly promotion: PromotionApplyPort | undefined;
  /**
   * The redemption row, written on the placement `EntityManager` (D-94.5).
   *
   * A separate name from `promotion` because it is a separate port: the
   * em-carrying half cannot live in `@b2b/contracts` (FR-034), so `promotions`
   * declares it beside its implementation and this module imports the type.
   */
  private readonly promotionUsageFinalizer: PromotionUsageFinalizer | undefined;
  /**
   * Feature 038 (US4) — resolves the additional confirmation recipients (per-org
   * + Settings-scoped) for an order. Optional; omit ⇒ only the customer is sent.
   */
  private readonly confirmationRecipients:
    | ((input: { organizationId: string; salesChannelId: string }) => Promise<string[]>)
    | undefined;
  /**
   * Feature 047 — resolves the transactional-email sender (set late by
   * composition once the transactional_emails module is built). When present,
   * the order confirmation is rendered from the admin-editable template;
   * otherwise the legacy in-code builder is used (backward compatible).
   */
  private readonly getTransactionalEmailSender:
    | (() => TransactionalEmailSender | undefined)
    | undefined;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: OrderEventBus,
    private readonly auditLog?: AuditPort,
    private readonly creditLimit?: CreditLimitPort,
    accessService?: OrderAccessService,
    paymentDeps?: {
      paymentAdapters?: PaymentAdapterRegistryPort;
      orderStatusRegistry?: OrderStatusRegistry;
      shippingAdapters?: ShippingAdapterRegistryPort;
      mailer?: EmailMailerPort;
      confirmationRenderers?: () => OrderConfirmationRenderers;
      neighbours: OrderServiceNeighbourPorts;
      businessId?: BusinessIdGenerator;
      promotion?: PromotionApplyPort;
      promotionUsageFinalizer?: PromotionUsageFinalizer;
      confirmationRecipients?: (input: {
        organizationId: string;
        salesChannelId: string;
      }) => Promise<string[]>;
      /**
       * Issue #103 — `null` is "no channel", read platform-wide. The parameter
       * used to be `string`, so the gate passed `''` for a placement that named
       * no channel; the settings read behind it then threw at the seam guard and
       * the `.catch(() => 0)` reported "no minimum", silently disabling a
       * configured one.
       */
      resolveMinOrderValue?: (salesChannelId: string | null) => Promise<number>;
      resolveChannelFulfilmentStrategy?: (salesChannelId: string) => Promise<FulfilmentStrategy>;
      resolveChannelFulfilmentWarehouseOrder?: (salesChannelId: string) => Promise<string[]>;
      resolveChannelAllowNegativeStock?: (salesChannelId: string) => Promise<boolean>;
      getTransactionalEmailSender?: () => TransactionalEmailSender | undefined;
      /**
       * Resolve the VAT rate (as a fraction, e.g. `0.23`) for a single product
       * line, given the billing country, the product's tax class (its `type`),
       * and the organization's VAT status. Optional only because the parameter
       * chain around it is; unwired, pricing raises
       * {@link MissingTaxAuthorityError} rather than inventing a rate.
       */
      resolveTaxRate?: (input: {
        country: string | null;
        productType: string;
        vatStatus: string;
      }) => Promise<number>;
    },
  ) {
    if (!paymentDeps) {
      throw new Error(
        'OrderService: `paymentDeps.neighbours` is required (feature 075) — the placement ' +
          'path reads six neighbouring modules through their published ports.',
      );
    }
    this.neighbours = paymentDeps.neighbours;
    this.accessService =
      accessService ?? new OrderAccessService(paymentDeps.neighbours.customerAccountRead);
    this.paymentAdapters = paymentDeps?.paymentAdapters;
    this.orderStatusRegistry = paymentDeps?.orderStatusRegistry;
    this.shippingAdapters = paymentDeps?.shippingAdapters;
    this.mailer = paymentDeps?.mailer;
    this.confirmationRenderers = paymentDeps?.confirmationRenderers;
    this.businessId = paymentDeps?.businessId;
    this.promotion = paymentDeps?.promotion;
    this.promotionUsageFinalizer = paymentDeps?.promotionUsageFinalizer;
    this.confirmationRecipients = paymentDeps?.confirmationRecipients;
    this.getTransactionalEmailSender = paymentDeps?.getTransactionalEmailSender;
    this.resolveMinOrderValue = paymentDeps?.resolveMinOrderValue;
    this.resolveChannelFulfilmentStrategy = paymentDeps?.resolveChannelFulfilmentStrategy;
    this.resolveChannelFulfilmentWarehouseOrder =
      paymentDeps?.resolveChannelFulfilmentWarehouseOrder;
    this.resolveChannelAllowNegativeStock = paymentDeps?.resolveChannelAllowNegativeStock;
    this.resolveTaxRate = paymentDeps?.resolveTaxRate;
  }

  /**
   * Feature — real per-product VAT. Resolves the applicable rate for a product
   * line (billing country + product tax class + org VAT status). Unwired ⇒ the
   * order is refused, never priced from a fallback rate (issue #124).
   */
  private readonly resolveTaxRate:
    | ((input: {
        country: string | null;
        productType: string;
        vatStatus: string;
      }) => Promise<number>)
    | undefined;

  /**
   * Sales-channel layer of the fulfilment-strategy precedence chain. Resolves
   * `inventory.fulfilment_strategy` (+ its warehouse order) for a channel via
   * the Settings module, which itself collapses per-channel value → global
   * value → manifest default. Optional; when unwired the order-service falls
   * back to `default_first` / `[]`.
   */
  private readonly resolveChannelFulfilmentStrategy:
    | ((salesChannelId: string) => Promise<FulfilmentStrategy>)
    | undefined;
  private readonly resolveChannelFulfilmentWarehouseOrder:
    | ((salesChannelId: string) => Promise<string[]>)
    | undefined;

  /**
   * Global gate for per-product backorder. Resolves
   * `inventory.allow_negative_stock` for a channel via the Settings module
   * (per-channel value → global value → manifest default `false`). When the
   * gate is off, a product's `backorderEnabled` flag is ignored and orders
   * below available stock are rejected. Optional; when unwired the gate
   * defaults to off.
   */
  private readonly resolveChannelAllowNegativeStock:
    | ((salesChannelId: string) => Promise<boolean>)
    | undefined;

  /**
   * Feature 038 (US3/FR-035) — resolves the minimum order value for a sales
   * channel (0 = no minimum). Gates both Checkout and admin order creation.
   */
  private readonly resolveMinOrderValue:
    | ((salesChannelId: string | null) => Promise<number>)
    | undefined;

  /**
   * Feature 034 — order-confirmation e-mail, dispatched post-commit (best
   * effort; a mail failure never rolls back a placed order). Resolves the
   * customer's address, the line items, and the adapter's e-mail renderer key,
   * then sends the templated confirmation.
   *
   * It answered `void` before (issue #78), and so did every way of not sending
   * it: no mailer in the composition, no customer behind the order, an
   * operator-deactivated template, a code with no definition, and a send that
   * raised. The result names the primary recipient's outcome — the extra
   * confirmation recipients are independent by design and report through the
   * log — and every non-sent path reaches the log whether or not anyone reads
   * the result.
   */
  /**
   * The renderer pair for one confirmation e-mail, asked for per send.
   *
   * Unwired ⇒ this module's own baselines, which is also what a composition
   * with neither `payments` nor `shipments` present gets. Those baselines are
   * not a copy of either module's capability: the registry, the adapter key
   * lookup and a gateway's custom wording stay with their owners and are
   * reached through their ports whenever the owners are there.
   */
  private orderConfirmationRenderers(): OrderConfirmationRenderers {
    return (
      this.confirmationRenderers?.() ?? {
        payment: noGatewayPaymentLineRenderer,
        shipping: noCarrierShippingLineRenderer,
      }
    );
  }

  private async sendOrderConfirmation(order: Order): Promise<OrderEmailResult> {
    const emailContext = { orderId: order.id, code: 'order_confirmation' };
    if (!this.mailer) return orderEmailNotSent(undefined, emailContext, 'no_transport');
    const em = this.emFactory();
    const [customer, items] = await Promise.all([
      this.neighbours.customerAccountRead.findById(order.placedByCustomerAccountId),
      em.find(OrderItem, { orderId: order.id }),
    ]);
    if (!customer) return orderEmailNotSent(undefined, emailContext, 'no_recipient');

    // Feature 047 — when the transactional_emails module is wired, send the
    // admin-editable template; otherwise fall through to the legacy builder.
    const sender = this.getTransactionalEmailSender?.();
    if (sender) {
      const channel = await em.findOne(SalesChannel, { id: order.salesChannelId });
      const language = channel?.defaultLanguage ?? 'en-US';
      const rendererKey =
        this.paymentAdapters?.get(order.paymentMethodSnapshot.adapter ?? '')?.renderers?.email ?? null;
      const deliveryMethod =
        (await this.neighbours.deliveryMethodRead()?.findById(order.deliveryMethodId)) ?? null;
      const shippingRendererKey =
        this.shippingAdapters?.get(deliveryMethod?.adapter ?? '')?.renderers?.email ?? null;
      const variables = buildOrderConfirmationVariables(
        {
          to: customer.email,
          customerFirstName: customer.firstName,
          language,
          order: {
            id: order.id,
            businessId: order.businessId,
            deliveryMethodSnapshot: order.deliveryMethodSnapshot,
            paymentMethodSnapshot: order.paymentMethodSnapshot,
            paymentRendererKey: rendererKey,
            shippingRendererKey,
            subtotal: order.subtotal,
            taxTotal: order.taxTotal,
            discountTotal: order.discountTotal,
            deliveryTotal: order.deliveryTotal,
            total: order.total,
            currency: order.currency,
            promotionCode: order.promotionCode ?? null,
            deliveryAddress: order.deliveryAddress,
            billingAddress: order.billingAddress,
          },
          items: items.map((it) => ({
            productSnapshot: { sku: it.productSnapshot.sku, name: it.productSnapshot.name },
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            lineTotal: it.lineTotal,
          })),
        },
        this.orderConfirmationRenderers(),
      );
      const messageId = `order_confirmation:${order.id}`;
      const meta = { kind: 'order_confirmation', orderId: order.id };
      // The channel language is already resolved above for the variables, so it
      // is handed to the helper rather than read a second time.
      const result = await sendOrderTransactionalEmail(em, sender, order, {
        orderId: order.id,
        code: 'order_confirmation',
        to: customer.email,
        messageId,
        variables,
        meta,
        language,
      });
      if (this.confirmationRecipients) {
        let extra: string[] = [];
        try {
          extra = await this.confirmationRecipients({
            organizationId: order.organizationId,
            salesChannelId: order.salesChannelId,
          });
        } catch {
          extra = [];
        }
        for (const recipient of extra) {
          if (recipient.toLowerCase() === customer.email.toLowerCase()) continue;
          // Each extra recipient is independent and best-effort: its own
          // not-sent reason goes to the log, and none of them changes the
          // answer about the customer's own copy.
          await sendOrderTransactionalEmail(em, sender, order, {
            orderId: order.id,
            code: 'order_confirmation',
            to: recipient,
            messageId: `${messageId}:${recipient}`,
            variables,
            meta,
            language,
          });
        }
      }
      return result;
    }
    const rendererKey =
      this.paymentAdapters?.get(order.paymentMethodSnapshot.adapter ?? '')?.renderers?.email ??
      null;
    // Feature 035 — resolve the shipping adapter's e-mail renderer key. The
    // delivery snapshot does not store the adapter, so look the method up.
    const deliveryMethod =
      (await this.neighbours.deliveryMethodRead()?.findById(order.deliveryMethodId)) ?? null;
    const shippingRendererKey =
      this.shippingAdapters?.get(deliveryMethod?.adapter ?? '')?.renderers?.email ?? null;
    const channel = await em.findOne(SalesChannel, { id: order.salesChannelId });
    const language = channel?.defaultLanguage ?? 'en-US';
    const message = buildOrderConfirmationEmail(
      {
        to: customer.email,
        language,
        order: {
          id: order.id,
          businessId: order.businessId,
          deliveryMethodSnapshot: order.deliveryMethodSnapshot,
          paymentMethodSnapshot: order.paymentMethodSnapshot,
          paymentRendererKey: rendererKey,
          shippingRendererKey,
          subtotal: order.subtotal,
          taxTotal: order.taxTotal,
          discountTotal: order.discountTotal,
          deliveryTotal: order.deliveryTotal,
          total: order.total,
          currency: order.currency,
          promotionCode: order.promotionCode ?? null,
          deliveryAddress: order.deliveryAddress,
          billingAddress: order.billingAddress,
        },
        items: items.map((it) => ({
          productSnapshot: { sku: it.productSnapshot.sku, name: it.productSnapshot.name },
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
        })),
      },
      this.orderConfirmationRenderers(),
    );
    let result: OrderEmailResult;
    try {
      const outcome = await this.mailer.send(message);
      result =
        outcome.status === 'sent'
          ? { sent: true }
          : orderEmailNotSent(undefined, emailContext, 'suppressed');
    } catch (error) {
      // A mail failure never rolls back a placed order — but it is named now.
      // A switched-off module is not a delivery failure, so it travels on.
      rethrowIfModuleDisabled(error);
      result = orderEmailNotSent(undefined, emailContext, 'failed', error);
    }

    // Feature 038 (US4) — CC the per-organization + Settings-scoped recipients.
    // Each send is independent and best-effort: a bad recipient is recorded by
    // the mailer but never blocks placement or the other recipients.
    if (this.confirmationRecipients) {
      let extra: string[] = [];
      try {
        extra = await this.confirmationRecipients({
          organizationId: order.organizationId,
          salesChannelId: order.salesChannelId,
        });
      } catch {
        extra = [];
      }
      for (const recipient of extra) {
        if (recipient.toLowerCase() === customer.email.toLowerCase()) continue;
        try {
          const outcome = await this.mailer.send({
            ...message,
            to: recipient,
            messageId: `${message.messageId}:${recipient}`,
          });
          // Each CC is independent, so a suppressed one is named on its own
          // rather than folded into the buyer's result above.
          if (outcome.status !== 'sent') {
            orderEmailNotSent(undefined, emailContext, 'suppressed');
          }
        } catch (error) {
          // best-effort per recipient, and each one says so
          rethrowIfModuleDisabled(error);
          orderEmailNotSent(undefined, emailContext, 'failed', error);
        }
      }
    }
    return result;
  }

  /**
   * Feature 034 — resolve a payment method's `statusOnPending` into a valid
   * order status. Returns `undefined` (keep the entity default `new`) when the
   * reference is empty or, with a registry wired, not a known order status.
   */
  private resolvePendingStatus(ref: string | undefined): Order['status'] | undefined {
    if (!ref) return undefined;
    if (this.orderStatusRegistry && !this.orderStatusRegistry.has(ref)) return undefined;
    return ref as Order['status'];
  }

  /**
   * Feature 034 (US4/FR-013/FR-015) — re-validate the selected payment method's
   * adapter validator for the submission surface. No-op when the adapter
   * registry is not wired or the adapter is unregistered (the active-status
   * check already gates those). API-surface detection is a follow-up; an
   * impersonated submission counts as the admin surface.
   *
   * `salesChannelId` is the channel the placement named, or `null` when it named
   * none (issue #103). It used to be hard-coded `''` here, which told the
   * adapter neither: an empty string is not a channel id, so an adapter reading
   * its own per-channel configuration hit the settings seam guard, and a
   * placement that *did* name a channel had it discarded on the way in.
   */
  private async assertPaymentMethodUsable(
    ctx: CustomerContext,
    method: PaymentMethodRecord,
    salesChannelId: string | null,
  ): Promise<void> {
    const adapter = this.paymentAdapters?.get(method.adapter);
    if (!adapter) {
      // Registered, but its owning module is absent on one of the two axes
      // (issue #96). The buyer-facing lists already dropped this method, so
      // getting here means a direct API submission — refuse it rather than
      // open a payment nothing can settle. An adapter *no* module ever
      // registered keeps the older tolerance: the active-status check is what
      // gates those, and a deployment may legitimately run an offline method
      // whose adapter is not wired.
      const owner = this.paymentAdapters?.ownerOf(method.adapter);
      if (owner) throw new ModuleDisabledError(owner);
      return;
    }
    const surface = ctx.impersonatorAdminUserId ? 'admin' : 'storefront';
    const eligCtx = {
      paymentMethod: {
        id: method.id,
        code: method.code,
        adapter: method.adapter,
        kind: method.kind,
        name: method.name,
        status: method.status,
        additionalPrice: Number(method.additionalPrice),
        statusOnPending: method.statusOnPending,
        statusOnSuccess: method.statusOnSuccess,
        statusOnFailure: method.statusOnFailure,
        salesChannelIds: [] as string[],
      },
      salesChannelId,
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      surface: surface as 'admin' | 'storefront',
    };
    const ok =
      surface === 'admin'
        ? await adapter.validateUseOnAdmin(eligCtx)
        : await adapter.validateUseOnStorefront(eligCtx);
    if (!ok) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'The selected payment method is not available for this order.',
      );
    }
  }

  /**
   * Feature 035 (US4/FR-014/FR-015) — re-validate the selected shipping
   * method's adapter validator for the submission surface. No-op when the
   * registry is not wired or the adapter is unregistered (the active-status
   * check already gates those). An impersonated submission counts as admin.
   *
   * `salesChannelId` follows the payment twin above, for the same reason.
   */
  private async assertShippingMethodUsable(
    ctx: CustomerContext,
    method: DeliveryMethodRecord,
    salesChannelId: string | null,
  ): Promise<void> {
    const adapter = this.shippingAdapters?.get(method.adapter);
    if (!adapter) {
      // The payment twin's rule, for the same reason (issue #96).
      const owner = this.shippingAdapters?.ownerOf(method.adapter);
      if (owner) throw new ModuleDisabledError(owner);
      return;
    }
    const surface = ctx.impersonatorAdminUserId ? 'admin' : 'storefront';
    const eligCtx = {
      deliveryMethod: {
        id: method.id,
        code: method.code,
        adapter: method.adapter,
        name: method.name,
        cost: { amount: Number(method.cost), currency: method.currency },
        status: method.status,
        statusOnSuccess: method.statusOnSuccess,
        statusOnFailure: method.statusOnFailure,
        salesChannelIds: [] as string[],
        rendererKey: adapter.renderers?.storefront ?? null,
      },
      salesChannelId,
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      surface: surface as 'admin' | 'storefront',
    };
    const ok =
      surface === 'admin'
        ? await adapter.validateUseOnAdmin(eligCtx)
        : await adapter.validateUseOnStorefront(eligCtx);
    if (!ok) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'The selected shipping method is not available for this order.',
      );
    }
  }

  /**
   * Feature 036 — map the payment adapter's `StartPaymentResult` (returned by
   * `onStorefrontOrderCreated`) to the contract `NextAction` surfaced in the
   * place-order response, so the Success Page can route the buyer. The offline
   * bank-transfer adapter carries only an IBAN + reference; the richer
   * `accountDetails` fields it does not supply are left empty (a real gateway
   * adapter fills them).
   */
  private mapNextAction(
    result: StartPaymentResult,
    order: { total: number; currency: string; accountHolder?: string; bankName?: string },
  ): NextAction {
    switch (result.kind) {
      case 'awaiting_transfer':
        return {
          kind: 'awaiting_transfer',
          accountDetails: {
            accountNumber: result.iban ?? '',
            accountHolder: order.accountHolder ?? '',
            bankName: order.bankName ?? '',
            amount: order.total,
            currency: order.currency,
            reference: result.reference,
          },
        };
      case 'redirect':
        return {
          kind: 'redirect_to_gateway',
          url: result.url,
          // The bundled adapters do not carry an expiry; default to +15 min so
          // the response satisfies the contract. A real gateway adapter sets it.
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        };
      case 'none':
      default:
        return { kind: 'none' };
    }
  }

  /**
   * The buyer's effective customer group (issue #177).
   *
   * The account's own group, else the Organization's — the same chain the
   * pricing engine resolves, and the fact the promotion engine's audience
   * filter compares against. Both `computeMonetaryTotals` and the usage context
   * handed to `finalizeUsage` passed a literal `null` here, so a promotion an
   * operator restricted to a group never reduced an order total and every
   * redemption row claimed the buyer belonged to no group.
   */
  private async resolveCustomerGroupId(
    customerAccountId: string,
    organization: OrganizationRecord | null,
  ): Promise<string | null> {
    // Reads through the owners' published ports rather than their entities:
    // this method arrived with #177 while the `orders` cut was in flight, so
    // it was written against `em.findOne(CustomerAccount, …)` and the two
    // merged cleanly in text and not at all in types.
    const account = await this.neighbours.customerAccountRead.findById(customerAccountId);
    return account?.customerGroupId ?? organization?.customerGroupId ?? null;
  }

  /**
   * Single source of truth for order money math (feature 049). Computes the
   * subtotal, per-product VAT (via the injected tax resolver), delivery cost,
   * payment surcharge, and promotion discount for a set of cart lines. Used by
   * both `placeOrder` and the read-only `previewTotal` so the storefront never
   * re-derives pricing on the client and the two can never drift.
   */
  /**
   * The chosen delivery method, but only while it is active — and only while
   * `delivery_methods` is effectively present.
   *
   * The status filter used to be a predicate in the query; it is applied here
   * because `DeliveryMethodReadPort.findById` deliberately does not filter, so
   * that a settlement of an order placed earlier can still name a method an
   * operator has since retired. A *placement* wants the narrow read, and this
   * is where that decision belongs.
   *
   * `null` for an absent owner is the same answer as "not active": the caller
   * refuses the placement with the method-not-active 400, which is the truth —
   * there is no active method catalogue to choose from.
   */
  private async activeDeliveryMethod(id: string) {
    const method = await this.neighbours.deliveryMethodRead()?.findById(id);
    return method && method.status === 'active' ? method : null;
  }

  /** The payment twin of {@link activeDeliveryMethod}. */
  private async activePaymentMethod(id: string) {
    const method = await this.neighbours.paymentMethodRead()?.findById(id);
    return method && method.status === 'active' ? method : null;
  }

  private async computeMonetaryTotals(input: {
    items: Array<{
      productId: string;
      variantId?: string | null;
      quantity: number;
      unitPrice: string | number;
      currency: string;
    }>;
    productById: Map<string, { type: string }>;
    vatStatus: string;
    taxCountry: string | null;
    deliveryCost: number;
    paymentSurcharge: number;
    currency: string;
    appliedPromotionCode: string | null;
    salesChannelId: string | null;
    organizationId: string;
    /** The buyer's effective group — see {@link resolveCustomerGroupId}. */
    customerGroupId: string | null;
  }): Promise<{
    subtotal: number;
    taxTotal: number;
    deliveryTotal: number;
    paymentSurcharge: number;
    discountTotal: number;
    total: number;
    currency: string;
    appliedPromotionCode: string | null;
    appliedPromotions: PromotionApplication['appliedPromotions'];
    rateForProductId: (productId: string) => number;
  }> {
    const { items, productById, currency } = input;
    const subtotal = items.reduce((acc, it) => acc + Number(it.unitPrice) * it.quantity, 0);

    // Real VAT: resolve the rate per product tax class (its `type`) against the
    // billing country + org VAT status. VAT-exempt / reverse-charge orgs resolve
    // to 0.
    //
    // There is no fallback rate (issue #124). A flat 23% invented here because
    // no resolver was wired put a figure no rule in the deployment supports onto
    // a real order and a real invoice, and it did so most confidently exactly
    // when the tax authority was missing. An order the platform cannot price is
    // refused; the refusal is loud, and an audit six months later is not.
    const resolveTaxRate = this.resolveTaxRate;
    if (!resolveTaxRate) throw new MissingTaxAuthorityError();
    const rateByType = new Map<string, number>();
    for (const productType of new Set(
      items.map((it) => productById.get(it.productId)?.type ?? 'simple'),
    )) {
      const rate =
        input.vatStatus === 'vat_payer'
          ? await resolveTaxRate({
              country: input.taxCountry,
              productType,
              vatStatus: input.vatStatus,
            })
          : 0;
      rateByType.set(productType, rate);
    }
    // Every product type in `items` seeded the map above, so a miss here is a
    // programming error rather than an unpriced line — and 0 is the only value
    // that cannot be mistaken for a resolved rate.
    const rateForProductId = (productId: string): number =>
      rateByType.get(productById.get(productId)?.type ?? 'simple') ?? 0;
    const taxTotal =
      Math.round(
        items.reduce(
          (acc, it) => acc + Number(it.unitPrice) * it.quantity * rateForProductId(it.productId),
          0,
        ) * 100,
      ) / 100;

    const deliveryTotal = input.deliveryCost;
    const paymentSurcharge = input.paymentSurcharge;

    // Promotion engine — includes automatic (couponless) promotions plus the
    // cart's applied coupon. No-op when no promotion port is wired.
    let discountTotal = 0;
    let appliedPromotionCode: string | null = null;
    let appliedPromotions: PromotionApplication['appliedPromotions'] = [];
    if (this.promotion) {
      const snapshot: CartSnapshot = {
        organizationId: input.organizationId,
        customerGroupId: input.customerGroupId,
        currency,
        lines: items.map((it) => ({
          productId: it.productId,
          variantId: it.variantId ?? null,
          categoryIds: [],
          quantity: it.quantity,
          unitPrice: { amount: Number(it.unitPrice), currency: it.currency },
        })),
        deliveryTotal,
        promotionCode: input.appliedPromotionCode ?? null,
        salesChannelId: input.salesChannelId ?? null,
      };
      const application = await this.promotion.applyToCart(snapshot);
      if (application.discountTotal > 0) {
        discountTotal = application.discountTotal;
        appliedPromotionCode = input.appliedPromotionCode ?? null;
        appliedPromotions = application.appliedPromotions;
      }
    }

    const total =
      Math.round((subtotal + taxTotal + deliveryTotal + paymentSurcharge - discountTotal) * 100) /
      100;

    return {
      subtotal,
      taxTotal,
      deliveryTotal,
      paymentSurcharge,
      discountTotal,
      total,
      currency,
      appliedPromotionCode,
      appliedPromotions,
      rateForProductId,
    };
  }

  /**
   * Read-only total preview (feature 049) for the caller's active cart with a
   * chosen delivery + payment method. Uses the same computation as placeOrder,
   * so the storefront can display the exact amount (e.g. for the inline Stripe
   * Payment Element) without re-deriving pricing on the client.
   */
  async previewTotal(
    ctx: CustomerContext,
    req: { deliveryMethodId: string; paymentMethodId: string; billingAddressId?: string | undefined },
  ): Promise<{
    subtotal: number;
    taxTotal: number;
    deliveryTotal: number;
    paymentSurcharge: number;
    discountTotal: number;
    total: number;
    currency: string;
  }> {
    const em = this.emFactory();
    const org = await this.neighbours.organizationDetails.findById(ctx.organizationId);
    const cart = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      status: 'active',
    });
    const items = cart ? await em.find(CartItem, { cartId: cart.id }) : [];
    if (!cart || items.length === 0) {
      throw new HttpError(409, ERROR_CODES.CART_EMPTY, 'Cart is empty.');
    }
    const deliveryMethod = await this.activeDeliveryMethod(req.deliveryMethodId);
    if (!deliveryMethod) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Delivery method is not active.');
    }
    const paymentMethod = await this.activePaymentMethod(req.paymentMethodId);
    if (!paymentMethod) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Payment method is not active.');
    }
    const products =
      items.length > 0
        ? await this.neighbours.catalogProductRead.findByIds(items.map((i) => i.productId))
        : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    // Tax country: prefer the selected billing address (matches placeOrder),
    // else the organization's registered country.
    let taxCountry: string | null = org?.registeredAddress?.country ?? null;
    if (req.billingAddressId) {
      const billing = await this.neighbours.addressRead.findById(
        ctx.organizationId,
        req.billingAddressId,
        { liveOnly: true },
      );
      if (billing) taxCountry = billing.country;
    }

    const totals = await this.computeMonetaryTotals({
      items,
      productById,
      vatStatus: org?.vatStatus ?? 'vat_payer',
      taxCountry,
      deliveryCost: Number(deliveryMethod.cost),
      paymentSurcharge: Number(paymentMethod.additionalPrice ?? '0'),
      currency: deliveryMethod.currency,
      appliedPromotionCode: cart.appliedPromotionCode ?? null,
      salesChannelId: cart.salesChannelId ?? null,
      organizationId: ctx.organizationId,
      customerGroupId: await this.resolveCustomerGroupId(ctx.customerAccountId, org),
    });

    return {
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      deliveryTotal: totals.deliveryTotal,
      paymentSurcharge: totals.paymentSurcharge,
      discountTotal: totals.discountTotal,
      total: totals.total,
      currency: totals.currency,
    };
  }

  async placeOrder(
    ctx: CustomerContext,
    req: PlaceOrderRequest,
  ): Promise<Order> {
    const em = this.emFactory();
    const order = await em.transactional(async (tx) => {
      const org = await this.neighbours.organizationDetails.findById(ctx.organizationId);
      if (!org) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      // **The service-seam guard. Not dead code — do not delete it.**
      //
      // `POST /api/v1/orders` and the external intake route both refuse a
      // suspended Organization before reaching this method, with
      // `FORBIDDEN` + `organization_cannot_transact` (the code the 062
      // contract and the published integration docs specify). This check is
      // for the callers that reach `placeOrder` *without* passing a route
      // gate, and there are three:
      //
      //   - `quick_order/services/one-click-service.ts` — a live,
      //     storefront-reachable placement endpoint with no transact guard of
      //     its own, so this is the only thing standing between a suspended
      //     Organization and a one-click order;
      //   - `orders/services/order-api-intake-service.ts`;
      //   - `orders/services/order-creation-admin-service.ts`.
      //
      // It keeps `ORGANIZATION_SUSPENDED` deliberately: at this seam the
      // refusal is a statement about the Organization's status, not about the
      // caller's permission — which is also the right reading for an
      // admin-created order, where "forbidden" would be actively misleading.
      //
      // Feature 072 (T141) is what made this worth writing down: until then
      // the test harness never wired the route gate, so the suite reached this
      // branch on the ordinary checkout path and it looked like the main
      // implementation rather than the fallback. It then had no coverage at
      // all, which is issue #64; the branch is exercised by
      // `test/contract/quick_order/one-click-place.test.ts`, through the one
      // caller that can reach it from the storefront.
      if (org.status !== 'active') {
        throw new HttpError(
          423,
          ERROR_CODES.ORGANIZATION_SUSPENDED,
          'Organization is not active; orders cannot be placed.',
        );
      }

      const cart = await tx.findOne(Cart, {
        customerAccountId: ctx.customerAccountId,
        status: 'active',
      });
      const items = cart ? await tx.find(CartItem, { cartId: cart.id }) : [];
      if (!cart || items.length === 0) {
        throw new HttpError(409, ERROR_CODES.CART_EMPTY, 'Cart is empty.');
      }

      // Feature 038 (FR-035) — minimum order value gate (Checkout + admin
      // create both reach here). 0 ⇒ no minimum; resolver failures ⇒ no gate.
      if (this.resolveMinOrderValue) {
        const min = await this.resolveMinOrderValue(req.salesChannelId ?? null).catch(() => 0);
        if (min > 0) {
          const cartSubtotal = items.reduce((sum, it) => sum + Number(it.unitPrice) * it.quantity, 0);
          if (cartSubtotal < min) {
            throw new HttpError(
              422,
              ERROR_CODES.VALIDATION_FAILED,
              `Order total ${cartSubtotal.toFixed(2)} is below the minimum ${min.toFixed(2)} for this sales channel.`,
              { code: 'order_below_minimum', minimum: min, subtotal: cartSubtotal },
            );
          }
        }
      }

      const [delivery, billing] = await Promise.all([
        this.neighbours.addressRead.findById(ctx.organizationId, req.deliveryAddressId, {
          liveOnly: true,
        }),
        this.neighbours.addressRead.findById(ctx.organizationId, req.billingAddressId, {
          liveOnly: true,
        }),
      ]);
      if (!delivery || !billing) {
        throw new HttpError(403, ERROR_CODES.ADDRESS_NOT_OWNED, 'Address does not belong to the caller organization.');
      }

      const deliveryMethod = await this.activeDeliveryMethod(req.deliveryMethodId);
      if (!deliveryMethod) {
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Delivery method is not active.');
      }
      const paymentMethod = await this.activePaymentMethod(req.paymentMethodId);
      if (!paymentMethod) {
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Payment method is not active.');
      }
      // Feature 034 (US4/FR-015) — re-validate the selected method's adapter at
      // submit using the surface-appropriate validator. Admin (impersonated)
      // submissions use validateUseOnAdmin; customer submissions use
      // validateUseOnStorefront. A stale/ineligible selection is rejected.
      await this.assertPaymentMethodUsable(ctx, paymentMethod, req.salesChannelId ?? null);
      // Feature 035 (FR-014/FR-015) — same re-validation for the shipping method.
      await this.assertShippingMethodUsable(ctx, deliveryMethod, req.salesChannelId ?? null);

      // Resolve the order's sales channel once. Prefer the channel carried on
      // the request (Checkout / admin create); otherwise the platform's
      // **system-default** channel. Used for candidate warehouses, the
      // channel-level fulfilment setting, and the stamped order channel below,
      // so all three agree.
      //
      // Issue #85 — the fallback used to be `findOne(SalesChannel, { status:
      // 'active' })`: an arbitrary active row, ordered by nothing, read from
      // the legacy `status` column rather than from the flag that actually
      // names the default. Which channel an order recorded therefore depended
      // on Postgres' row order, and moving the flag changed nothing. The flag
      // is the platform's one answer to "which channel, when nobody said"
      // (D-47), and since D-51 an operator can move it, so the lookup has to
      // follow it. Read inside the transaction rather than through the
      // resolver's cache so the three uses below see one consistent snapshot.
      const orderChannel =
        (req.salesChannelId
          ? await tx.findOne(SalesChannel, { id: req.salesChannelId })
          : null) ?? (await tx.findOne(SalesChannel, { systemDefault: true }));
      // An order records the channel it was placed through; there is no honest
      // value for "none" in a `not null` column other code joins on. D-47's
      // invariant says this cannot happen after boot — so say so, rather than
      // persisting the `randomUUID()` that used to stand here (issue #85).
      if (orderChannel === null) throw new NoSystemDefaultChannel();

      // Reserve stock — feature 010 / US7 strategy-driven multi-warehouse
      // allocation (T079). Replaces the foundation 001 single-bucket
      // reserve.
      //
      // Pipeline per line:
      //   1. Resolve the effective fulfilment strategy through
      //      `inventoryFulfilmentPlanningPort`: product override
      //      (`product.fulfilmentStrategy`) wins over the organization's,
      //      which wins over the channel setting and the platform default.
      //   2. Snapshot `available = onHand - reserved` for every
      //      candidate warehouse for the channel under PESSIMISTIC_WRITE
      //      so concurrent placers can't double-allocate.
      //   3. Ask the same port for the allocation plan.
      //   4. If `ok=false`, raise 409 STOCK_UNAVAILABLE unless the
      //      product allows backorder.
      //   5. Increment `reserved` per allocation and stash the plan;
      //      `stock_allocations` rows are written after order items
      //      are persisted (stock_allocations_order_item_fk).
      //
      // **Presence is decided here, once, and the block is skipped whole**
      // (D-94.4, issue #188). `inventory` is declared `degrades-without` with
      // `whenAbsent: 'orders are placed without reserving stock'`, and this is
      // the check that declaration obliges. Until it existed, `inventory`
      // appeared nowhere in this module's manifest while every placement
      // locked `stock_levels`, incremented `reserved` and inserted
      // `stock_allocations` rows — so an operator who switched the module off
      // lost the stock screens and the storefront figure and kept every write
      // underneath them. Asked at the placement rather than at composition,
      // because an operator may flip the module between two orders.
      const inventory = this.neighbours.inventory();

      // One entry per item index, lining up with the OrderItems array created
      // below. `null` means the item is unmanaged and skips the
      // `stock_allocations` write entirely; a **short** array — which is what
      // an absent `inventory` leaves — means no line reserves anything, and
      // the write loop below reads `undefined` for every index and skips.
      const allocationPlan: Array<
        | null
        | Array<{ warehouseId: string; quantity: number; isBackorder: boolean }>
      > = [];

      if (inventory !== null) {
        const channelForStock = orderChannel;

        // Sales-channel + platform-default layer of the fulfilment-strategy
        // precedence chain, resolved once (org + product layers are applied
        // per-line below). Resolver failures degrade to the manifest default.
        const channelStrategyId = channelForStock.id;
        const channelDefault = {
          strategy: this.resolveChannelFulfilmentStrategy
            ? await this.resolveChannelFulfilmentStrategy(channelStrategyId).catch(
                () => 'default_first' as FulfilmentStrategy,
              )
            : ('default_first' as FulfilmentStrategy),
          warehouseOrder: this.resolveChannelFulfilmentWarehouseOrder
            ? await this.resolveChannelFulfilmentWarehouseOrder(channelStrategyId).catch(() => [])
            : [],
        };

        // Global backorder gate (inventory.allow_negative_stock). When off, a
        // product's per-product backorder flag is ignored below. Resolver
        // failures degrade to off (safest: never silently oversell).
        const allowNegativeStock = this.resolveChannelAllowNegativeStock
          ? await this.resolveChannelAllowNegativeStock(channelStrategyId).catch(() => false)
          : false;

        // Candidate warehouses for the channel, from their owner (D-94.4).
        // This was a knex join over `warehouse_channel_assignments` and
        // `warehouses` written here, plus a default-warehouse fallback spelled
        // out of a UUID constant imported from `inventory`'s entity file. Both
        // are inside `listChannelWarehouses` now, where the tables live.
        //
        // Note which port method this is **not**: `candidatesFor` answers the
        // richer question, and answers it through `inventory`'s own
        // `EntityManager` — so it neither takes nor holds the
        // `PESSIMISTIC_WRITE` below, which is the whole reason the reservation
        // stays here (test/contract/orders/place-stock-race.test.ts).
        const candidateWarehouses = await inventory.stockRead.listChannelWarehouses(
          channelForStock.id,
        );

        // Load product flags + strategy overrides.
        const orderProductIds = Array.from(new Set(items.map((i) => i.productId)));
        const orderProducts = orderProductIds.length
          ? await this.neighbours.catalogProductRead.findByIds(orderProductIds)
          : [];
        const productFlagsById = new Map(
          orderProducts.map((p) => [
            p.id,
            {
              manageStock: p.manageStock ?? true,
              backorderEnabled: p.backorderEnabled ?? false,
              fulfilmentStrategy: p.fulfilmentStrategy ?? null,
              fulfilmentStrategyWarehouseOrder: p.fulfilmentStrategyWarehouseOrder ?? null,
            },
          ]),
        );

        for (const item of items) {
          const flags = productFlagsById.get(item.productId);
          if (flags && !flags.manageStock) {
            // FR-022 — unmanaged stock: never reserve, never reject.
            allocationPlan.push(null);
            continue;
          }

          // Snapshot per-candidate availability under a write lock. We
          // load each (product, variant, warehouse) row individually so
          // the lock is fine-grained — and on `tx`, so it is held until the
          // order commits.
          const candidates: Array<{
            warehouseId: string;
            warehouseCode: string;
            isDefault: boolean;
            available: number;
            stockRow: StockLevel | null;
          }> = [];
          for (const row of candidateWarehouses) {
            const stock = await tx.findOne(
              StockLevel,
              {
                productId: item.productId,
                variantId: item.variantId ?? null,
                warehouseId: row.warehouseId,
              },
              { lockMode: LockMode.PESSIMISTIC_WRITE },
            );
            candidates.push({
              warehouseId: row.warehouseId,
              warehouseCode: row.warehouseCode,
              isDefault: row.isDefault,
              available: stock ? stock.onHand - stock.reserved : 0,
              stockRow: stock,
            });
          }

          // Precedence: Product → Organization → Sales Channel → platform default.
          const { strategy, warehouseOrder } = inventory.planning.resolveEffectiveStrategy(
            {
              strategy: flags?.fulfilmentStrategy ?? null,
              warehouseOrder: flags?.fulfilmentStrategyWarehouseOrder ?? null,
            },
            {
              strategy: org.fulfilmentStrategy ?? null,
              warehouseOrder: org.fulfilmentStrategyWarehouseOrder ?? null,
            },
            channelDefault,
          );

          const outcome = inventory.planning.planAllocations({
            quantity: item.quantity,
            candidateWarehouses: candidates.map((c) => ({
              warehouseId: c.warehouseId,
              warehouseCode: c.warehouseCode,
              available: c.available,
              isDefault: c.isDefault,
            })),
            strategy,
            warehouseOrder,
            backorderEnabled: allowNegativeStock && (flags?.backorderEnabled ?? false),
          });

          if (!outcome.ok) {
            throw new HttpError(
              409,
              ERROR_CODES.STOCK_UNAVAILABLE,
              `Insufficient stock for product ${item.productId}.`,
            );
          }

          // Apply the plan: increment reserved per warehouse. If a row
          // didn't exist, create it inline so the reserved counter has
          // somewhere to live (still no on-hand).
          const allocationsForLine: Array<{
            warehouseId: string;
            quantity: number;
            isBackorder: boolean;
          }> = [];
          for (const allocation of outcome.allocations) {
            const candidate = candidates.find((c) => c.warehouseId === allocation.warehouseId);
            if (!candidate) continue;
            if (candidate.stockRow) {
              candidate.stockRow.reserved += allocation.quantity;
            } else {
              const fresh = tx.create(StockLevel, {
                productId: item.productId,
                ...(item.variantId ? { variantId: item.variantId } : {}),
                warehouseId: candidate.warehouseId,
                onHand: 0,
                reserved: allocation.quantity,
              });
              tx.persist(fresh);
            }
            allocationsForLine.push({
              warehouseId: allocation.warehouseId,
              quantity: allocation.quantity,
              isBackorder: allocation.isBackorder,
            });
          }
          allocationPlan.push(allocationsForLine);
        }
      }

      const productIds = items.map((i) => i.productId);
      const products =
        productIds.length > 0
          ? await this.neighbours.catalogProductRead.findByIds(productIds)
          : [];
      const productById = new Map(products.map((p) => [p.id, p]));

      // Resolved once and used twice: the promotion engine's audience filter
      // inside the totals below, and the redemption row `finalizeUsage` writes.
      const customerGroupId = await this.resolveCustomerGroupId(ctx.customerAccountId, org);

      // All monetary math (subtotal, per-product VAT, delivery, surcharge,
      // promotion discount) runs through one shared computation so the storefront
      // preview endpoint and order placement can never drift.
      const {
        subtotal,
        taxTotal,
        deliveryTotal,
        paymentSurcharge,
        currency,
        discountTotal,
        total,
        appliedPromotionCode,
        appliedPromotions,
        rateForProductId,
      } = await this.computeMonetaryTotals({
        items,
        productById,
        vatStatus: org.vatStatus ?? 'vat_payer',
        taxCountry: billing.country ?? delivery.country ?? null,
        deliveryCost: Number(deliveryMethod.cost),
        paymentSurcharge: Number(paymentMethod.additionalPrice ?? '0'),
        currency: deliveryMethod.currency,
        appliedPromotionCode: cart.appliedPromotionCode ?? null,
        salesChannelId: cart.salesChannelId ?? null,
        organizationId: ctx.organizationId,
        customerGroupId,
      });

      // Sales channel — resolved once above (request channel preferred, the
      // system default otherwise) so the stamped channel matches the one used
      // for stock candidates and the channel-level fulfilment setting.
      const channel = orderChannel;

      // Feature 036 — customer-facing business Order ID, generated from the
      // monotonic sequence + the channel-scoped prefix/suffix settings. Falls
      // back to the entity's placeholder default when the generator is not
      // wired (legacy compositions / unit tests). Always a real channel id
      // now: an order placed without an explicit channel gets the default
      // channel's configured numbering rather than the platform-wide one.
      const businessId = this.businessId
        ? await this.businessId.generate(tx, channel.id)
        : undefined;

      const order = tx.create(Order, {
        organizationId: ctx.organizationId,
        placedByCustomerAccountId: ctx.customerAccountId,
        salesChannelId: channel.id,
        ...(businessId ? { businessId } : {}),
        deliveryAddress: {
          recipientName: delivery.recipientName,
          street: delivery.street,
          city: delivery.city,
          postalCode: delivery.postalCode,
          country: delivery.country,
          phone: delivery.phone ?? null,
        },
        billingAddress: {
          recipientName: billing.recipientName,
          street: billing.street,
          city: billing.city,
          postalCode: billing.postalCode,
          country: billing.country,
          phone: billing.phone ?? null,
          // Default the billing company + tax-id from the Organization; the
          // buyer may override either at checkout for this order only.
          companyName: req.billingCompanyName?.trim() || org.legalName || org.name,
          taxId: req.billingTaxId?.trim() || org.taxId,
        },
        deliveryMethodId: deliveryMethod.id,
        deliveryMethodSnapshot: {
          code: deliveryMethod.code,
          name: this.anyValue(deliveryMethod.name),
          cost: Number(deliveryMethod.cost),
        },
        paymentMethodId: paymentMethod.id,
        paymentMethodSnapshot: {
          code: paymentMethod.code,
          name: this.anyValue(paymentMethod.name),
          kind: paymentMethod.kind,
          adapter: paymentMethod.adapter,
          additionalPrice: paymentSurcharge,
        },
        // Feature 034 — the method's statusOnPending drives the initial order
        // status (validated against the OrderStatusRegistry when wired; falls
        // back to the entity default 'new' otherwise).
        ...(this.resolvePendingStatus(paymentMethod.statusOnPending)
          ? { status: this.resolvePendingStatus(paymentMethod.statusOnPending)! }
          : {}),
        subtotal: subtotal.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        deliveryTotal: deliveryTotal.toFixed(2),
        // Feature 036 (US3) — coupon discount recomputed above.
        discountTotal: discountTotal.toFixed(2),
        ...(appliedPromotionCode ? { promotionCode: appliedPromotionCode } : {}),
        total: total.toFixed(2),
        currency,
        ...(req.customerNote ? { customerNote: req.customerNote } : {}),
        ...(ctx.impersonatorAdminUserId
          ? { placedOnBehalfByAdminUserId: ctx.impersonatorAdminUserId }
          : {}),
        placedAt: new Date(),
        // Issue #277 — this order owes exactly one GA4 `purchase` conversion,
        // from the moment it exists. Set inside the placement transaction
        // rather than from a listener afterwards, so a placement that rolls
        // back leaves no order owing a conversion nobody can report, and so
        // the flag cannot be lost to a failure between the commit and a
        // second write. The column's `false` default is the opposite answer
        // on purpose, and only for rows that predate it — see the migration.
        purchaseConversionOwed: true,
      });
      await tx.persistAndFlush(order);

      // Feature 045 (US2) — stamp the per-promotion discount breakdown.
      for (const ap of appliedPromotions) {
        tx.persist(
          tx.create(OrderAppliedPromotion, {
            orderId: order.id,
            promotionId: ap.promotionId,
            couponId: ap.couponId ?? null,
            amount: ap.amount.toFixed(2),
            currency,
          }),
        );
      }
      if (appliedPromotions.length > 0) await tx.flush();

      // Feature 045 (US5) — atomically finalize usage inside this tx; a cap hit
      // throws 409 and rolls the whole placement back (race-safe, SC-005).
      if (this.promotionUsageFinalizer && appliedPromotions.length > 0) {
        await this.promotionUsageFinalizer.finalizeUsage(tx, {
          orderId: order.id,
          currency,
          ctx: {
            organizationId: ctx.organizationId,
            customerAccountId: ctx.customerAccountId,
            customerGroupId,
            salesChannelId: channel.id,
          },
          applied: appliedPromotions.map((ap) => ({
            promotionId: ap.promotionId,
            couponId: ap.couponId ?? null,
            amount: ap.amount,
          })),
        });
      }

      const orderItems = items.map((item) => {
        const product = productById.get(item.productId);
        // Feature 043 — when the line was ordered as a packaging unit, append
        // the unit name to the snapshot name so every order-derived document
        // shows it, and keep a structured snapshot for programmatic use.
        const baseName = product ? this.anyValue(product.name) : '';
        const snapshotName = item.packagingUnitName
          ? `${baseName} (${item.packagingUnitName})`
          : baseName;
        return tx.create(OrderItem, {
          orderId: order.id,
          productId: item.productId,
          productSnapshot: {
            sku: product?.sku ?? '',
            name: snapshotName,
            primaryAssetUrl: null,
          },
          ...(item.packagingUnitName && item.packagingUnitBaseQuantity != null
            ? {
                packagingUnitSnapshot: {
                  name: item.packagingUnitName,
                  baseQuantity: item.packagingUnitBaseQuantity,
                },
              }
            : {}),
          ...(item.variantId ? { variantId: item.variantId } : {}),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: rateForProductId(item.productId).toFixed(4),
          lineTotal: (
            Number(item.unitPrice) *
            item.quantity *
            (1 + rateForProductId(item.productId))
          ).toFixed(2),
        });
      });
      await tx.persistAndFlush(orderItems);

      // US7 / T079 — persist one stock_allocations row per
      // (orderItem, warehouse) pair from the plan `inventory` returned, so
      // admins can trace fulfilment provenance and cancellation releases
      // reservations cleanly. Splits a single line across warehouses when the
      // plan emits multiple allocations (only the `default_first` strategy
      // does this today).
      //
      // After `persistAndFlush(orderItems)` and required to be:
      // `stock_allocations_order_item_fk` (`on delete restrict`) means this
      // row cannot exist before its order item does. See the import.
      // `allocationPlan` is empty when `inventory` is not effectively present,
      // so this loop reads `undefined` at every index and writes nothing.
      for (let i = 0; i < orderItems.length; i++) {
        const plan = allocationPlan[i];
        if (!plan) continue;
        const oi = orderItems[i]!;
        for (const allocation of plan) {
          const row = tx.create(StockAllocation, {
            orderItemId: oi.id,
            warehouseId: allocation.warehouseId,
            quantity: allocation.quantity,
            isBackorder: allocation.isBackorder,
          });
          tx.persist(row);
        }
      }
      await tx.flush();

      // Inside the placement transaction, and required to be: `payments_order_fk`
      // (`on delete restrict`) means this row cannot exist before the order does,
      // and the order does not commit until this method returns. See the import.
      const payment = tx.create(Payment, {
        orderId: order.id,
        paymentMethodId: paymentMethod.id,
        amount: total.toFixed(2),
        currency,
      });
      await tx.persistAndFlush(payment);

      // Feature 034 — invoke the adapter's storefront_order_created handler
      // (FR-021). Feature 036 — capture the returned StartPaymentResult and map
      // it to the response NextAction so the Success Page can route the buyer
      // (transfer details / gateway redirect / nothing). The bundled offline
      // adapters are side-effect-free here; credit_limit reserves inline below.
      // Gateway adapters fork a separate EM and often cannot see just-flushed
      // Order/Payment/Customer rows until this transaction commits — pass
      // everything the adapter needs to start payment (esp. TPay payer fields).
      const placer = await this.neighbours.customerAccountRead.findById(ctx.customerAccountId);
      const payerName =
        [placer?.firstName, placer?.lastName].filter(Boolean).join(' ').trim() ||
        billing.recipientName ||
        placer?.email ||
        null;
      const adapter = this.paymentAdapters?.get(paymentMethod.adapter);
      const startResult = adapter
        ? await adapter.onStorefrontOrderCreated({
            orderId: order.id,
            paymentId: payment.id,
            amount: total,
            currency,
            paymentMethodCode: paymentMethod.code,
            paymentMethodId: paymentMethod.id,
            salesChannelId: order.salesChannelId,
            payerEmail: placer?.email ?? null,
            payerName,
            billingCountry: billing.country ?? null,
            orderBusinessId: order.businessId ?? null,
          })
        : ({ kind: 'none' } as const);
      order.nextAction = this.mapNextAction(startResult, { total, currency });

      // Feature 035 (FR-020) — fire the shipping adapter's order_created hook.
      // Offline adapters are no-ops; a Shipment is opened later by the explicit
      // shipment_created trigger, not here.
      const shippingAdapter = this.shippingAdapters?.get(deliveryMethod.adapter);
      if (shippingAdapter) {
        await shippingAdapter.onOrderCreated({
          orderId: order.id,
          deliveryMethodId: deliveryMethod.id,
          salesChannelId: order.salesChannelId,
          organizationId: ctx.organizationId,
        });
      }

      // Reserve credit limit when this order pays via the credit_limit driver.
      // Reservation runs INSIDE the order-placement transaction so a failure
      // (LIMIT_INSUFFICIENT, CURRENCY_MISMATCH, …) rolls back the Order row
      // and no dangling state remains (SC-011).
      if (paymentMethod.kind === 'credit_limit') {
        if (!this.creditLimit) {
          throw new HttpError(
            500,
            ERROR_CODES.INTERNAL,
            'Credit-limit driver is not wired into the order service.',
          );
        }
        const result = await this.creditLimit.reserve({
          organizationId: ctx.organizationId,
          orderId: order.id,
          amount: total,
          currency,
          tx,
        });
        if (!result.ok) {
          if (result.code === 'LIMIT_INSUFFICIENT') {
            throw new HttpError(
              409,
              ERROR_CODES.LIMIT_INSUFFICIENT,
              `Available credit limit (${result.availableAmount}) is below order total (${total}).`,
            );
          }
          if (result.code === 'CREDIT_LIMIT_NOT_GRANTED') {
            throw new HttpError(
              409,
              ERROR_CODES.CREDIT_LIMIT_NOT_GRANTED,
              'Organization has no credit limit; pick a different payment method.',
            );
          }
          if (result.code === 'CURRENCY_MISMATCH') {
            throw new HttpError(
              422,
              ERROR_CODES.CURRENCY_MISMATCH,
              'Order currency does not match the credit limit currency.',
            );
          }
        }
        // Credit-limit-paid orders: the payment status is `deferred` until the
        // invoice is paid out-of-band; admin marks it paid via
        // POST /admin/orders/:id/payment-status which releases the reservation.
        order.paymentStatus = 'deferred';
        payment.status = 'deferred';
      }

      // Kick off invoice row — status stays `pending` for the unit test that
      // hits the "not ready" contract; fixtures transition it to `ready` for
      // the download test.
      // The `payments` note above, for `invoices_order_fk`.
      const invoice = tx.create(Invoice, {
        orderId: order.id,
        kind: 'proforma',
        number: `${new Date().toISOString().slice(0, 10)}/${order.id.slice(0, 8)}`,
        currency,
        total: total.toFixed(2),
        status: 'pending',
      });
      await tx.persistAndFlush(invoice);

      // Clear cart — the cart produced an Order, so its lifecycle terminates
      // in `completed` per feature 027's renamed status vocabulary. Also
      // release the anonymous-cart token (always null on an authenticated
      // checkout today, but defensively cleared for future edge cases
      // where a customer might check out from an anon-derived cart that
      // still carries the token).
      await tx.nativeDelete(CartItem, { cartId: cart.id });
      cart.status = 'completed';
      // Which order emptied this cart (D-94.1). Written here rather than by a
      // `cartWritePort` call, and held by `carts_completed_order_fk`
      // (`carts.completed_order_id` -> `orders.id`, `on delete set null`): the
      // pointer cannot be written before the order exists, and a second
      // transaction would commit the completion for a placement that then
      // failed — which is the property
      // `test/integration/orders/place-order-failure-preserves-cart.test.ts`
      // asserts. The cart-side column is the direction that forces that;
      // `orders.cart_id` would have been satisfiable by a split.
      cart.completedOrderId = order.id;
      cart.anonymousCartToken = null;
      await tx.flush();

      this.events.emit('order.created.v1', {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        orderId: order.id,
        organizationId: ctx.organizationId,
      });

      // Feature 045 (T092) — one fire-and-forget event per finalized redemption
      // for downstream consumers (analytics / webhooks). Not the enforcement
      // path — usage was already finalized atomically above.
      for (const ap of appliedPromotions) {
        this.events.emit('promotion.used.v1', {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          orderId: order.id,
          promotionId: ap.promotionId,
          couponId: ap.couponId ?? null,
          amount: ap.amount,
        });
      }

      // Impersonated order placement → audit row tying the Admin User to the
      // action on behalf of the Customer (R-12, T183).
      if (ctx.impersonatorAdminUserId && this.auditLog) {
        await this.auditLog.record({
          actorAdminUserId: ctx.impersonatorAdminUserId,
          impersonatedCustomerAccountId: ctx.customerAccountId,
          action: 'order.place_on_behalf',
          objectType: 'order',
          objectId: order.id,
          stateBefore: null,
          stateAfter: { total: total.toFixed(2), currency, status: order.status },
        });
      }

      return order;
    });

    // Post-commit: order-confirmation e-mail (feature 034). Best effort — a
    // mail failure must not undo a placed order.
    try {
      await this.sendOrderConfirmation(order);
    } catch (error) {
      // Swallowed: the order is already committed; mail delivery is retried by
      // the transport, not by re-placing the order. Re-throwing here would
      // answer 503 to a placement that succeeded, which is why even the
      // presence answer the send lets travel stops at this seam — so it is
      // written down instead of vanishing (issue #78).
      orderEmailNotSent(undefined, { orderId: order.id, code: 'order_confirmation' }, 'failed', error);
    }
    return order;
  }

  async getById(orderId: string, ctx: CustomerContext): Promise<Order> {
    const em = this.emFactory();
    const where = await this.#scopedOrderWhere(em, ctx, { id: orderId });
    const order = await em.findOne(Order, where);
    if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
    return order;
  }

  async listForCustomer(ctx: CustomerContext): Promise<Order[]> {
    const em = this.emFactory();
    const where = await this.#scopedOrderWhere(em, ctx);
    return em.find(Order, where, { orderBy: { placedAt: 'desc' } });
  }

  /**
   * Delegates to OrderAccessService (T145). The rule itself — Organization
   * Admin sees all org orders, Regular User sees only their own — lives
   * there so any module that needs to enforce it imports the service
   * rather than duplicating the SQL. Out-of-scope reads return no rows
   * and the caller raises 404, never 403, to avoid leaking existence.
   */
  async #scopedOrderWhere(
    em: EntityManager,
    ctx: CustomerContext,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.accessService.scopedWhereWithEm(em, ctx, extra);
  }

  async listAll(): Promise<Order[]> {
    const em = this.emFactory();
    return em.find(Order, {}, { orderBy: { placedAt: 'desc' } });
  }

  /**
   * US7 / T080 — release every stock_allocations row tied to the order
   * (decrementing each affected stock_levels.reserved counter) and
   * stamp `released_at`. Idempotent — re-running this on a cancelled
   * order is a no-op because already-released rows are filtered out
   * by the `released_at IS NULL` predicate.
   */
  async releaseAllocations(orderId: string): Promise<{ released: number }> {
    // command-coverage-ignore: internal stock-reservation release — a lifecycle
    // side effect of the audited `order.status_transition` (cancel) command, not
    // a standalone admin write. Runs in its own transaction; the parent
    // transition owns the audit trail (mirrors credit_limits reserve/release).
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      // `tx.execute`, not `tx.getKnex()`: the knex instance is connection-level
      // and carries no transaction context, so this read took its own pooled
      // connection and could not see anything the surrounding transaction had
      // written (issue #200). Harmless for committed order lines, and the exact
      // shape that made the promotion-usage writes escape their transaction.
      const itemRows = await tx.execute<
        Array<{ id: string; product_id: string; variant_id: string | null; quantity: number }>
      >(
        `select "id", "product_id", "variant_id", "quantity"
           from "order_items"
          where "order_id" = ?`,
        [orderId],
      );
      if (itemRows.length === 0) return { released: 0 };

      const { StockAllocation } = await import(
        '../../inventory/entities/stock-allocation.entity.js'
      );
      const { StockLevel } = await import(
        '../../inventory/entities/stock-level.entity.js'
      );

      const allocations = await tx.find(StockAllocation, {
        orderItemId: { $in: itemRows.map((r) => r.id) },
        releasedAt: null,
      });
      if (allocations.length === 0) return { released: 0 };

      const itemById = new Map(itemRows.map((r) => [r.id, r]));
      const now = new Date();
      for (const a of allocations) {
        const item = itemById.get(a.orderItemId);
        if (!item) continue;
        const stock = await tx.findOne(StockLevel, {
          productId: item.product_id,
          variantId: item.variant_id ?? null,
          warehouseId: a.warehouseId,
        });
        if (stock) {
          stock.reserved = Math.max(0, stock.reserved - a.quantity);
        }
        a.releasedAt = now;
      }
      await tx.flush();
      return { released: allocations.length };
    });
  }

  /** Admin payment-status transition (T210 + T149). */
  async transitionPaymentStatus(
    orderId: string,
    to: 'paid' | 'refunded',
  ): Promise<Order> {
    const em = this.emFactory();
    const order = await em.findOne(Order, { id: orderId });
    if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
    const paymentBefore = order.paymentStatus;
    order.paymentStatus = to;
    // Feature 054 — audit the payment-status change co-transactionally (actor
    // from the ambient TenantContext; the admin route always carries one).
    if (this.auditLog) {
      const ctx = getTenantContext();
      const actor = ctx ? actorFromContext(ctx) : null;
      this.auditLog.recordWithin(em, {
        action: 'order.payment_status_transition',
        objectType: 'order',
        objectId: order.id,
        actorAdminUserId: actor?.actorAdminUserId ?? null,
        impersonatedCustomerAccountId: actor?.impersonatedCustomerAccountId ?? null,
        stateBefore: { paymentStatus: paymentBefore },
        stateAfter: { paymentStatus: to },
      });
    }
    await em.flush();
    if (to === 'paid' && this.creditLimit) {
      await this.creditLimit.releaseByOrder({
        orderId: order.id,
        reason: 'invoice_paid',
      });
    }
    return order;
  }

  private anyValue(blob: Record<string, string>): string {
    const k = Object.keys(blob)[0];
    return k ? (blob[k] ?? '') : '';
  }
}
