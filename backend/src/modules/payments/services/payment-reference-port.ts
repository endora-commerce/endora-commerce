import type { EntityManager } from '@mikro-orm/postgresql';
import type { PaymentReferencePort } from '@b2b/contracts';
import { Payment } from '../entities/payment.entity.js';

/**
 * The one write the four payment gateways make into this module's table
 * (feature 075, Phase P) — the write side of
 * `PaymentReadPort.findByExternalReference`.
 *
 * Each gateway opens its own provider object for an attempt (a Stripe
 * PaymentIntent or Checkout Session, a TPay transaction, a PayU order, an
 * Autopay transaction) and then records that object's identifier on the
 * attempt, so a later provider event carrying only the provider's reference
 * resolves back to a payment. Four modules were doing it with
 * `em.findOne(Payment, …)` and a field assignment, which is this module's row
 * being written by somebody else's `EntityManager`.
 *
 * It is deliberately not on the Command Bus, and the four call sites all say
 * why in their own words: this is provider-integration bookkeeping, not an
 * operator decision. The state change an operator is answerable for is the
 * settlement, and that is audited in the payments/orders flow.
 */
export class PaymentReferenceService implements PaymentReferencePort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async stampExternalReference(paymentId: string, externalReference: string): Promise<boolean> {
    // command-coverage-ignore: records the provider's own identifier for an
    // attempt so its later event resolves; provider-integration bookkeeping.
    return this.stamp(paymentId, externalReference, false);
  }

  async stampExternalReferenceIfAbsent(
    paymentId: string,
    externalReference: string,
  ): Promise<boolean> {
    // command-coverage-ignore: as above, for the gateway whose first reference
    // is the one its provider metadata was written against.
    return this.stamp(paymentId, externalReference, true);
  }

  private async stamp(
    paymentId: string,
    externalReference: string,
    onlyIfAbsent: boolean,
  ): Promise<boolean> {
    const em = this.emFactory();
    const payment = await em.findOne(Payment, { id: paymentId });
    if (!payment) return false;
    if (onlyIfAbsent && payment.externalReference) return false;
    if (payment.externalReference === externalReference) return false;
    payment.externalReference = externalReference;
    await em.flush();
    return true;
  }
}
