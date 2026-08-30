import {
  ERROR_CODES,
  type CustomerAccountReadPort,
  type OrderPaymentStatus,
  type OrderReadPort,
  type OrderTransitionPort,
  type PaymentAdapterRegistryPort,
  type PaymentRetryNextAction,
  type PaymentRetryResult,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { paymentsErrorCodes } from '../../manifest.js';
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
 * The refusals below take **two** terms: the payment axis — is this order paid,
 * is there an attempt, has it failed — and, since feature 085's Phase D,
 * whether the order's lifecycle status is terminal.
 *
 * Reading the lifecycle at all used to be unsafe: every payment method in the
 * tree was seeded
 * `status_on_failure = 'cancelled'`, so the settlement ingress made an order
 * terminal on the first decline and reading `order.status` would have refused
 * exactly the buyers this exists for. Feature 085 answered the product question
 * behind it — a declined payment now holds the order at the method's failure
 * status, seeded `on_hold`, and records the decline on the money axis as
 * `paymentStatus = 'failed'`. So a declined order is no longer terminal, and
 * the cost this doc block used to state — that a hand-cancelled order was
 * indistinguishable from an ingress-cancelled one — is retired with it: the
 * ingress cancels nothing.
 *
 * The money term is an **allow-list of two**, `awaiting_payment` and `failed`,
 * and not a negation of `paid`. `deferred` is a credit-limit order whose credit
 * was drawn inside the placement transaction — the shop is already acting on
 * it, and there is no buyer-initiated session to open — and `refunded` is
 * settled in the other direction.
 *
 * The lifecycle term is **terminality, not the string `cancelled`**. The status
 * set is operator-configurable and a deployment may add terminal statuses of
 * its own, so the question goes to the graph through
 * `orderTransitionPort.isTerminal`. And the reason it is asked at all is Phase
 * D's: the ingress no longer writes a terminal status, so a terminal order is
 * always a deliberate human decision — an administrator's, or the buyer's own —
 * and paying it again would silently override the person who made it, on stock
 * the cancellation has already released.
 */
/**
 * The payment states in which the buyer still owes this money themselves
 * (feature 085, R13's money term).
 *
 * An allow-list rather than `!== 'paid'`: `deferred` is a credit-limit order,
 * unpaid by arrangement and already drawn, and `refunded` is settled the other
 * way. Both would pass a negation and neither has a session for the buyer to
 * open.
 */
const BUYER_STILL_OWES: ReadonlySet<OrderPaymentStatus> = new Set<OrderPaymentStatus>([
  'awaiting_payment',
  'failed',
]);

export interface PaymentRetryDeps {
  orderRead: OrderReadPort;
  customerAccountRead: CustomerAccountReadPort;
  paymentService: PaymentService;
  /**
   * The lifecycle read, for the terminality term. `orders` owns the graph and
   * the graph is what decides which statuses are ends — this module may not
   * name one.
   */
  orderTransition: OrderTransitionPort;
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
   * @throws 409 `PAYMENT_NOT_DUE` when the money is not the buyer's to pay —
   *         the order is paid, drawn against a credit limit, or refunded.
   * @throws 409 `PAYMENT_ORDER_CLOSED` when the order's lifecycle status is
   *         terminal. A different condition and so a different code: the money
   *         may well still be owed, but the order it was owed on is over.
   * @throws 409 `PAYMENT_ADAPTER_UNAVAILABLE` when the method the order was
   *         placed with has no adapter registered any more. A third condition,
   *         and the only one that is about the shop rather than the order.
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
    if (!BUYER_STILL_OWES.has(order.paymentStatus)) {
      // The money term, and one code for all three of the statuses it refuses
      // (`paid`, `deferred`, `refunded`): one predicate, one `throw`, one
      // sentence the buyer reads either way.
      //
      // It answered `VALIDATION_FAILED`, which is worse than an untidy code —
      // that is the one code `localizeErrorEnvelope` returns *before*
      // translating (`@endora-commerce/platform/http`), because the code is
      // overloaded and several services carry machine-readable tokens in its
      // message. So a buyer read the English written here whatever language
      // they asked for. The message below is now the raise-site fallback the
      // envelope substitutes, reached only when no bundle answers.
      throw new HttpError(
        409,
        paymentsErrorCodes.PAYMENT_NOT_DUE,
        'This order is not awaiting payment.',
      );
    }
    // The lifecycle term (feature 085 Phase D). Asked of the graph, because the
    // terminal set is operator-configurable — and asked after the money term so
    // the two refusals stay in the order the buyer's own page explains them in.
    // `null` is "no such order", which the read above says otherwise; it means
    // the order was deleted between the two reads, and the attempt this would
    // open is the one that then answers.
    if ((await this.deps.orderTransition.isTerminal(order.id)) === true) {
      // A second code rather than the money term's, because the two terms are
      // orthogonal and so are the buyer's answers to them: `PAYMENT_NOT_DUE`
      // says there is nothing to pay, this says the order is over and the
      // stock its cancellation released is somebody else's now. A buyer who
      // still wants the goods places a new order; a buyer told the other
      // sentence does nothing at all.
      throw new HttpError(
        409,
        paymentsErrorCodes.PAYMENT_ORDER_CLOSED,
        'This order is closed and can no longer be paid.',
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
      // The third code, and the one refusal here that is not about the order:
      // it is open, the money is still owed, and the platform cannot start a
      // session because the adapter the method names is not registered any
      // more. The buyer's move is to ask the shop, and the shop's is to repair
      // a configuration — neither of the other two sentences says that.
      throw new HttpError(
        409,
        paymentsErrorCodes.PAYMENT_ADAPTER_UNAVAILABLE,
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
