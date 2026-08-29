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
 * **One of the two seams below is `payments`', declared here, and that is
 * D-171.1 rather than an accident.** `orders` and `payments` reach each other —
 * the placement opens a payment row inside the order's transaction, the
 * settlement stamps the order's `paymentStatus` inside the payment's — so the
 * reaches are **mutual**, and only one of the two npm edges can exist: a mutual
 * devDependency between two module packages is a build **deadlock** and not a
 * race, because every package build sets `noEmitOnError`, so the side that
 * loses emits nothing and the side that would have won never gets the `.d.ts`
 * it is waiting for. Measured seven runs, seven reds, `--workspace-concurrency=1`
 * among them: there is no serialisation that works.
 *
 * Which side declares is therefore **derived and not chosen**, from the
 * direction of the binding manifest edge. `payments.dependencies` contains
 * `orders`, so `mod-payments` build-depending on `mod-orders` adds no claim its
 * manifest does not already make. The mirror would add one nothing records:
 * `orders` declares `activation.nonDeactivatable`, so `composeModules` refuses
 * a composition without it, and it would build-depend on a module a deployment
 * may not install — not a residue but a platform that does not compile.
 *
 * The licence is **conditional**, and the condition is the provider's:
 * `payments` names {@link PaymentPlacementApplyPort} at its `implements` clause
 * *and* at an explicitly typed `providePort<T>`, which is where `tsc` actually
 * checks conformance — TS2420 at the first, TS2345 at the second, because
 * `Registration<T> = Resolver<T>` puts `T` in return position. Both resolve the
 * interface wherever it was declared, which is what D-171 §4's original
 * sentence got right about the wrong seam: `lazyPort<T>` checks nothing, under
 * every placement. `check:port-shape`'s `declared-elsewhere-without-implements`
 * holds the condition, and D-77's rejected alternative — the provider naming
 * the interface nowhere — stays refused.
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
 * **Declared here and implemented by `payments`; `orders` implements nothing of
 * it.** See the derivation in this file's header — the reaches are mutual, one
 * npm edge is possible, and it runs from the module that declares the other in
 * its manifest `dependencies` into the module it declares. The implementation
 * stays at `payments/services/payment-placement-apply-port.ts` and the
 * registration at `payments`' own `providePort<PaymentPlacementApplyPort>`.
 * Nothing else moved with the declaration: the container name, the foreign key,
 * both manifests and the runtime path are exactly what they were.
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
