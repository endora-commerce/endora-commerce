/**
 * The port interfaces `payments` publishes whose signature carries a MikroORM
 * `EntityManager`, and **nothing that exists at runtime** (feature 080, T048;
 * D-169, D-171, D-179).
 *
 * `tsc` compiles this file to `export {};`. That is the property D-171 makes
 * the boundary decision on — *a subpath is contract surface iff the module it
 * resolves to exports no runtime binding* — and it is why this declaration has
 * its own file rather than sitting on top of a service module, which exports
 * the class beside it. A consumer naming that file names the owner's
 * implementation, whatever `import type` erases; a consumer naming this one
 * names a declaration and can name nothing else.
 *
 * **This is not yet a supported specifier and the ledger still counts it.**
 * `payments` is not a workspace package, so there is no `exports` map for this
 * to be a subpath of, and `check:module-boundary` reads `orders`' relative
 * import exactly as it read the entity import it replaces — D-171 says so in as
 * many words: `resolveModulePackage` returns `null` for any specifier starting
 * with `.`, so an unconverted reach has no subpath for the exemption to apply
 * to, and reaching the exempt state takes three separable edits (package the
 * owner, publish the interface, rewrite the specifier). This file is the second
 * of those three, taken early because it is the one that does not need the
 * module to move.
 *
 * The rest of this module's surface is in `@endora-commerce/contracts` and
 * belongs there — `PaymentReadPort`, `PaymentReferencePort`, `ReceivePaymentPort`,
 * `PaymentRefundPort`, `PaymentEmailRendererPort` are contract DTOs end to end.
 * This one qualifies for `./ports` on D-171's own test — *"does this signature
 * stop the interface living in `packages/contracts`"* — and the answer is its
 * `EntityManager` parameter, which that package may not name because `admin`
 * and `storefront` both compile it (FR-034).
 *
 * No entity class leaves by this door, type-only included (D-168).
 */
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * What {@link PaymentPlacementApplyPort} answers about the row it wrote — a
 * published record and never the managed entity (D-77's first narrowing).
 *
 * `orders` reads `id` off it, to hand to the payment adapter's
 * `onStorefrontOrderCreated` and to name the row it asks to be deferred. The
 * rest is returned because it is what the row *is*; a consumer that could take
 * the managed entity instead could move any other column of this module's
 * aggregate on a transaction it happens to hold, which is the ability the
 * narrowing removes.
 */
export interface PaymentOpened {
  readonly id: string;
  readonly orderId: string;
  readonly paymentMethodId: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: string;
}

/**
 * Container name: `paymentPlacementApplyPort`. Owner: `payments`.
 *
 * The payment row order placement opens, written on the **caller's**
 * `EntityManager` (D-169). `orders` is the one consumer, and its placement makes
 * one call — plus a second on the credit-limit branch.
 *
 * **The seam is not a defect in the design, it *is* the design.**
 * `payments_order_fk` (`payments.order_id` -> `orders.id`, `on delete restrict`,
 * `db/migrations/20260425T050720_core_commerce_init.ts`) means the row cannot
 * exist before its order does, and the order does not commit until placement
 * returns — so a port that opened its own transaction could not satisfy a
 * foreign key against a row it cannot see. A foreign key needs the **table**
 * and never the class (D-169), so that constraint stands while this module
 * publishes no entity class by name.
 *
 * **The settlement half is not here.** A gateway callback moves the payment row
 * and the order's `paymentStatus` through `ReceivePaymentPort` and this module's
 * own handler; the retry, the refund and the per-order history are ordinary
 * contract ports. What lands here is only placement, because only placement runs
 * inside somebody else's transaction.
 *
 * **Owner off: the placement refuses, and so does every other order.** This
 * module is switchable (`payments.enabled`) and `orders` is not, so the edge is
 * declared `refuses-without` rather than bound — an acknowledged or declared
 * dependency would keep the bind and make this module's activation control a
 * dead switch. The refusal the consumer lets through is nevertheless narrower
 * than what an operator actually loses, and the manifest sentence says so: this
 * module contributes all four built-in payment adapters, the adapter registry
 * filters its enumeration on the contributor's effective state, and
 * `assertPaymentMethodUsable` refuses a method whose adapter has an absent
 * owner. So with `payments` off checkout offers nothing to pay with and the shop
 * takes no orders at all; this port is reached only by the one path that guard
 * deliberately tolerates, a method whose adapter **no** module ever registered.
 * That path used to write a row into this module's own table with an operator
 * having switched it off — issue #188's shape — and the gate on this
 * registration is what closes it.
 */
export interface PaymentPlacementApplyPort {
  /**
   * Open the payment row an order is placed with.
   *
   * `em` is **required** (D-169). Its one caller is `placeOrder`, which always
   * passes the `EntityManager` its own transaction runs on; an optional
   * parameter is what lets the same method double as a standalone transaction,
   * and that is a lie about a seam a foreign key holds together.
   *
   * Called **unconditionally, for every payment-method kind**, and above the
   * credit-limit branch: the row is the order's record of what is owed, which a
   * bank transfer and a collection-on-delivery have exactly as a card does.
   */
  openForOrder(
    em: EntityManager,
    input: {
      orderId: string;
      paymentMethodId: string;
      amount: string;
      currency: string;
    },
  ): Promise<PaymentOpened>;

  /**
   * Move the row to this module's `deferred` status — the order is to be
   * settled out of band, against a credit limit whose reservation the same
   * transaction has just taken.
   *
   * A second method rather than a `status` argument on `openForOrder`, because
   * the two decisions are made at different points of the placement and the
   * second is a *consequence of the reservation succeeding*: the row is opened
   * above the branch, and the branch is reached only after the limit has been
   * checked and locked. `orders` assigned `status = 'deferred'` on this module's
   * managed entity until T048; the string is this module's vocabulary and no
   * longer crosses.
   *
   * `em` is **required**, and it is the same transaction `openForOrder` was
   * handed: a second one would neither see the uncommitted row nor be rolled
   * back with the placement.
   */
  markDeferred(em: EntityManager, input: { paymentId: string }): Promise<PaymentOpened>;
}
