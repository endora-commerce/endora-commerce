import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * What order placement asks of a credit limit, typed by its owner (D-94.5).
 *
 * `orders` used to declare this interface itself, in `order-service.ts`, and
 * `CreditLimitService` satisfied it structurally. That is the shape D-77
 * rejected: `lazyPort<T>` is an unchecked cast, so with `T` on the consumer's
 * side **nothing verifies that the provider still satisfies it**. The
 * declaration lives here now, beside `CreditLimitService`, and `orders`
 * imports it as a type.
 *
 * It stays **out of `@endora-commerce/contracts`**: `reserve` takes the caller's MikroORM
 * `EntityManager`, and FR-034 forbids a MikroORM type there. That is the seam
 * rather than a defect in it. `reserve` holds a `PESSIMISTIC_WRITE` on the
 * organization's `credit_limits` row — or the owning ancestor's, taken with
 * `select … for update` — and the lock has to be held until the order commits;
 * a second transaction would leave credit consumed for a placement that then
 * rolled back. `credit_limit_reservations_order_fk`
 * (`credit_limit_reservations.order_id` -> `orders.id`, `on delete restrict`)
 * is what says so in the schema, so the import from `orders` is a
 * **permanent** cross-module ledger entry naming that constraint, not debt.
 */
export interface CreditLimitPort {
  /**
   * Reserve `amount` against the organization's available credit.
   *
   * `tx` is **required** (D-94.5). It has one caller, `placeOrder`, which
   * always passes its own `EntityManager`; the optional shape is what let the
   * same method double as a standalone transaction, and that is a lie about
   * the seam — the reservation is not separable from the placement it belongs
   * to.
   */
  reserve(input: {
    organizationId: string;
    orderId: string;
    amount: number;
    currency: string;
    tx: EntityManager;
  }): Promise<
    | { ok: true; reservationId: string; availableAmountAfter: number }
    | { ok: false; code: 'LIMIT_INSUFFICIENT'; availableAmount: number }
    | { ok: false; code: 'CREDIT_LIMIT_NOT_GRANTED' }
    | { ok: false; code: 'CURRENCY_MISMATCH' }
  >;
  /**
   * Release the reservation an order holds. Runs in its own transaction: the
   * order is committed by the time an invoice is paid, a cancellation lands or
   * an admin revokes.
   */
  releaseByOrder(input: {
    orderId: string;
    reason: 'invoice_paid' | 'order_cancelled' | 'admin_revocation';
  }): Promise<unknown>;
}
