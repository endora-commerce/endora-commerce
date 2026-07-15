import type { EntityManager } from '@mikro-orm/postgresql';
import { Order } from '../../orders/entities/order.entity.js';
import type {
  PaymentRefundInput,
  PaymentRefundPort,
  PaymentRefundResult,
} from '../../returns/ports/payment-refund.port.js';
import { PaymentMethod } from '../../payment_methods/entities/payment-method.entity.js';
import { gatewayRefundRegistry } from './gateway-refund-registry.js';

/**
 * Payments-side implementation of the returns module's `PaymentRefundPort`
 * (feature 046, R5).
 *
 * MVP behaviour: gateway payments require a PSP refund integration that does not
 * exist yet, so they are reported `pending_manual`. Offline methods
 * (bank transfer, credit limit, pickup) are recorded as `issued` — the operator
 * performs the actual transfer and the returns ledger captures it. A future
 * adapter-driven `initiateRefund` capability slots in behind this same
 * interface without changing the returns module.
 */
export class PaymentRefundProvider implements PaymentRefundPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async refund(input: PaymentRefundInput): Promise<PaymentRefundResult> {
    const em = this.emFactory();
    const order = await em.findOne(Order, { id: input.orderId });
    const kind = order?.paymentMethodSnapshot?.kind;
    if (kind === 'gateway') {
      // Feature 049 — delegate to the registered gateway refund handler (e.g.
      // Stripe). The handler is resolved by the order's payment-method adapter
      // when known; otherwise the sole registered gateway handler is used.
      const adapterKey =
        input.paymentMethodId != null
          ? (await em.findOne(PaymentMethod, { id: input.paymentMethodId }))?.adapter ?? null
          : null;
      const handler = gatewayRefundRegistry.resolve(adapterKey);
      if (handler) {
        return handler.refund(input);
      }
      return {
        state: 'pending_manual',
        failureReason: 'Gateway refunds require a PSP refund integration.',
      };
    }
    return { state: 'issued', externalReference: input.idempotencyKey };
  }
}
