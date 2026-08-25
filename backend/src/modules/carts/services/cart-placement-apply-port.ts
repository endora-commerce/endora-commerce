import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartCustomerContext, CartWithItems } from '@endora-commerce/contracts';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import type { CartPlacementApplyPort } from '../ports/index.js';
import { toCartItemRecord, toCartRecord } from './cart-read-port.js';

/**
 * `cartPlacementApplyPort` — the basket half of order placement, run on the
 * caller's `EntityManager` (feature 080, T048; D-169).
 *
 * `orders` held `Cart` and `CartItem` itself until T048: `placeOrder` read the
 * basket on its own transaction, built the order out of it, and ended by
 * deleting the lines, moving the cart to `completed` and stamping
 * `completed_order_id` — four statements against this module's two tables,
 * written by a module that owns neither. D-168 leaves a packaged `carts` no
 * entity class for `orders` to name, so the reach had to go before this module
 * moves.
 *
 * **The transaction is unchanged, and that is the point of the conversion.**
 * The read and the completion still run on placement's own `EntityManager`;
 * `carts_completed_order_fk` is untouched; a placement that fails still leaves
 * the basket exactly as the buyer left it, which
 * `test/integration/orders/place-order-failure-preserves-cart.test.ts` asserts
 * and which a port opening its own transaction could not deliver. What changed
 * is that the statements are written by the module that owns the tables, and
 * what crosses the boundary is `CartWithItems` — published records — instead of
 * two managed entities the consumer could move any column of (D-77's first
 * narrowing).
 *
 * The port's own doc block, in `../ports/index.ts`, states the constraint and
 * why the read takes an `EntityManager` where `CartReadPort.findActiveForCustomer`
 * does not.
 */
export class CartPlacementApplyService implements CartPlacementApplyPort {
  async readActiveForPlacement(
    em: EntityManager,
    ctx: CartCustomerContext,
  ): Promise<CartWithItems | null> {
    // The same conditional org predicate `CartReadService` applies, and for the
    // same reason: `carts.organization_id` is nullable for a customer account
    // that has none, so a caller with no organisation must not be narrowed out
    // of its own basket. `Cart` is `@CustomerScoped`, so the tenant guard is on
    // the customer either way.
    const cart = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      ...(ctx.organizationId === null ? {} : { organizationId: ctx.organizationId }),
      status: 'active',
    });
    if (!cart) return null;
    const items = await em.find(CartItem, { cartId: cart.id });
    return { cart: toCartRecord(cart), items: items.map(toCartItemRecord) };
  }

  async completeForOrder(
    em: EntityManager,
    input: { cartId: string; orderId: string },
  ): Promise<void> {
    // command-coverage-ignore: the basket half of an order placement, inside
    // the caller's transaction. `orders` audits the placement as one operation
    // through its own Command; a second audit entry for the basket the order
    // came from would record the same decision twice, and the cart is not an
    // auditable domain object in its own right — the same reasoning
    // `cartWritePort.replaceItemsForCustomer` carries.
    const cart = await em.findOne(Cart, { id: input.cartId });
    if (!cart) return;
    await em.nativeDelete(CartItem, { cartId: cart.id });
    // Feature 027's renamed status vocabulary: the cart produced an order, so
    // its lifecycle terminates in `completed`.
    cart.status = 'completed';
    // Which order emptied this cart (D-94.1), held by `carts_completed_order_fk`.
    cart.completedOrderId = input.orderId;
    // Always null on an authenticated checkout today, but cleared for the edge
    // case where a customer checks out from an anon-derived cart that still
    // carries the token.
    cart.anonymousCartToken = null;
    await em.flush();
  }
}
