'use server';

import { addCartItem, getCartItemCount, type CartCookieJar } from '../api/cart';
import { StorefrontApiError } from '../api/client';
import { getAnonCartCookie, getSessionCookie, setAnonCartCookie } from '../session';

/**
 * Server actions for the cart calls that client components make outside a
 * form: the header's count read and the one-click add on a product card or a
 * comparison column.
 *
 * These must run on the server, for the reason `lib/actions/shoppingList.ts`
 * records for the heart: `b2b_session` and `b2b_cart_anon` are httpOnly cookies
 * scoped to the storefront origin, so a browser `fetch` to the backend origin
 * never carries the buyer's cart identity. Wherever the two origins are
 * different hosts the backend answered such a read for a caller with no cart —
 * `itemCount: 0`, which the header badge then painted over the correct
 * server-rendered count — and gave such a write a cart of its own, keyed by a
 * cookie on the backend's host that the `/cart` page never reads. Reading the
 * cookies here keeps every cart call on the one identity the PDP action and
 * the `/cart` page already use.
 */

async function readCartJar(): Promise<CartCookieJar> {
  const session = await getSessionCookie();
  const anon = await getAnonCartCookie();
  return {
    ...(session ? { session } : {}),
    ...(anon ? { anon } : {}),
  };
}

/** The buyer's cart line count for the header badge and the mobile tab bar. */
export async function getCartItemCountAction(): Promise<number> {
  const jar = await readCartJar();
  // No identity yet means no cart yet: the first add is what mints one.
  if (!jar.session && !jar.anon) return 0;
  return getCartItemCount(jar);
}

export type AddProductToCartResult =
  | { ok: true }
  /** `message` is the backend's own refusal text, or null when there is none. */
  | { ok: false; message: string | null };

/**
 * One-click add of a simple product. Persists the `b2b_cart_anon` cookie the
 * backend mints on a guest's first add — without that the next count read, and
 * the `/cart` page, would not find the cart this call just created.
 */
export async function addProductToCartAction(input: {
  productId: string;
  quantity: number;
}): Promise<AddProductToCartResult> {
  const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
  const quantity = Math.floor(Number(input.quantity));
  if (!productId || !Number.isFinite(quantity) || quantity < 1) {
    return { ok: false, message: null };
  }
  try {
    const result = await addCartItem(await readCartJar(), { productId, quantity });
    if (result.newAnonCookie) await setAnonCartCookie(result.newAnonCookie);
    return { ok: true };
  } catch (err) {
    // `detail`, not `message`: the latter carries the `CODE: ` prefix meant for logs.
    return { ok: false, message: err instanceof StorefrontApiError ? err.detail : null };
  }
}
