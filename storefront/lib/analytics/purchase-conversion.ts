import type { GaPurchase } from './ecommerce';

/**
 * Report an order's GA4 `purchase` conversion at most once (issue #277).
 *
 * `purchase-eligibility.ts` decides whether an order may be counted at all.
 * This decides whether it has been counted **already**, which is a different
 * question and one no page can answer on its own:
 *
 * - `/checkout/success` counts an offline placement, a Stripe or TPay hosted
 *   success and every inline `/checkout/pay` form that succeeds;
 *   `/orders/:id` counts a PayU or Autopay redirect return, a retried payment
 *   that finally landed, and a buyer who closed the tab and came back. Two
 *   surfaces, one conversion, and neither knows what the other did.
 * - The same buyer opens the same order again — from their order list, from a
 *   bookmarked `?payment=returned` link, from a second device. Every one of
 *   those is a page view; none of them is a second sale.
 *
 * So the claim is spent on the platform and this fires only on `true`. When
 * the claim call fails the answer is not to fire: a conversion the platform
 * never handed out is one it can still hand out on the next view, whereas an
 * invented one is in the report for good.
 */
export interface PurchaseReportInput {
  /** The order's UUID — the claim is keyed on it, not on the business id. */
  orderId: string;
  /** The GA4 payload, already checked for eligibility. */
  payload: GaPurchase;
  /** Spends the platform's claim: `true` exactly once per order. */
  claim: (orderId: string) => Promise<boolean>;
  /** Sends the conversion. */
  fire: (payload: GaPurchase) => void;
}

export async function reportPurchaseOnce({
  orderId,
  payload,
  claim,
  fire,
}: PurchaseReportInput): Promise<void> {
  let counted = false;
  try {
    counted = await claim(orderId);
  } catch {
    // The claim is still open, so the next view of this order reports it. This
    // catch is a storefront-to-backend call failing, not a module gate: there
    // is no `ModuleDisabledError` to swallow on this side of the API.
    return;
  }
  if (counted) fire(payload);
}
