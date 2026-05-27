import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import { ERROR_CODES, type PlaceOrderRequest } from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { Address } from '../../addresses/entities/address.entity.js';
import { Cart } from '../../carts/entities/cart.entity.js';
import { CartItem } from '../../carts/entities/cart-item.entity.js';
import { DeliveryMethod } from '../../delivery_methods/entities/delivery-method.entity.js';
import { PaymentMethod } from '../../payment_methods/entities/payment-method.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/order-item.entity.js';
import { Payment } from '../../payments/entities/payment.entity.js';
import { Invoice } from '../../invoices/entities/invoice.entity.js';
import { OrderAccessService } from './order-access-service.js';
import type { PaymentAdapterRegistry } from '../../payment_methods/services/payment-adapter-registry.js';
import type { OrderStatusRegistry } from '../../payment_methods/services/order-status-registry.port.js';
import type { Mailer } from '../../email/services/mailer.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { buildOrderConfirmationEmail } from '../email-templates/order-confirmation.js';

/**
 * Narrow port consumed by the order-placement transaction. The credit_limits
 * module wires its CreditLimitService here; a no-op fallback short-circuits
 * the flow when the payment method is not credit_limit.
 */
export interface CreditLimitPort {
  reserve(input: {
    organizationId: string;
    orderId: string;
    amount: number;
    currency: string;
    tx: EntityManager;
  }): Promise<
    | { ok: true; reservationId: string; availableAmountAfter: number }
    | { ok: false; code: 'LIMIT_INSUFFICIENT'; availableAmount: number }
    | { ok: false; code: 'CREDIT_LIMIT_NOT_GRANTED' }
    | { ok: false; code: 'CURRENCY_MISMATCH' }
  >;
  releaseByOrder(input: {
    orderId: string;
    reason: 'invoice_paid' | 'order_cancelled' | 'admin_revocation';
  }): Promise<unknown>;
}

export interface OrderEvents extends Record<string, EventBase> {
  'order.created.v1': EventBase & { orderId: string; organizationId: string };
  'order.status_changed.v1': EventBase & {
    orderId: string;
    from: string;
    to: string;
  };
  'order.cancelled.v1': EventBase & { orderId: string };
}
export type OrderEventBus = EventBus<OrderEvents>;

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
export class OrderService {
  private readonly accessService: OrderAccessService;

  private readonly paymentAdapters: PaymentAdapterRegistry | undefined;
  private readonly orderStatusRegistry: OrderStatusRegistry | undefined;
  private readonly mailer: Mailer | undefined;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: OrderEventBus,
    private readonly auditLog?: AuditLogService,
    private readonly creditLimit?: CreditLimitPort,
    accessService?: OrderAccessService,
    paymentDeps?: {
      paymentAdapters?: PaymentAdapterRegistry;
      orderStatusRegistry?: OrderStatusRegistry;
      mailer?: Mailer;
    },
  ) {
    this.accessService = accessService ?? new OrderAccessService(emFactory);
    this.paymentAdapters = paymentDeps?.paymentAdapters;
    this.orderStatusRegistry = paymentDeps?.orderStatusRegistry;
    this.mailer = paymentDeps?.mailer;
  }

  /**
   * Feature 034 — order-confirmation e-mail, dispatched post-commit (best
   * effort; a mail failure never rolls back a placed order). Resolves the
   * customer's address, the line items, and the adapter's e-mail renderer key,
   * then sends the templated confirmation.
   */
  private async sendOrderConfirmation(order: Order): Promise<void> {
    if (!this.mailer) return;
    const em = this.emFactory();
    const [customer, items] = await Promise.all([
      em.findOne(CustomerAccount, { id: order.placedByCustomerAccountId }),
      em.find(OrderItem, { orderId: order.id }),
    ]);
    if (!customer) return;
    const rendererKey =
      this.paymentAdapters?.get(order.paymentMethodSnapshot.adapter ?? '')?.renderers?.email ??
      null;
    const message = buildOrderConfirmationEmail({
      to: customer.email,
      order: {
        id: order.id,
        deliveryMethodSnapshot: order.deliveryMethodSnapshot,
        paymentMethodSnapshot: order.paymentMethodSnapshot,
        paymentRendererKey: rendererKey,
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
    });
    await this.mailer.send(message);
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
   */
  private async assertPaymentMethodUsable(
    ctx: CustomerContext,
    method: PaymentMethod,
  ): Promise<void> {
    const adapter = this.paymentAdapters?.get(method.adapter);
    if (!adapter) return;
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
      salesChannelId: '',
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

  async placeOrder(
    ctx: CustomerContext,
    req: PlaceOrderRequest,
  ): Promise<Order> {
    const em = this.emFactory();
    const order = await em.transactional(async (tx) => {
      const org = await tx.findOne(Organization, { id: ctx.organizationId });
      if (!org) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
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

      const [delivery, billing] = await Promise.all([
        tx.findOne(Address, { id: req.deliveryAddressId, organizationId: ctx.organizationId, deletedAt: null }),
        tx.findOne(Address, { id: req.billingAddressId, organizationId: ctx.organizationId, deletedAt: null }),
      ]);
      if (!delivery || !billing) {
        throw new HttpError(403, ERROR_CODES.ADDRESS_NOT_OWNED, 'Address does not belong to the caller organization.');
      }

      const deliveryMethod = await tx.findOne(DeliveryMethod, { id: req.deliveryMethodId, status: 'active' });
      if (!deliveryMethod) {
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Delivery method is not active.');
      }
      const paymentMethod = await tx.findOne(PaymentMethod, { id: req.paymentMethodId, status: 'active' });
      if (!paymentMethod) {
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Payment method is not active.');
      }
      // Feature 034 (US4/FR-015) — re-validate the selected method's adapter at
      // submit using the surface-appropriate validator. Admin (impersonated)
      // submissions use validateUseOnAdmin; customer submissions use
      // validateUseOnStorefront. A stale/ineligible selection is rejected.
      await this.assertPaymentMethodUsable(ctx, paymentMethod);

      // Reserve stock — feature 010 / US7 strategy-driven multi-warehouse
      // allocation (T079). Replaces the foundation 001 single-bucket
      // reserve.
      //
      // Pipeline per line:
      //   1. Resolve effective fulfilment strategy: product override
      //      (`product.fulfilmentStrategy`) wins over the global
      //      default. The global default falls back to `default_first`
      //      when no SettingsService is wired (kept dependency-light).
      //   2. Snapshot `available = onHand - reserved` for every
      //      candidate warehouse for the channel under PESSIMISTIC_WRITE
      //      so concurrent placers can't double-allocate.
      //   3. Run `FulfilmentStrategyResolver.resolveAllocations(...)`.
      //   4. If `ok=false`, raise 409 STOCK_UNAVAILABLE unless the
      //      product allows backorder.
      //   5. Increment `reserved` per allocation and stash the plan;
      //      `stock_allocations` rows are written after order items
      //      are persisted (StockAllocation FK = order_items.id).
      const { StockLevel } = await import('../../inventory/entities/stock-level.entity.js');
      const { DEFAULT_WAREHOUSE_ID } = await import('../../inventory/entities/warehouse.entity.js');
      const { resolveAllocations } = await import(
        '../../inventory/services/fulfilment-strategy-resolver.js'
      );

      const channelForStock = await tx.findOne(SalesChannel, { status: 'active' });
      const knexForStock = tx.getKnex();

      // Candidate warehouses for the channel — joined with the warehouses
      // table so we can carry the code (used by lex tie-breaks in the
      // resolver) and the isDefault flag.
      const candidateRows = channelForStock
        ? ((await knexForStock('warehouse_channel_assignments as a')
            .join('warehouses as w', 'w.id', 'a.warehouse_id')
            .where('a.sales_channel_id', channelForStock.id)
            .where('w.active', true)
            .orderBy('a.is_default', 'desc')
            .orderBy('a.sort_order', 'asc')
            .orderBy('a.created_at', 'asc')
            .select(
              'a.warehouse_id',
              'w.code as warehouse_code',
              'a.is_default',
            )) as Array<{
            warehouse_id: string;
            warehouse_code: string;
            is_default: boolean;
          }>)
        : [];
      const candidateWarehouseIds = candidateRows.map((r) => r.warehouse_id);
      // Fallback when the channel has no warehouses bound — the
      // boot-time WarehouseChannelReconciler keeps this case from
      // happening in production but we keep a safe path for tests
      // and seed-skipped environments.
      const fallbackWarehouseIds =
        candidateWarehouseIds.length === 0 ? [DEFAULT_WAREHOUSE_ID] : candidateWarehouseIds;

      // Load product flags + strategy overrides.
      const orderProductIds = Array.from(new Set(items.map((i) => i.productId)));
      const orderProducts = orderProductIds.length
        ? await tx.find(Product, { id: { $in: orderProductIds } })
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

      // Allocation plan — one entry per item index, lining up with the
      // OrderItems array we'll create later. `null` means the item is
      // unmanaged and skips the stock_allocations write entirely.
      const allocationPlan: Array<
        | null
        | Array<{ warehouseId: string; quantity: number; isBackorder: boolean }>
      > = [];

      for (const item of items) {
        const flags = productFlagsById.get(item.productId);
        if (flags && !flags.manageStock) {
          // FR-022 — unmanaged stock: never reserve, never reject.
          allocationPlan.push(null);
          continue;
        }

        // Snapshot per-candidate availability under a write lock. We
        // load each (product, variant, warehouse) row individually so
        // the lock is fine-grained.
        const candidates: Array<{
          warehouseId: string;
          warehouseCode: string;
          isDefault: boolean;
          available: number;
          stockRow: typeof StockLevel.prototype | null;
        }> = [];
        for (const row of candidateRows.length > 0
          ? candidateRows
          : fallbackWarehouseIds.map((id) => ({
              warehouse_id: id,
              warehouse_code: id === DEFAULT_WAREHOUSE_ID ? 'default' : id,
              is_default: id === DEFAULT_WAREHOUSE_ID,
            }))) {
          const stock = await tx.findOne(
            StockLevel,
            {
              productId: item.productId,
              variantId: item.variantId ?? null,
              warehouseId: row.warehouse_id,
            },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          );
          candidates.push({
            warehouseId: row.warehouse_id,
            warehouseCode: row.warehouse_code,
            isDefault: row.is_default,
            available: stock ? stock.onHand - stock.reserved : 0,
            stockRow: stock,
          });
        }

        const strategy = (flags?.fulfilmentStrategy ?? 'default_first') as
          | 'any'
          | 'default_first'
          | 'lowest_stock_first'
          | 'highest_stock_first'
          | 'defined_order';
        const warehouseOrder = flags?.fulfilmentStrategyWarehouseOrder ?? [];

        const outcome = resolveAllocations({
          quantity: item.quantity,
          candidateWarehouses: candidates.map((c) => ({
            warehouseId: c.warehouseId,
            warehouseCode: c.warehouseCode,
            available: c.available,
            isDefault: c.isDefault,
          })),
          strategy,
          warehouseOrder,
          backorderEnabled: flags?.backorderEnabled ?? false,
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

      const productIds = items.map((i) => i.productId);
      const products = productIds.length > 0 ? await tx.find(Product, { id: { $in: productIds } }) : [];
      const productById = new Map(products.map((p) => [p.id, p]));

      const subtotal = items.reduce((acc, it) => acc + Number(it.unitPrice) * it.quantity, 0);
      const taxRate = 0.23; // Polish VAT default — the real tax service picks per country+type in T131.
      const taxTotal = Math.round(subtotal * taxRate * 100) / 100;
      const deliveryTotal = Number(deliveryMethod.cost);
      // Feature 034 — flat payment surcharge in the order currency (FR-005 / US2 AC2).
      const paymentSurcharge = Number(paymentMethod.additionalPrice ?? '0');
      const total = Math.round((subtotal + taxTotal + deliveryTotal + paymentSurcharge) * 100) / 100;
      const currency = deliveryMethod.currency;

      // Sales channel — use any active one; real resolution uses Cart ↔ Channel in US2 T136.
      const channel = await tx.findOne(SalesChannel, { status: 'active' });

      const order = tx.create(Order, {
        organizationId: ctx.organizationId,
        placedByCustomerAccountId: ctx.customerAccountId,
        salesChannelId: channel?.id ?? randomUUID(),
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
        total: total.toFixed(2),
        currency,
        ...(req.customerNote ? { customerNote: req.customerNote } : {}),
        ...(ctx.impersonatorAdminUserId
          ? { placedOnBehalfByAdminUserId: ctx.impersonatorAdminUserId }
          : {}),
        placedAt: new Date(),
      });
      await tx.persistAndFlush(order);

      const orderItems = items.map((item) => {
        const product = productById.get(item.productId);
        return tx.create(OrderItem, {
          orderId: order.id,
          productId: item.productId,
          productSnapshot: {
            sku: product?.sku ?? '',
            name: product ? this.anyValue(product.name) : '',
            primaryAssetUrl: null,
          },
          ...(item.variantId ? { variantId: item.variantId } : {}),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: taxRate.toFixed(4),
          lineTotal: (Number(item.unitPrice) * item.quantity * (1 + taxRate)).toFixed(2),
        });
      });
      await tx.persistAndFlush(orderItems);

      // US7 / T079 — persist one stock_allocations row per
      // (orderItem, warehouse) pair from the strategy resolver's plan
      // so admins can trace fulfilment provenance and cancellation
      // releases reservations cleanly. Splits a single line across
      // warehouses when the plan emits multiple allocations (only the
      // `default_first` strategy does this today).
      const { StockAllocation } = await import(
        '../../inventory/entities/stock-allocation.entity.js'
      );
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

      const payment = tx.create(Payment, {
        orderId: order.id,
        paymentMethodId: paymentMethod.id,
        amount: total.toFixed(2),
        currency,
      });
      await tx.persistAndFlush(payment);

      // Feature 034 — invoke the adapter's storefront_order_created handler
      // (FR-021). Threading the returned nextAction into the place-order
      // response is a follow-up; the bundled offline adapters are
      // side-effect-free here and credit_limit reserves inline below.
      const adapter = this.paymentAdapters?.get(paymentMethod.adapter);
      if (adapter) {
        await adapter.onStorefrontOrderCreated({
          orderId: order.id,
          paymentId: payment.id,
          amount: total,
          currency,
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
      cart.anonymousCartToken = null;
      await tx.flush();

      this.events.emit('order.created.v1', {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        orderId: order.id,
        organizationId: ctx.organizationId,
      });

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
    } catch {
      // Swallowed: the order is already committed; mail delivery is retried by
      // the transport, not by re-placing the order.
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

  async transitionStatus(orderId: string, to: Order['status']): Promise<Order> {
    const em = this.emFactory();
    const order = await em.findOne(Order, { id: orderId });
    if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
    if (!this.isValidTransition(order.status, to)) {
      throw new HttpError(
        409,
        ERROR_CODES.INVALID_TRANSITION,
        `Cannot transition from "${order.status}" to "${to}".`,
      );
    }
    const from = order.status;
    order.status = to;
    await em.flush();
    this.events.emit('order.status_changed.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      orderId: order.id,
      from,
      to,
    });
    // Cancellation releases the credit-limit reservation (T211)
    // and the per-warehouse stock allocations (US7 / T080).
    if (to === 'cancelled') {
      if (this.creditLimit) {
        await this.creditLimit.releaseByOrder({
          orderId: order.id,
          reason: 'order_cancelled',
        });
      }
      await this.releaseAllocations(order.id);
    }
    return order;
  }

  /**
   * US7 / T080 — release every stock_allocations row tied to the order
   * (decrementing each affected stock_levels.reserved counter) and
   * stamp `released_at`. Idempotent — re-running this on a cancelled
   * order is a no-op because already-released rows are filtered out
   * by the `released_at IS NULL` predicate.
   */
  async releaseAllocations(orderId: string): Promise<{ released: number }> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const knex = tx.getKnex();
      const itemRows = await knex('order_items')
        .where('order_id', orderId)
        .select<Array<{ id: string; product_id: string; variant_id: string | null; quantity: number }>>(
          'id',
          'product_id',
          'variant_id',
          'quantity',
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
    order.paymentStatus = to;
    await em.flush();
    if (to === 'paid' && this.creditLimit) {
      await this.creditLimit.releaseByOrder({
        orderId: order.id,
        reason: 'invoice_paid',
      });
    }
    return order;
  }

  private isValidTransition(from: Order['status'], to: Order['status']): boolean {
    const graph: Record<Order['status'], Order['status'][]> = {
      new: ['confirmed', 'cancelled'],
      confirmed: ['in_fulfilment', 'cancelled'],
      in_fulfilment: ['shipped'],
      shipped: ['completed'],
      completed: [],
      cancelled: [],
    };
    return graph[from].includes(to);
  }

  private anyValue(blob: Record<string, string>): string {
    const k = Object.keys(blob)[0];
    return k ? (blob[k] ?? '') : '';
  }
}
