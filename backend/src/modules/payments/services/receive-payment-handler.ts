import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, ORDER_STATUS_ON_HOLD, type ReceivePayment } from '@b2b/contracts';
import type {
  OrderStatusAnnouncePort,
  OrderStatusRegistry,
  PaymentMethodReadPort,
} from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Payment } from '../entities/payment.entity.js';
/**
 * `Order` is the one cross-module import feature 075 keeps here **permanently**
 * (D-78 point 2).
 *
 * `payments.order_id` carries a declared foreign key into `orders.id`
 * (`payments_order_fk`, `on delete restrict`), so this is a genuinely
 * co-transactional seam: a gateway callback moves the payment row and the
 * order's `status` / `paymentStatus` in one `em.transactional`, and either both
 * land or neither does. D-78 rules that such a seam keeps the caller's
 * `EntityManager` and is *declared* — `orders` is in this module's manifest
 * `dependencies` (the FK already required it), the ledger entry names the
 * constraint, and this comment says which transaction the write runs in.
 *
 * **It is the only one left, and the other two went because their blocker did.**
 * They were held open by a sentence that had stopped being true: that `stripe`,
 * `payu`, `tpay` and `autopay` each construct this handler themselves, so its
 * constructor could not take a port none of them can build. All four resolve
 * `receivePaymentPort` today and the one construction left is in
 * `payments/backend.ts`, where `ctx` is in hand — so the payment-method read is
 * `paymentMethodReadPort` and the announcement is `orderStatusAnnouncePort`.
 * Neither shares the constraint above: the method read is a read of a row this
 * transaction never writes (no FK obliges it to be co-transactional, and the
 * identical read is a port in `shipments`' twin handler), and the announcement
 * runs **after** the commit, over a status change that is already durable.
 */
import { Order } from '../../orders/entities/order.entity.js';

export interface PaymentEvents extends Record<string, EventBase> {
  'payment.received.v1': EventBase & {
    orderId: string;
    paymentId: string;
    adapter: string;
    externalReference: string | null;
    attemptNo: number;
  };
  'payment.failed.v1': EventBase & {
    orderId: string;
    paymentId: string;
    adapter: string;
    failureReason: string | null;
    attemptNo: number;
  };
  'payment.refunded.v1': EventBase & {
    orderId: string;
    paymentId: string;
    refundedAmount: number;
    currency: string;
    fullyRefunded: boolean;
    externalRefundId: string | null;
  };
}
export type PaymentEventBus = EventBus<PaymentEvents>;

export interface ReceivePaymentResult {
  paymentId: string;
  status: Payment['status'];
  orderStatus: string | null;
  idempotent: boolean;
}

/**
 * ReceivePaymentHandler (feature 034, FR-022/FR-023/FR-025).
 *
 * Resolves a Payment from the ingress payload, applies the outcome, and maps
 * the order status through the method's statusOnSuccess / statusOnFailure via
 * the OrderStatusRegistry. Idempotent: a success after a terminal `paid` is a
 * no-op; a failure after `paid` is rejected (no downgrade). Resolves a late
 * event even when the adapter has since been de-registered (it keys on the
 * persisted Payment, not the live registry).
 */
export class ReceivePaymentHandler {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * The method behind the payment, as `payment_methods` publishes it. Read
     * inside the settlement transaction, as `shipments` reads its delivery
     * method: it is a read of a row this transaction never writes, so it is not
     * held by `payments_order_fk` and carries none of the atomicity the `Order`
     * import above does. When `payment_methods` is off it throws, inside the
     * transaction, and the payment and the order roll back together.
     */
    private readonly paymentMethodRead: PaymentMethodReadPort,
    /**
     * The templated `order.status.*.after` announcement, which `orders` owns
     * because the status set is admin-configurable and the event names are
     * therefore not known at compile time. Called after the commit, over a
     * status change that is already durable.
     */
    private readonly orderStatusAnnounce: OrderStatusAnnouncePort,
    private readonly orderStatusRegistry?: OrderStatusRegistry,
    private readonly events?: PaymentEventBus,
  ) {}

  async receive(input: ReceivePayment): Promise<ReceivePaymentResult> {
    // command-coverage-ignore: provider payment-event ingestion — stamps the
    // attempt result and drives the order transition (audited in the orders flow).
    const em = this.emFactory();
    const result = await em.transactional(async (tx) => {
      const payment = await this.resolvePayment(tx, input);
      if (!payment) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Payment not found for the given reference.');
      }

      // Idempotency / terminal-state guards (FR-025).
      if (payment.status === 'paid') {
        if (input.outcome === 'failure') {
          throw new HttpError(
            409,
            ERROR_CODES.VALIDATION_FAILED,
            'Payment is already settled; it cannot be marked failed.',
          );
        }
        return { payment, orderStatus: null as string | null, idempotent: true, emit: false };
      }

      const order = await tx.findOne(Order, { id: payment.orderId });
      const method = await this.paymentMethodRead.findById(payment.paymentMethodId);
      const orderStatusBefore = order?.status ?? null;

      if (input.outcome === 'success') {
        payment.status = 'paid';
        payment.paidAt = new Date();
        if (input.externalReference !== undefined) {
          payment.externalReference = input.externalReference ?? null;
        }
        if (input.providerDetails) payment.providerDetails = input.providerDetails;
        if (order) {
          order.paymentStatus = 'paid';
          this.applyOrderStatus(order, method?.statusOnSuccess);
        }
      } else {
        payment.status = 'failed';
        payment.failureReason = input.failureReason ?? null;
        if (input.providerDetails) payment.providerDetails = input.providerDetails;
        if (order) {
          // Feature 085 (FR-001) — the decline is recorded on the money axis
          // too. The lifecycle status alone could not say it: the method's
          // `status_on_failure` is operator-configurable, so two orders sitting
          // at the same status may have arrived there for opposite reasons, and
          // the buyer's retry and the operator's list both need to know which.
          order.paymentStatus = 'failed';
          this.applyOrderStatus(order, method?.statusOnFailure);
        }
      }

      await tx.flush();
      return {
        payment,
        orderStatus: order?.status ?? null,
        idempotent: false,
        emit: true,
        adapter: method?.adapter ?? payment.paymentMethodId,
        orderStatusBefore,
        orderStatusAfter: order?.status ?? null,
        organizationId: order?.organizationId ?? null,
        salesChannelId: order?.salesChannelId ?? null,
      };
    });

    if (result.emit && this.events) {
      const base = { eventId: randomUUID(), occurredAt: new Date().toISOString() };
      if (result.payment.status === 'paid') {
        this.events.emit('payment.received.v1', {
          ...base,
          orderId: result.payment.orderId,
          paymentId: result.payment.id,
          adapter: (result as { adapter?: string }).adapter ?? '',
          externalReference: result.payment.externalReference ?? null,
          attemptNo: result.payment.attemptNo,
        });
      } else {
        this.events.emit('payment.failed.v1', {
          ...base,
          orderId: result.payment.orderId,
          paymentId: result.payment.id,
          adapter: (result as { adapter?: string }).adapter ?? '',
          failureReason: result.payment.failureReason ?? null,
          attemptNo: result.payment.attemptNo,
        });
      }

      // Feature 038 (T026) — emit the templated order status `.after` events for
      // the system-driven transition so cross-module subscribers react to
      // payment-driven status changes too. Authoritative (no graph/veto).
      const r = result as {
        orderStatusBefore: string | null;
        orderStatusAfter: string | null;
        organizationId: string | null;
        salesChannelId: string | null;
      };
      if (r.orderStatusBefore && r.orderStatusAfter && r.organizationId && r.salesChannelId) {
        this.orderStatusAnnounce.announceStatusChanged({
          orderId: result.payment.orderId,
          organizationId: r.organizationId,
          salesChannelId: r.salesChannelId,
          from: r.orderStatusBefore,
          to: r.orderStatusAfter,
          actor: { kind: 'system', source: 'payment' },
        });
      }
    }

    return {
      paymentId: result.payment.id,
      status: result.payment.status,
      orderStatus: result.orderStatus,
      idempotent: result.idempotent,
    };
  }

  /**
   * Reflect a gateway refund onto the Payment + Order (feature 049). Driven by
   * the `charge.refunded` webhook for BOTH Dashboard- and platform-initiated
   * refunds. `refundedAmount` is the gateway's cumulative total, so this is
   * idempotent by construction (re-applying the same total is a no-op) and never
   * calls the gateway back (no refund loop). A fully-refunded payment is never
   * downgraded to partial.
   */
  async reflectRefund(input: {
    // command-coverage-ignore: reflects a provider refund on the payment attempt;
    // the refund/return domain event is audited in the returns/orders flow.
    paymentId?: string;
    orderId?: string;
    /** PaymentIntent id (`pi_…`) — resolves the payment when no paymentId. */
    externalReference?: string;
    /** Cumulative refunded amount in major units. */
    refundedAmount: number;
    currency: string;
    fullyRefunded: boolean;
    externalRefundId?: string | null;
    providerDetails?: Record<string, unknown>;
  }): Promise<{ paymentId: string; changed: boolean } | null> {
    const em = this.emFactory();
    const result = await em.transactional(async (tx) => {
      const payment = await this.resolvePaymentForRefund(tx, input);
      if (!payment) return null;

      const newRefunded = input.refundedAmount.toFixed(2);
      const nextStatus: Payment['status'] = input.fullyRefunded
        ? 'refunded'
        : input.refundedAmount > 0 && payment.status !== 'refunded'
          ? 'partially_refunded'
          : payment.status;
      const changed = payment.refundedAmount !== newRefunded || payment.status !== nextStatus;

      payment.refundedAmount = newRefunded;
      payment.status = nextStatus;
      payment.providerDetails = {
        ...(payment.providerDetails ?? {}),
        ...(input.providerDetails ?? {}),
        // Stamp the refund time only when the total actually moved, so a
        // re-delivered webhook does not bump the recorded refund timestamp.
        ...(changed ? { refundedAt: new Date().toISOString() } : {}),
        ...(input.externalRefundId ? { refundReference: input.externalRefundId } : {}),
      };

      const order = await tx.findOne(Order, { id: payment.orderId });
      let orderStatusBefore: string | null = null;
      let orderStatusAfter: string | null = null;
      // Only a full refund flips the order's payment status; a partial refund is
      // tracked on the payment while the order stays 'paid'.
      if (order && input.fullyRefunded) {
        order.paymentStatus = 'refunded';
        // Put the order on hold so an operator reviews the fully-refunded order.
        // (Guarded so it degrades gracefully if the status was removed.)
        if (
          order.status !== ORDER_STATUS_ON_HOLD &&
          (!this.orderStatusRegistry || this.orderStatusRegistry.has(ORDER_STATUS_ON_HOLD))
        ) {
          orderStatusBefore = order.status;
          order.status = ORDER_STATUS_ON_HOLD as Order['status'];
          orderStatusAfter = order.status;
        }
      }

      await tx.flush();
      return {
        payment,
        changed,
        orderStatusBefore,
        orderStatusAfter,
        organizationId: order?.organizationId ?? null,
        salesChannelId: order?.salesChannelId ?? null,
      };
    });

    if (!result) return null;
    if (result.changed && this.events) {
      this.events.emit('payment.refunded.v1', {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        orderId: result.payment.orderId,
        paymentId: result.payment.id,
        refundedAmount: Number(result.payment.refundedAmount),
        currency: input.currency,
        fullyRefunded: input.fullyRefunded,
        externalRefundId: input.externalRefundId ?? null,
      });
      // Emit the templated order-status `.after` event for the refund → on_hold
      // transition so cross-module subscribers react (mirrors receive()).
      if (
        result.orderStatusBefore &&
        result.orderStatusAfter &&
        result.organizationId &&
        result.salesChannelId
      ) {
        this.orderStatusAnnounce.announceStatusChanged({
          orderId: result.payment.orderId,
          organizationId: result.organizationId,
          salesChannelId: result.salesChannelId,
          from: result.orderStatusBefore,
          to: result.orderStatusAfter,
          actor: { kind: 'system', source: 'payment' },
        });
      }
    }
    return { paymentId: result.payment.id, changed: result.changed };
  }

  private async resolvePaymentForRefund(
    tx: EntityManager,
    input: { paymentId?: string; orderId?: string; externalReference?: string },
  ): Promise<Payment | null> {
    if (input.paymentId) return tx.findOne(Payment, { id: input.paymentId });
    if (input.externalReference) {
      const byRef = await tx.findOne(Payment, { externalReference: input.externalReference });
      if (byRef) return byRef;
    }
    if (input.orderId) {
      // The settled payment for the order (most recent attempt).
      return tx.findOne(
        Payment,
        { orderId: input.orderId, status: { $in: ['paid', 'partially_refunded', 'refunded'] } },
        { orderBy: { attemptNo: 'desc' } },
      );
    }
    return null;
  }

  private async resolvePayment(
    tx: EntityManager,
    input: ReceivePayment,
  ): Promise<Payment | null> {
    if (input.paymentId) {
      return tx.findOne(Payment, { id: input.paymentId });
    }
    if (input.orderId && input.externalReference) {
      const byRef = await tx.findOne(Payment, {
        orderId: input.orderId,
        externalReference: input.externalReference,
      });
      if (byRef) return byRef;
      // Fall back to the most recent open attempt for the order.
      return tx.findOne(Payment, { orderId: input.orderId }, { orderBy: { attemptNo: 'desc' } });
    }
    return null;
  }

  private applyOrderStatus(order: Order, ref: string | undefined): void {
    if (!ref) return;
    if (this.orderStatusRegistry && !this.orderStatusRegistry.has(ref)) return;
    order.status = ref as Order['status'];
  }
}
