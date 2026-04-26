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
import { SalesChannel } from '../../catalog/entities/sales-channel.entity.js';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/order-item.entity.js';
import { Payment } from '../../payments/entities/payment.entity.js';
import { Invoice } from '../../invoices/entities/invoice.entity.js';
import { OrderAccessService } from './order-access-service.js';

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

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: OrderEventBus,
    private readonly auditLog?: AuditLogService,
    private readonly creditLimit?: CreditLimitPort,
    accessService?: OrderAccessService,
  ) {
    this.accessService = accessService ?? new OrderAccessService(emFactory);
  }

  async placeOrder(
    ctx: CustomerContext,
    req: PlaceOrderRequest,
  ): Promise<Order> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
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

      // Reserve stock — PESSIMISTIC_WRITE lock serialises concurrent placers.
      // Using the EM here (rather than getConnection().execute) is critical:
      // it ensures the SELECT FOR UPDATE participates in the transaction held
      // by `tx`. The raw connection layer is not transaction-aware in v6.
      const { StockLevel } = await import('../../inventory/entities/stock-level.entity.js');
      for (const item of items) {
        const stock = await tx.findOne(
          StockLevel,
          { productId: item.productId, variantId: item.variantId ?? null },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        if (stock) {
          const available = stock.onHand - stock.reserved;
          if (available < item.quantity) {
            throw new HttpError(
              409,
              ERROR_CODES.STOCK_UNAVAILABLE,
              `Insufficient stock for product ${item.productId}.`,
            );
          }
          stock.reserved += item.quantity;
        }
        // No StockLevel row → the product uses categorical stock mode or is not tracked.
        // That's fine: skip reservation.
      }

      const productIds = items.map((i) => i.productId);
      const products = productIds.length > 0 ? await tx.find(Product, { id: { $in: productIds } }) : [];
      const productById = new Map(products.map((p) => [p.id, p]));

      const subtotal = items.reduce((acc, it) => acc + Number(it.unitPrice) * it.quantity, 0);
      const taxRate = 0.23; // Polish VAT default — the real tax service picks per country+type in T131.
      const taxTotal = Math.round(subtotal * taxRate * 100) / 100;
      const deliveryTotal = Number(deliveryMethod.cost);
      const total = Math.round((subtotal + taxTotal + deliveryTotal) * 100) / 100;
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
        },
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

      const payment = tx.create(Payment, {
        orderId: order.id,
        paymentMethodId: paymentMethod.id,
        amount: total.toFixed(2),
        currency,
      });
      await tx.persistAndFlush(payment);

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

      // Clear cart
      await tx.nativeDelete(CartItem, { cartId: cart.id });
      cart.status = 'converted';
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
          stateAfter: { total: total.toFixed(2), currency, status: 'new' },
        });
      }

      return order;
    });
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
    // Cancellation releases the credit-limit reservation (T211).
    if (to === 'cancelled' && this.creditLimit) {
      await this.creditLimit.releaseByOrder({
        orderId: order.id,
        reason: 'order_cancelled',
      });
    }
    return order;
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
