import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type ReceivePayment } from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Payment } from '../entities/payment.entity.js';
import { Order } from '../../orders/entities/order.entity.js';
import { emitOrderStatusAfter } from '../../orders/events/order-status-events.js';
import { ORDER_STATUS_ON_HOLD } from '../../orders/domain/order-status-graph.js';
import { PaymentMethod } from '../../payment_methods/entities/payment-method.entity.js';
import type { OrderStatusRegistry } from '../../payment_methods/services/order-status-registry.port.js';

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
    private readonly orderStatusRegistry?: OrderStatusRegistry,
    private readonly events?: PaymentEventBus,
  ) {}

  async receive(input: ReceivePayment): Promise<ReceivePaymentResult> {
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
      const method = await tx.findOne(PaymentMethod, { id: payment.paymentMethodId });
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
        if (order) this.applyOrderStatus(order, method?.statusOnFailure);
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
        emitOrderStatusAfter(this.events as unknown as EventBus, {
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
        emitOrderStatusAfter(this.events as unknown as EventBus, {
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
