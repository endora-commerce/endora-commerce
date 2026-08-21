import type { EntityManager } from '@mikro-orm/postgresql';
import type { PaymentReadPort, PaymentRecord } from '@b2b/contracts';
import { Payment } from '../entities/payment.entity.js';

/**
 * The row-level read model `payments` publishes (feature 075, Phase P).
 *
 * Sixteen of this module's 35 inbound import sites are `em.findOne(Payment, …)`
 * — the same four lookups written out once per gateway, with each gateway
 * spelling "the latest attempt" slightly differently (`attemptNo` descending
 * in two, `createdAt` descending in the others). Publishing the read fixes
 * that ordering in one place: `attemptNo` first, `createdAt` as the tiebreak,
 * which is the ordering the attempt counter is maintained for.
 *
 * The money columns stay strings: they are `decimal(14,2)`, and every consumer
 * forwards the figure to a payment provider.
 *
 * `countByPaymentMethod` joined it for feature 075. It answers the one question
 * `payment_methods` had been asking of this module's table directly, in raw SQL
 * inside its delete Command — a boundary crossing that named no import
 * specifier and so compiled, returned rows and went unseen until
 * `check:module-boundary` learned to read a SQL statement.
 */
export class PaymentReadService implements PaymentReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<PaymentRecord | null> {
    const payment = await this.emFactory().findOne(Payment, { id });
    return payment ? toPaymentRecord(payment) : null;
  }

  async listByOrderId(orderId: string): Promise<PaymentRecord[]> {
    const payments = await this.emFactory().find(
      Payment,
      { orderId },
      { orderBy: { attemptNo: 'desc', createdAt: 'desc' } },
    );
    return payments.map(toPaymentRecord);
  }

  async findLatestForOrder(orderId: string): Promise<PaymentRecord | null> {
    const payment = await this.emFactory().findOne(
      Payment,
      { orderId },
      { orderBy: { attemptNo: 'desc', createdAt: 'desc' } },
    );
    return payment ? toPaymentRecord(payment) : null;
  }

  async findByExternalReference(externalReference: string): Promise<PaymentRecord | null> {
    const payment = await this.emFactory().findOne(
      Payment,
      { externalReference },
      { orderBy: { attemptNo: 'desc', createdAt: 'desc' } },
    );
    return payment ? toPaymentRecord(payment) : null;
  }

  async countByPaymentMethod(paymentMethodId: string): Promise<number> {
    return this.emFactory().count(Payment, { paymentMethodId });
  }
}

export function toPaymentRecord(payment: Payment): PaymentRecord {
  return {
    id: payment.id,
    orderId: payment.orderId,
    paymentMethodId: payment.paymentMethodId,
    status: payment.status,
    amount: payment.amount,
    refundedAmount: payment.refundedAmount,
    currency: payment.currency,
    paidAt: payment.paidAt ?? null,
    externalReference: payment.externalReference ?? null,
    providerDetails: payment.providerDetails ?? null,
    failureReason: payment.failureReason ?? null,
    attemptNo: payment.attemptNo,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}
