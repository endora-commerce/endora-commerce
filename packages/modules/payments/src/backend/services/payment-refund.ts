import type {
  OrderReadPort,
  OrderRecord,
  PaymentMethodReadPort,
  PaymentRefundInput,
  PaymentRefundPort,
  PaymentRefundResult,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
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
 *
 * **A gateway the operator switched off is refused, not recorded (D-71).**
 * `gatewayRefundRegistry` skips an absent owner's handler, and this provider
 * used to answer the resulting gap with `pending_manual`. Every layer above
 * reads that as *settled*: `ReturnSettlementService` goes on to resolve the
 * case, write the `Refund` row, issue the corrective invoice and mail the
 * customer, and the admin's settlement card branches on `'failed'` only, so the
 * operator is told "Settled." while no money has moved and the PSP was never
 * called. Nothing in the execution path was missing a presence probe — the
 * probe was right and the *outcome* was wrong.
 *
 * So the refusal is a {@link ModuleDisabledError}: the same 503 envelope, with
 * the same `Retry-After`, that any other call into a switched-off module
 * produces. It leaves the case exactly where it was, which is the truthful
 * state, and it names the module — switching it back on is the whole remedy.
 *
 * `pending_manual` stays, and keeping the two apart is the point: a deployment
 * that never installed a PSP integration is not in a temporary state and has
 * nothing to switch on, so its refunds belong on the platform's books for a
 * person to settle.
 */
export class PaymentRefundProvider implements PaymentRefundPort {
  /**
   * Feature 075 Phase C — both reads are somebody else's, both are reads, and
   * neither is inside a transaction this class opens: the order comes from
   * `orderReadPort` and the payment method from `paymentMethodReadPort`. They
   * fail closed, which is the same answer D-71 already reaches for a
   * switched-off gateway and for the same reason — resolving a refund against
   * data the platform will not read is worse than refusing it.
   */
  constructor(
    private readonly orderRead: OrderReadPort,
    private readonly paymentMethodRead: PaymentMethodReadPort,
  ) {}

  async refund(input: PaymentRefundInput): Promise<PaymentRefundResult> {
    const order = await this.orderRead.findById(input.orderId);
    const kind = order?.paymentMethodSnapshot?.kind;
    if (kind === 'gateway') {
      const adapterKey = await this.resolveOrderAdapterKey(order, input.paymentMethodId);
      const handler = gatewayRefundRegistry.resolve(adapterKey);
      if (handler) {
        return handler.refund(input);
      }
      // Two different situations behind one empty `resolve`, and only one of
      // them is an outcome. A gateway whose module is switched off is a
      // capability that is supposed to be here: refuse, so nothing downstream
      // resolves the case, issues a correction or mails the customer over a
      // refund that did not happen (D-71). `absentOwnerFor` is presence-blind
      // for exactly this — it still names the contributor.
      const absentOwner = gatewayRefundRegistry.absentOwnerFor(adapterKey);
      if (absentOwner !== null) throw new ModuleDisabledError(absentOwner);
      // Nobody ever registered a handler for this adapter: there is no module
      // to switch on, so the refund goes on the platform's books, named, for a
      // person to settle.
      return {
        state: 'pending_manual',
        failureReason: 'Gateway refunds require a PSP refund integration.',
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
    order: OrderRecord | null,
    settlementPaymentMethodId: string | undefined,
  ): Promise<string | null> {
    const fromSnapshot = order?.paymentMethodSnapshot?.adapter?.trim();
    if (fromSnapshot) return fromSnapshot;

    if (order?.paymentMethodId) {
      const method = await this.paymentMethodRead.findById(order.paymentMethodId);
      if (method?.adapter) return method.adapter;
    }

    // Last resort: settlement form method (legacy callers / missing snapshot).
    if (settlementPaymentMethodId) {
      const method = await this.paymentMethodRead.findById(settlementPaymentMethodId);
      return method?.adapter ?? null;
    }
    return null;
  }
}
