import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type ReceivePayment } from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Payment } from '../entities/payment.entity.js';
import { Order } from '../../orders/entities/order.entity.js';
import { emitOrderStatusAfter } from '../../orders/events/order-status-events.js';
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
