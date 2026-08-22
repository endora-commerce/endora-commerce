import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, ORDER_STATUS_ON_HOLD, type ReceivePayment } from '@endora-commerce/contracts';
import type {
  OrderTransitionOutcome,
  OrderTransitionPort,
  PaymentMethodReadPort,
} from '@endora-commerce/contracts';
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
 * order's `paymentStatus` in one `em.transactional`, and either both land or
 * neither does. D-78 rules that such a seam keeps the caller's `EntityManager`
 * and is *declared* — `orders` is in this module's manifest `dependencies` (the
 * FK already required it), the ledger entry names the constraint, and this
 * comment says which transaction the write runs in.
 *
 * **The lifecycle half of that seam is gone since feature 085 Phase D**, and
 * the ruling is unaffected by its going. `order.status` was written here too,
 * on the same `tx` — a *transition*, with a graph, guards, an audit entry and
 * side-effects, none of which a column assignment performs. It moved to
 * `orderTransitionPort`, called after this transaction has committed. What is
 * left in the transaction is the money axis, `order.paymentStatus`, which is
 * the column `payments_order_fk` genuinely holds together with the payment row.
 *
 * **It is the only import left, and the other two went because their blocker
 * did.** They were held open by a sentence that had stopped being true: that
 * `stripe`, `payu`, `tpay` and `autopay` each construct this handler
 * themselves, so its constructor could not take a port none of them can build.
 * All four resolve `receivePaymentPort` today and the one construction left is
 * in `payments/backend.ts`, where `ctx` is in hand — so the payment-method read
 * is `paymentMethodReadPort` and the lifecycle write is `orderTransitionPort`.
 * Neither shares the constraint above: the method read is a read of a row this
 * transaction never writes (no FK obliges it to be co-transactional, and the
 * identical read is a port in `shipments`' twin handler), and the transition
 * runs **after** the commit, for the reason the port's own contract gives.
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
  /**
   * Where the order stands once the ingress is done with it, which since
   * feature 085 Phase D is the lifecycle's answer rather than this handler's:
   * the target the method configured when the graph permitted it, the order's
   * unchanged status when it did not, and `null` when the ingress asked for no
   * move at all (a repeated settlement, or a method with no status configured).
   */
  orderStatus: string | null;
  idempotent: boolean;
}

/**
 * The one message this handler logs, as little of a logger as it needs.
 *
 * `ctx.log` satisfies it structurally, so `payments/backend.ts` passes the
 * module's own logger and a test passes a recorder. Declared here rather than
 * imported so the handler carries no opinion about who is logging — the same
 * shape `GatewayRefundRegistry` takes for its collision warning.
 */
export interface SettlementLogger {
  warn(details: object, message: string): void;
}

/**
 * What asked for a transition, so a refused one names its own origin in the
 * log. The first two are the payment method's operator-configurable settings;
 * the third is this module's own rule that a fully refunded order is held for
 * review, which no setting governs.
 */
type TransitionTrigger = 'status_on_success' | 'status_on_failure' | 'full_refund';

/**
 * ReceivePaymentHandler (feature 034, FR-022/FR-023/FR-025).
 *
 * Resolves a Payment from the ingress payload, applies the outcome, and asks
 * the order lifecycle for the move the method's `statusOnSuccess` /
 * `statusOnFailure` names. Idempotent: a success after a terminal `paid` is a
 * no-op; a failure after `paid` is rejected (no downgrade). Resolves a late
 * event even when the adapter has since been de-registered (it keys on the
 * persisted Payment, not the live registry).
 *
 * **The lifecycle answers; this handler does not decide** (feature 085 Phase
 * D). It used to assign `order.status` after asking an `OrderStatusRegistry`
 * whether the code existed, which is a different question from whether the
 * order may go there — so the ingress wrote transitions the configured graph
 * forbids, on the happy path, while an operator making the same move by hand
 * was refused. Existence is now the port's `unknown_status` answer and
 * reachability its `not_permitted` one, and both leave the order where it is.
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
     * The lifecycle write (feature 085 Phase D). It validates against the
     * configured graph, runs the veto guards, records the audit entry and
     * applies the status's side-effects — the five things the assignment this
     * replaced did none of, which is why a payment-driven cancellation used to
     * leave the order's stock allocated forever and audited nowhere.
     *
     * **Called after this handler's transaction has committed**, never inside
     * it: the port takes its own `EntityManager`, so a call from inside would
     * write the order on a different pooled connection whose commit the
     * enclosing rollback cannot reach (issue #200). The port's own doc block
     * states the obligation.
     *
     * It announces the change too — `OrderTransitionService` emits the
     * templated `order.status.*.after` events itself — so this handler no
     * longer resolves `orderStatusAnnouncePort`. Doing both would emit every
     * payment-driven status change twice.
     */
    private readonly orderTransition: OrderTransitionPort,
    /** Where a refused transition is recorded; see {@link SettlementLogger}. */
    private readonly log: SettlementLogger,
    private readonly events?: PaymentEventBus,
  ) {}

  async receive(input: ReceivePayment): Promise<ReceivePaymentResult> {
    // command-coverage-ignore: provider payment-event ingestion — stamps the
    // attempt result on the Payment row and the order's payment status, then
    // asks `orderTransitionPort` for the lifecycle move, which records the
    // `order.status_transition` audit entry co-transactionally with the status
    // write it performs. The reason on this marker used to claim that audit
    // while the handler assigned `order.status` itself and reached the orders
    // flow at no point (feature 085, R3); Phase D made the claim true by
    // routing the move through the seam that carries it.
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
        return {
          payment,
          orderStatus: null as string | null,
          idempotent: true,
          emit: false,
          transition: null as { to: string; setting: TransitionTrigger } | null,
        };
      }

      const order = await tx.findOne(Order, { id: payment.orderId });
      const method = await this.paymentMethodRead.findById(payment.paymentMethodId);
      let transition: { to: string; setting: TransitionTrigger } | null = null;

      if (input.outcome === 'success') {
        payment.status = 'paid';
        payment.paidAt = new Date();
        if (input.externalReference !== undefined) {
          payment.externalReference = input.externalReference ?? null;
        }
        if (input.providerDetails) payment.providerDetails = input.providerDetails;
        if (order) order.paymentStatus = 'paid';
        if (method?.statusOnSuccess) {
          transition = { to: method.statusOnSuccess, setting: 'status_on_success' };
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
        }
        if (method?.statusOnFailure) {
          transition = { to: method.statusOnFailure, setting: 'status_on_failure' };
        }
      }

      await tx.flush();
      return {
        payment,
        orderStatus: order?.status ?? null,
        idempotent: false,
        emit: true,
        adapter: method?.adapter ?? payment.paymentMethodId,
        transition,
      };
    });

    /**
     * After the commit, never inside the transaction above (feature 085 R4).
     *
     * `OrderTransitionService` obtains its own `EntityManager`, so a call from
     * inside `em.transactional` would write the order on a second pooled
     * connection that commits on its own — the shape `check:transaction-context`
     * refuses. The asymmetry of putting it here is deliberate and lands on the
     * safe side: a crash between the commit and this line leaves the payment
     * recorded and the lifecycle unmoved, which the buyer retries, where the
     * opposite ordering would hold an order against a payment nobody recorded.
     */
    const orderStatus = result.transition
      ? await this.moveOrder(
          result.payment.orderId,
          result.transition.to,
          result.transition.setting,
          result.orderStatus,
          input.outcome === 'failure' ? (input.failureReason ?? null) : null,
        )
      : result.orderStatus;

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

      // The templated `order.status.*.after` events (feature 038, T026) are no
      // longer emitted from here: `OrderTransitionService` emits them itself,
      // for the transition it applied, with the same actor and the order's
      // business id besides. Announcing again would double every subscriber's
      // reaction to a payment-driven status change.
    }

    return {
      paymentId: result.payment.id,
      status: result.payment.status,
      orderStatus,
      idempotent: result.idempotent,
    };
  }

  /**
   * Ask the lifecycle for the move the configured setting names, and answer
   * where the order ended up.
   *
   * Every refusal is a 200 for the provider (contract §"What the caller does
   * with each outcome"): a PSP retries a non-2xx callback indefinitely, and an
   * order an operator has already advanced past payment must not be dragged
   * backwards because a delayed webhook arrived. So the refusal is recorded
   * here and the settlement stands.
   *
   * There is deliberately no `catch`. A `ModuleDisabledError` out of the port's
   * gate is not a refusal — it is the owner being absent — and swallowing it
   * would turn fail-closed into fail-open.
   */
  private async moveOrder(
    orderId: string,
    to: string,
    setting: TransitionTrigger,
    statusBefore: string | null,
    reason: string | null,
  ): Promise<string | null> {
    const outcome: OrderTransitionOutcome = await this.orderTransition.applyStatus({
      orderId,
      to,
      actor: { kind: 'system', source: 'payment' },
      reason,
    });

    if (outcome.applied) return outcome.to;
    // A second declined attempt on an order already at the failure status: the
    // attempt is recorded, nothing moved, and nothing needs saying (FR-006).
    if (outcome.reason === 'already_there') return outcome.from;

    this.log.warn(
      {
        orderId,
        from: outcome.from,
        to,
        setting,
        refusal: outcome.reason,
        detail: outcome.detail,
      },
      'payments: the requested order status was not applied; the order keeps the one it has',
    );
    return outcome.from ?? statusBefore;
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
      // Only a full refund flips the order's payment status; a partial refund is
      // tracked on the payment while the order stays 'paid'.
      const holdsTheOrder = Boolean(order) && input.fullyRefunded;
      if (order && input.fullyRefunded) order.paymentStatus = 'refunded';

      await tx.flush();
      return { payment, changed, holdsTheOrder };
    });

    if (!result) return null;

    /**
     * The hold goes through the lifecycle too, after the commit, for the same
     * reason `receive()` does (feature 085 Phase D). This was the third of the
     * three sites that assigned `order.status` directly, and it is the one an
     * operator is most likely to meet: a fully refunded order held for review
     * whose stock nothing had released.
     *
     * Asked on every full refund rather than only on a *changed* one, as the
     * assignment it replaces was: a re-delivered webhook finds the order
     * already on hold and the port answers `already_there`, which writes no
     * second audit entry and emits no second event.
     */
    if (result.holdsTheOrder) {
      await this.moveOrder(
        result.payment.orderId,
        ORDER_STATUS_ON_HOLD,
        'status_on_failure',
        null,
        'Fully refunded; held for operator review.',
      );
    }

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
}
