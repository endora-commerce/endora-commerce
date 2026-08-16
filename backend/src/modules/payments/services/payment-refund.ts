import type { EntityManager } from '@mikro-orm/postgresql';
import { Order } from '../../orders/entities/order.entity.js';
import type {
  PaymentRefundInput,
  PaymentRefundPort,
  PaymentRefundResult,
} from '../../returns/ports/payment-refund.port.js';
import { PaymentMethod } from '../../payment_methods/entities/payment-method.entity.js';
import { gatewayRefundRegistry } from './registry-singleton.js';

/**
 * Payments-side implementation of the returns module's `PaymentRefundPort`
 * (feature 046, R5).
 *
 * Gateway payments (`kind === 'gateway'`) are delegated to the PSP handler
 * registered under the **order's** payment adapter (snapshot / order method).
 * The settlement form's `refundPaymentMethodId` is ledger metadata only — it
 * must not pick which PSP to call (otherwise Autopay orders refunded under a
 * bank-transfer method never hit Autopay).
 *
 * Offline methods (bank transfer, credit limit, pickup) are recorded as
 * `issued` — the operator performs the actual transfer.
 */
export class PaymentRefundProvider implements PaymentRefundPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async refund(input: PaymentRefundInput): Promise<PaymentRefundResult> {
    const em = this.emFactory();
    const order = await em.findOne(Order, { id: input.orderId });
    const kind = order?.paymentMethodSnapshot?.kind;
    if (kind === 'gateway') {
      const adapterKey = await this.resolveOrderAdapterKey(em, order, input.paymentMethodId);
      const handler = gatewayRefundRegistry.resolve(adapterKey);
      if (handler) {
        return handler.refund(input);
      }
      // Two different situations, and one sentence for each. The registry skips
      // a handler whose module is switched off (feature 074), so a refund that
      // would have gone through a PSP is recorded for a person to settle
      // instead — and the operator needs to be told which module, because
      // switching it back on is the whole remedy. `ownerOf` is presence-blind
      // for exactly this: it still names the contributor.
      const absentOwner = adapterKey === null ? null : gatewayRefundRegistry.ownerOf(adapterKey);
      return {
        state: 'pending_manual',
        failureReason:
          absentOwner === null
            ? 'Gateway refunds require a PSP refund integration.'
            : `The "${absentOwner}" module is switched off, so its gateway refund was not sent.`,
      };
    }
    return { state: 'issued', externalReference: input.idempotencyKey };
  }

  /**
   * Prefer the adapter the order was placed with (snapshot), then the order's
   * payment method row. Do not use the settlement refund-method id for PSP
   * resolution when the order snapshot already names an adapter.
   */
  private async resolveOrderAdapterKey(
    em: EntityManager,
    order: Order | null,
    settlementPaymentMethodId: string | undefined,
  ): Promise<string | null> {
    const fromSnapshot = order?.paymentMethodSnapshot?.adapter?.trim();
    if (fromSnapshot) return fromSnapshot;

    if (order?.paymentMethodId) {
      const method = await em.findOne(PaymentMethod, { id: order.paymentMethodId });
      if (method?.adapter) return method.adapter;
    }

    // Last resort: settlement form method (legacy callers / missing snapshot).
    if (settlementPaymentMethodId) {
      const method = await em.findOne(PaymentMethod, { id: settlementPaymentMethodId });
      return method?.adapter ?? null;
    }
    return null;
  }
}
