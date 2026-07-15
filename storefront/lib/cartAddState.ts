/**
 * Result state for the PDP add-to-cart server action, driven by `useActionState`.
 *
 * The PDP add-to-cart used to end in `redirect('/cart')`, yanking the buyer off
 * the product page. Instead the action now returns one of these states and the
 * client shows a confirmation popup (task: "product added" popup instead of an
 * immediate redirect to the cart). `token` increments on every success so a
 * repeated add produces a fresh object and re-triggers the popup effect.
 */
export type AddToCartResult =
  | { status: 'idle' }
  | { status: 'success'; token: number }
  | { status: 'error'; message: string };

export const ADD_TO_CART_IDLE: AddToCartResult = { status: 'idle' };

/** Next success token given the previous action state. */
export function nextAddToCartToken(prev: AddToCartResult): number {
  return (prev.status === 'success' ? prev.token : 0) + 1;
}
