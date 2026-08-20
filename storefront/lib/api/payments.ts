import { apiMutate } from './mutations';

/**
 * Buyer-facing payment bindings (issue #264).
 *
 * The one call here is "pay this order of mine again". Before it existed a
 * buyer whose payment did not go through had no supported way back: the
 * gateway URL is handed out once in the place-order response and never
 * persisted, `/checkout/pay` is linked only from the checkout submit action,
 * and `/checkout/failure` is the *placement* failure page — its "Try again"
 * returns to `/checkout`, which would place a second order for goods the first
 * one still holds.
 */

/** What the buyer should do next; mirrors `paymentRetryNextActionSchema`. */
export type PaymentRetryNextAction =
  | { kind: 'none' }
  | { kind: 'redirect'; url: string }
  | { kind: 'awaiting_transfer'; iban: string | null; reference: string };

export interface PaymentRetryResult {
  paymentId: string;
  attemptNo: number;
  /**
   * `true` when a new attempt was opened and its provider session started;
   * `false` when an attempt was already open, in which case no provider was
   * contacted and the buyer belongs on the existing payment step.
   */
  opened: boolean;
  nextAction: PaymentRetryNextAction;
}

export async function retryOrderPayment(
  sessionCookie: string,
  orderId: string,
): Promise<PaymentRetryResult> {
  const result = await apiMutate<PaymentRetryResult>({
    method: 'POST',
    path: `/api/v1/orders/${orderId}/payments/retry`,
    sessionCookie,
  });
  if (!result.data) {
    throw new Error('The payment retry returned no result.');
  }
  return result.data;
}
