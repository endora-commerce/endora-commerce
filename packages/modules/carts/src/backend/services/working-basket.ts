import type { EntityManager } from '@mikro-orm/postgresql';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';

/**
 * Remove a **working** basket (issue #169) — and only a working one: the
 * `status` predicate is what keeps this from ever reaching a buyer's basket.
 * Its lines go first; its audit rows go with the cart (`on delete cascade`).
 *
 * `customerAccountId`, when given, narrows the delete to that customer's
 * basket, for a caller that names a cart id it was handed rather than one it
 * created.
 */
export async function discardWorkingBasketOn(
  em: EntityManager,
  input: { cartId: string; customerAccountId?: string },
): Promise<void> {
  // command-coverage-ignore: removes the transient working state of a request
  // that was refused; nothing was placed and nothing is recorded.
  const cart = await em.findOne(Cart, {
    id: input.cartId,
    status: 'working',
    ...(input.customerAccountId !== undefined ? { customerAccountId: input.customerAccountId } : {}),
  });
  if (!cart) return;
  await em.nativeDelete(CartItem, { cartId: cart.id });
  // Through the unit of work, so the identity map holds no cart the database
  // no longer has.
  em.remove(cart);
  await em.flush();
}
