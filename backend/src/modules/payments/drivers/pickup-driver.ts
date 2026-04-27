/**
 * Pickup driver (T140).
 *
 * Used when the buyer pays in cash on pickup. No external integration,
 * no `nextAction` for the storefront to navigate to — the order stays
 * `paymentStatus='awaiting_payment'` until staff settles it on receipt
 * via `POST /api/v1/admin/orders/:id/payment-status`.
 *
 * Captured here so the spec's `payments/drivers/*-driver.ts` layout
 * exists; the order-service dispatch refactor that consumes the driver
 * registry is a separate slice.
 */

export interface PickupReserveResult {
  paymentRef: null;
  nextAction: { kind: 'none' };
}

export class PickupDriver {
  readonly kind = 'pickup' as const;

  reserve(): PickupReserveResult {
    return { paymentRef: null, nextAction: { kind: 'none' } };
  }
}
