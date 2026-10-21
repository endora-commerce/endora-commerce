/**
 * The port interfaces `carts` publishes whose signature carries a MikroORM
 * `EntityManager`, and **nothing that exists at runtime** (feature 080, T048;
 * D-169, D-171).
 *
 * `tsc` compiles this file to `export {};`. That is the property D-171 makes
 * the boundary decision on — *a subpath is contract surface iff the module it
 * resolves to exports no runtime binding* — and it is why this declaration has
 * its own file rather than sitting on top of `services/cart-read-port.ts`,
 * which exports the read service and the write-port factory beside it. A
 * consumer naming that file names the owner's implementation, whatever
 * `import type` erases; a consumer naming this one names a declaration and can
 * name nothing else.
 *
 * **This is not yet a supported specifier and the ledger still counts it.**
 * `carts` is not a workspace package, so there is no `exports` map for this to
 * be a subpath of, and `check:module-boundary` reads `orders`' relative import
 * exactly as it read the two entity imports it replaces — D-171 says so in as
 * many words: `resolveModulePackage` returns `null` for any specifier starting
 * with `.`, so an unconverted reach has no subpath for the exemption to apply
 * to, and reaching the exempt state takes three separable edits (package the
 * owner, publish the interface, rewrite the specifier). This file is the second
 * of those three, taken early because it is the one that does not need the
 * module to move.
 *
 * Everything else this module publishes is in `@endora-commerce/contracts` and
 * belongs there: `CartReadPort` and `CartWritePort` are contract DTOs end to
 * end, so by D-171's qualifying test — *"does this signature stop the interface
 * living in `packages/contracts`"* — neither belongs here. This one does, and
 * for one reason: its `EntityManager` parameter, which that package may not
 * name because `admin` and `storefront` both compile it (FR-034).
 *
 * No entity class leaves by this door, type-only included (D-168).
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartCustomerContext, CartWithItems } from '@endora-commerce/contracts';

/**
 * Container name: `cartPlacementApplyPort`. Owner: `carts`.
 *
 * The basket half of order placement, run on the **caller's** `EntityManager`
 * (D-169). `orders` is the one consumer, and it has three questions: what is on
 * the basket I am turning into an order, is every line of it still priced at
 * what it may be ordered at, and — once that order exists — finish the basket
 * off against it.
 *
 * **The seam is not a defect in the design, it *is* the design.**
 * `carts_completed_order_fk` (`carts.completed_order_id` -> `orders.id`, `on
 * delete set null`, D-94.1) is what says so in the schema: the pointer cannot
 * be written before the order exists, and the order does not commit until
 * placement returns. A port that opened its own transaction would commit the
 * completion for a placement that then failed, which is precisely the property
 * `test/integration/orders/place-order-failure-preserves-cart.test.ts` asserts
 * the opposite of — a buyer whose placement fails finds their basket exactly as
 * they left it. The **cart-side** column is what forces that: an
 * `orders.cart_id` would have been satisfiable by completing the cart in a
 * second transaction, because the cart is already committed when the order row
 * is written. A foreign key needs the **table** and never the class (D-169), so
 * that constraint stands while this module publishes no entity class by name.
 *
 * **Why the read takes an `EntityManager` too**, when D-169 says a read handed
 * one is a write seam re-opened to serve a read. Because it is not a read this
 * module offers anybody — it is the first step of *this* protocol, and the rows
 * it returns are the rows {@link CartPlacementApplyPort.completeForOrder} then
 * writes. Reading them on a second `EntityManager` would put a commit boundary
 * between the totals a placement quotes and the basket it clears. The
 * standalone read is a different method on a different port and takes no
 * `EntityManager`: `CartReadPort.findActiveForCustomer` in
 * `@endora-commerce/contracts`, which is what `orders`' non-transactional
 * total preview resolves.
 *
 * **Owner off:** unreachable. `carts` declares `activation.nonDeactivatable`,
 * so it never enters an absent state, and there is no deactivation-consequence
 * to state for an owner the platform refuses to switch off. The port is
 * registered with `providePort` like every other name this module publishes, so
 * that the answer stays the manifest's to give and not this line's.
 */
export interface CartPlacementApplyPort {
  /**
   * The customer's active basket and its lines, read on `em`.
   *
   * `em` is **required** (D-169). Its one caller is `placeOrder`, which always
   * passes the `EntityManager` its own transaction runs on; an optional
   * parameter is what lets the same method double as a standalone read, and
   * that is a lie about a seam whose whole content is that the read and the
   * write share a transaction.
   *
   * `null` when the customer has no active basket — the state the caller
   * answers `409 CART_EMPTY` for, together with an empty line list.
   */
  readActiveForPlacement(
    em: EntityManager,
    ctx: CartCustomerContext,
  ): Promise<CartWithItems | null>;
  /**
   * Finish the basket the order was placed from: remove its lines, move it to
   * `completed`, stamp `completed_order_id` and release the anonymous-cart
   * token.
   *
   * Runs on the same `em` as the read above and as the order's own writes, for
   * the reason `carts_completed_order_fk` gives. It is a no-op for a cart that
   * is not there, which cannot happen on the placement path — the caller read
   * it one transaction-step ago — and is the honest answer rather than a throw
   * if it ever does.
   */
  completeForOrder(
    em: EntityManager,
    input: { cartId: string; orderId: string },
  ): Promise<void>;
  /**
   * The basket's lines whose stored unit price is not the price they may be
   * ordered at now — empty when every line is current.
   *
   * A cart line is ordered at its stored price, so placement asks this before
   * it copies that price onto the order line, on the **same** `em` the read
   * above ran on so both answers describe one basket. "The price they may be
   * ordered at" is this module's answer, and the one it stores when a line is
   * added or its quantity changes: the agreed price at the agreed quantity of a
   * line seeded from an accepted Quote Request, otherwise the price list at the
   * line's current quantity for `organizationId`, otherwise the Product's own
   * price. A line with none of them, or one sold on request only, is reported
   * with `currentUnitPrice: null`.
   */
  findPriceDrift(
    em: EntityManager,
    input: { cartId: string; organizationId: string | null },
  ): Promise<CartLinePriceDrift[]>;
  /**
   * Store the price each line may be ordered at now, on this module's **own**
   * `EntityManager` — for the caller whose placement {@link findPriceDrift}
   * refused, after that transaction rolled back, so the basket the buyer goes
   * back to review holds the prices the next placement will accept. A line
   * with no orderable price keeps what it holds.
   */
  refreshLinePrices(input: { cartId: string; organizationId: string | null }): Promise<void>;
}

/** One line {@link CartPlacementApplyPort.findPriceDrift} reports. */
export interface CartLinePriceDrift {
  cartItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  /** Decimal string — the price the line holds. */
  storedUnitPrice: string;
  storedCurrency: string;
  /** Decimal string — the price it may be ordered at now; `null` when it may not be ordered. */
  currentUnitPrice: string | null;
  currentCurrency: string | null;
  /** Feature 160 (FR-030) — the tier that prices the line now; `null` when it may not be ordered. */
  currentPriceSource?: 'agreed' | 'base' | 'catalogue' | 'buyer' | 'sale' | null;
}
