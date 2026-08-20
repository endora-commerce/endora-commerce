import {
  ERROR_CODES,
  type CustomerAccountReadPort,
  type OrderReadPort,
  type PaymentAdapterRegistryPort,
  type PaymentRetryNextAction,
  type PaymentRetryResult,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import type { PaymentService } from './payment-service.js';

/**
 * A buyer paying an order of theirs again after the first attempt did not go
 * through (issue #264).
 *
 * Before this existed there was no supported path at all. `/checkout/pay?id=…`
 * is linked from the checkout submit action and from nowhere else, so a buyer
 * whose card was declined had the page in their history or nothing; and going
 * back through `/checkout` would have placed a **second** order for goods the
 * first one still has allocated. The four redirect-mode gateways had not even
 * that: the gateway URL is returned once, in the place-order response's
 * `nextAction`, which is a virtual column and is never persisted.
 *
 * ### What this decides on, and what it deliberately does not
 *
 * The refusals below are all on the **payment** axis — is this order paid, is
 * there an attempt, has it failed. The order's *lifecycle* status is not
 * consulted, and that is a decision rather than an oversight: every payment
 * method in the tree is seeded with `status_on_failure = 'cancelled'`
 * (`payment_methods/migrations/20260611T140353_…`, and the four gateway seed
 * migrations repeat it), so the settlement ingress moves an order to
 * `cancelled` on the first decline. Reading `order.status` here would therefore
 * refuse exactly the buyers this exists for. Whether a declined card should
 * cancel an order at all is a product question that outlives this seam — it is
 * recorded in the merge request rather than answered here, because changing a
 * seeded status is a migration and an owner's call.
 *
 * The cost of that choice is stated plainly: an order an operator cancelled
 * *by hand* while its payment was still open is not distinguishable here from
 * one the ingress cancelled, because both write the bare status code. What
 * protects the first case is that a hand-cancelled order's latest attempt is
 * still `awaiting_payment`, so this path resumes rather than opens — no new
 * provider session is created for it, and no money can be taken that the buyer
 * did not initiate from the payment step itself.
 */
export interface PaymentRetryDeps {
  orderRead: OrderReadPort;
  customerAccountRead: CustomerAccountReadPort;
  paymentService: PaymentService;
  /**
   * Read per call rather than captured: the registry is contributed at boot by
   * whichever gateway modules are present, and an operator can switch one off
   * between two requests.
   */
  paymentAdapterRegistry: () => PaymentAdapterRegistryPort;
  assertOrganizationCanTransact: (organizationId: string) => Promise<void>;
}

export class PaymentRetryService {
  constructor(private readonly deps: PaymentRetryDeps) {}

  /**
   * Open (or resume) the buyer's own next payment attempt for `orderId`.
   *
   * @throws 404 when the order does not exist or carries no payment attempt.
   * @throws 403 when the caller did not place the order.
   * @throws 409 when the order is already settled, or when the method it was
   *         placed with has no adapter registered any more.
   * @throws whatever `assertOrganizationCanTransact` throws for a suspended or
   *         blocked organisation — the route maps it, exactly as placement does.
   */
  async retryForCustomer(input: {
    orderId: string;
    customerAccountId: string;
  }): Promise<PaymentRetryResult> {
    const order = await this.deps.orderRead.findById(input.orderId);
    if (!order) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
    }
    // Ownership before anything else: keyed on an order id, this route is an
    // enumeration surface until it has answered "is this yours?".
    if (order.placedByCustomerAccountId !== input.customerAccountId) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'This order does not belong to you.');
    }
    if (order.paymentStatus !== 'awaiting_payment') {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'This order is not awaiting payment.',
      );
    }
    await this.deps.assertOrganizationCanTransact(order.organizationId);

    const { payment, opened } = await this.deps.paymentService.openRetry(order.id);
    if (!opened) {
      // An attempt is already open. Contacting the provider again would be a
      // second object against one attempt — see `PaymentRetryResult`.
      return {
        paymentId: payment.id,
        attemptNo: payment.attemptNo,
        opened: false,
        nextAction: { kind: 'none' },
      };
    }

    const adapterKey = order.paymentMethodSnapshot.adapter;
    const adapter = adapterKey ? this.deps.paymentAdapterRegistry().get(adapterKey) : undefined;
    if (!adapter) {
      await this.deps.paymentService.failAttempt(
        payment.id,
        'No payment adapter is available for this order.',
      );
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'The payment method this order was placed with is no longer available.',
      );
    }

    const buyer = await this.deps.customerAccountRead.findById(order.placedByCustomerAccountId);
    const payerName =
      [buyer?.firstName, buyer?.lastName].filter(Boolean).join(' ').trim() ||
      order.billingAddress.recipientName ||
      buyer?.email ||
      null;

    let started: PaymentRetryNextAction;
    try {
      const result = await adapter.onStorefrontOrderCreated({
        orderId: order.id,
        paymentId: payment.id,
        amount: Number(payment.amount),
        currency: payment.currency,
        paymentMethodCode: order.paymentMethodSnapshot.code,
        paymentMethodId: order.paymentMethodId,
        salesChannelId: order.salesChannelId,
        payerEmail: buyer?.email ?? null,
        payerName,
        billingCountry: order.billingAddress.country ?? null,
        orderBusinessId: order.businessId,
      });
      started = result;
    } catch (error) {
      // A narrow, compensating tolerance, and the one shape the checklist
      // endorses: the attempt row is written before the adapter can be asked
      // (it needs the id), so an adapter that refuses must not leave an open
      // attempt no provider knows about — the buyer's next click would resume
      // that phantom instead of opening a real attempt. The failure is
      // re-thrown; only the row is repaired.
      rethrowIfModuleDisabled(error);
      await this.deps.paymentService.failAttempt(
        payment.id,
        error instanceof Error ? error.message : 'The payment could not be started.',
      );
      throw error;
    }

    return {
      paymentId: payment.id,
      attemptNo: payment.attemptNo,
      opened: true,
      nextAction: started,
    };
  }
}
