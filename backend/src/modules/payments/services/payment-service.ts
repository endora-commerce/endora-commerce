import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Payment } from '../entities/payment.entity.js';

/**
 * PaymentService (feature 034, FR-024) — opens retry Payments. The first
 * Payment of an order is created by OrderService.placeOrder; a retry opens a
 * new row against the same order with the next `attemptNo`, leaving prior
 * (failed) attempts intact so the admin can see the full history.
 */
export class PaymentService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async openRetry(orderId: string): Promise<Payment> {
    // command-coverage-ignore: opens a new payment attempt after a failure —
    // checkout retry mechanics; the order/payment status transition is audited in
    // the orders flow.
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const latest = await tx.findOne(
        Payment,
        { orderId },
        { orderBy: { attemptNo: 'desc' } },
      );
      if (!latest) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'No payment exists for this order to retry.');
      }
      if (latest.status === 'paid') {
        throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'Order is already paid; nothing to retry.');
      }
      const next = tx.create(Payment, {
        orderId,
        paymentMethodId: latest.paymentMethodId,
        amount: latest.amount,
        currency: latest.currency,
        attemptNo: latest.attemptNo + 1,
      });
      await tx.persistAndFlush(next);
      return next;
    });
  }

  async listForOrder(orderId: string): Promise<Payment[]> {
    const em = this.emFactory();
    return em.find(Payment, { orderId }, { orderBy: { attemptNo: 'asc' } });
  }
}
