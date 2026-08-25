/**
 * The port interfaces `orders` publishes whose signature carries a MikroORM
 * `EntityManager`, and **nothing that exists at runtime** (feature 080, T048;
 * D-169, D-171).
 *
 * `tsc` compiles this file to `export {};`. That is the property D-171 makes
 * the boundary decision on — *a subpath is contract surface iff the module it
 * resolves to exports no runtime binding* — and it is why these declarations
 * have a file of their own rather than sitting on top of a service module,
 * which exports the class beside them. A consumer naming that file names the
 * owner's implementation, whatever `import type` erases; a consumer naming this
 * one names a declaration and can name nothing else.
 *
 * **This is not yet a supported specifier and the ledger still counts it.**
 * `orders` is not a workspace package, so there is no `exports` map for this to
 * be a subpath of, and `check:module-boundary` reads `payments`' relative
 * import exactly as it read the entity import it replaces — D-171 says so in as
 * many words: `resolveModulePackage` returns `null` for any specifier starting
 * with `.`, so an unconverted reach has no subpath for the exemption to apply
 * to, and reaching the exempt state takes three separable edits (package the
 * owner, publish the interface, rewrite the specifier). This file is the second
 * of those three, taken early because it is the one that does not need the
 * module to move.
 *
 * Every ordinary read and write of an order is published in
 * `@endora-commerce/contracts` — `OrderReadPort`, `OrderTransitionPort`,
 * `OrderStatusRegistry` — and belongs there. What lands here is only what
 * cannot: the qualifying test D-171 states is not *"is this a real published
 * port"* but *"does this signature stop the interface living in
 * `packages/contracts`"*, and an `EntityManager` parameter does, because
 * `admin` and `storefront` both compile that package and FR-034 keeps its
 * `@mikro-orm` import count at zero.
 *
 * No entity class leaves by this door, type-only included (D-168).
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderPaymentStatus, OrderStatus } from '@endora-commerce/contracts';

/**
 * What {@link OrderPaymentStatusApplyPort.applyPaymentStatus} answers about the
 * order it just moved — a published record and never the managed entity (D-77's
 * first narrowing).
 *
 * `status` is the lifecycle axis and is read-only here: the settlement decides
 * the *money* axis and asks `orderTransitionPort` for the lifecycle move after
 * its transaction has committed, so what the caller needs back is the status
 * the order is at, to hand to that port as the "from" it observed.
 */
export interface OrderPaymentStatusApplied {
  readonly orderId: string;
  readonly status: OrderStatus | string;
  readonly paymentStatus: OrderPaymentStatus;
}

/**
 * Container name: `orderPaymentStatusApplyPort`. Owner: `orders`.
 *
 * The money axis of an order, written on the **caller's** `EntityManager`
 * (D-169). `payments` is the one consumer: a gateway callback moves the payment
 * row and the order's `paymentStatus` in one `em.transactional`, and either
 * both land or neither does.
 *
 * **The seam is not a defect in the design, it *is* the design.**
 * `payments_order_fk` (`payments.order_id` -> `orders.id`, `on delete
 * restrict`) is what says so in the schema: the payment row and the order it
 * settles are held together, so a port that opened its own transaction would
 * commit half a settlement — a payment recorded `paid` against an order still
 * awaiting payment, or the reverse, with no way back. A foreign key needs the
 * **table** and never the class (D-169), so that constraint stands while this
 * module publishes no entity class by name.
 *
 * **The lifecycle half is not here and must not come here.** `order.status` is
 * `OrderTransitionPort.applyStatus` in `@endora-commerce/contracts`, called
 * *after* the settlement transaction commits, because it obtains its own
 * `EntityManager` and a call from inside would write the order on a second
 * pooled connection the caller's rollback cannot reach (issue #200). This port
 * writes the one column `payments_order_fk` genuinely holds together with the
 * payment row, and reports the status it found.
 *
 * **Owner off:** unreachable. `orders` declares `activation.nonDeactivatable`,
 * so it never enters an absent state; `payments` declares `orders` in its
 * manifest `dependencies` for the constraint, and there is no
 * deactivation-consequence to state for an owner the platform refuses to switch
 * off. The port is nevertheless registered with `providePort`, like every other
 * name this module publishes, so that the answer stays the manifest's to give
 * and not this line's.
 */
export interface OrderPaymentStatusApplyPort {
  /**
   * Stamp `paymentStatus` on the order and report what it was found at.
   *
   * `em` is **required** (D-169). Its one caller is the settlement handler,
   * which always passes the `EntityManager` its own transaction runs on; an
   * optional parameter is what lets the same method double as a standalone
   * transaction, and that is a lie about a seam a foreign key holds together.
   *
   * `null` when there is no such order. That is a real state and not an error:
   * `payments.order_id` is `on delete restrict`, so it cannot dangle, but the
   * settlement path reaches here from a provider callback keyed on the payment,
   * and the caller's own behaviour on a missing order — record the payment,
   * move nothing — predates this port.
   */
  applyPaymentStatus(
    em: EntityManager,
    input: { orderId: string; paymentStatus: OrderPaymentStatus },
  ): Promise<OrderPaymentStatusApplied | null>;
}
