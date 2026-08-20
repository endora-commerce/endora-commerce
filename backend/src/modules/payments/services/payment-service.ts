import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Payment } from '../entities/payment.entity.js';

/**
 * The two things "open a retry" can mean, kept apart because they are the
 * difference between contacting a provider and not (issue #264).
 *
 * `opened: true` is a new attempt row — the previous one had failed, so the
 * next `attemptNo` is the record a fresh provider session will settle.
 * `opened: false` is the attempt that was already open being handed back
 * unchanged: a second click, a reload, a buyer returning to a payment they
 * walked away from. The caller must not start a provider session for it.
 */
export interface OpenRetryResult {
  payment: Payment;
  opened: boolean;
}

/**
 * PaymentService (feature 034, FR-024) — opens retry Payments. The first
 * Payment of an order is created by OrderService.placeOrder; a retry opens a
 * new row against the same order with the next `attemptNo`, leaving prior
 * (failed) attempts intact so the admin can see the full history.
 *
 * **A fresh attempt row is what makes a gateway able to start over**
 * (issue #264), which is why the customer-facing retry runs through here rather
 * than re-driving the failed row. Every gateway keys its own object on this
 * platform's payment id: PayU sends it as `extOrderId`, which must be unique
 * per POS; TPay resolves the newest `tpay_transactions` row for the order;
 * Stripe records a `stripe_payment_intents` mapping per payment. Re-using the
 * failed attempt asks all four to open a second session against an identifier
 * they have already spent.
 */
export class PaymentService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * The next attempt for `orderId`, opening one only when the latest has
   * failed.
   *
   * The latest attempt is read `FOR UPDATE`, so two callers racing on the same
   * order serialise here and the second sees what the first wrote: a buyer
   * double-clicking gets one new attempt, not two. It is the same row the
   * settlement ingress resolves, so a retry and a late gateway callback cannot
   * interleave halfway through each other.
   */
  async openRetry(orderId: string): Promise<OpenRetryResult> {
    // command-coverage-ignore: opens a new payment attempt after a failure —
    // checkout retry mechanics; the order/payment status transition is audited in
    // the orders flow.
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const latest = await tx.findOne(
        Payment,
        { orderId },
        { orderBy: { attemptNo: 'desc' }, lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!latest) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'No payment exists for this order to retry.');
      }
      if (latest.status === 'paid') {
        throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'Order is already paid; nothing to retry.');
      }
      if (latest.status === 'refunded' || latest.status === 'partially_refunded') {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          'This payment has been refunded; it cannot be retried.',
        );
      }
      if (latest.status === 'deferred') {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          'This order is settled out of band; there is nothing to retry.',
        );
      }
      // Still open: hand back the attempt that exists rather than opening a
      // second one beside it. Two live attempts for one order is two provider
      // objects that can both settle.
      if (latest.status === 'awaiting_payment') {
        return { payment: latest, opened: false };
      }
      const next = tx.create(Payment, {
        orderId,
        paymentMethodId: latest.paymentMethodId,
        amount: latest.amount,
        currency: latest.currency,
        attemptNo: latest.attemptNo + 1,
      });
      await tx.persistAndFlush(next);
      return { payment: next, opened: true };
    });
  }

  /**
   * Close an attempt whose provider session could not be started.
   *
   * The compensating half of {@link openRetry}: the row is written before the
   * adapter is asked (the adapter needs its id), so an adapter that throws
   * would otherwise leave an `awaiting_payment` attempt no provider knows
   * about — and the next retry would *resume* that phantom instead of opening a
   * real one. Marking it failed puts the order back where the buyer can try
   * again.
   */
  async failAttempt(paymentId: string, reason: string): Promise<void> {
    // command-coverage-ignore: closes an attempt whose provider session never
    // started, so the buyer's next retry opens a real one — the same retry
    // mechanics `openRetry` above is exempted for.
    const em = this.emFactory();
    await em.transactional(async (tx) => {
      const payment = await tx.findOne(Payment, { id: paymentId });
      if (!payment || payment.status !== 'awaiting_payment') return;
      payment.status = 'failed';
      payment.failureReason = reason;
      await tx.flush();
    });
  }

  async listForOrder(orderId: string): Promise<Payment[]> {
    const em = this.emFactory();
    return em.find(Payment, { orderId }, { orderBy: { attemptNo: 'asc' } });
  }
}
