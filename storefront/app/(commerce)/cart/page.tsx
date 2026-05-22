import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getCart,
  removeCartItem,
  updateCartItem,
  type CartCookieJar,
} from '../../../lib/api/cart';
import { getProductLinks } from '../../../lib/api/catalog';
import { getServerContext } from '../../../lib/server-context';
import {
  getAnonCartCookie,
  getSessionCookie,
  setAnonCartCookie,
} from '../../../lib/session';
import { StorefrontApiError } from '../../../lib/api/client';
import { CrossSellSection } from '../../../components/CrossSellSection';
import { OrganizationModerationBanner } from '../../../components/OrganizationModerationBanner';
import { tForLocale } from '../../../lib/i18n/messages';
import { getMe } from '../../../lib/api/account';

/**
 * Cart page (T156). Lists the current cart's items and lets the buyer
 * adjust quantity or remove a row. Anonymous shoppers are supported via
 * the `b2b_cart_anon` cookie minted by the backend on the first add; the
 * server actions persist any newly minted token via `setAnonCartCookie`.
 */

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const jar = await readJar();
  const result = await getCart(jar);
  if (result.newAnonCookie) await setAnonCartCookie(result.newAnonCookie);
  const cart = result.cart;

  // Feature 026 — fetch the customer's Organization moderation status so
  // we can render a banner + drive checkout-CTA disable. Anonymous carts
  // skip the lookup (no Organization is attached).
  const session = await getSessionCookie();
  const me = session
    ? await getMe(session).catch(() => null)
    : null;
  const canTransact = me?.organization?.canTransact ?? true;

  // Feature 002 US4 — cross-sell from cart items. We fan out one fetch
  // per unique productId; CrossSellSection dedupes targets so the same
  // suggestion never appears twice even when reached via multiple items.
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);
  const uniqueProductIds = [...new Set(cart.items.map((it) => it.productId))];
  const crossSellArrays = await Promise.all(
    uniqueProductIds.map((id) => getProductLinks(id, 'cross_sell', ctx)),
  );
  const crossSellLinks = crossSellArrays.flat();

  if (cart.items.length === 0) {
    return (
      <div className="b2b-auth">
        <h1>Your cart</h1>
        <p>Your cart is empty.</p>
        <p>
          <Link href="/catalog">Browse the catalog</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="b2b-auth" style={{ maxWidth: 720 }}>
      <h1>Your cart</h1>
      <OrganizationModerationBanner
        status={me?.organization?.status}
        message={me?.organization?.moderationMessage ?? null}
      />
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Line</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {cart.items.map((it) => (
            <tr key={it.id}>
              <td>
                <Link href={`/p/${it.productId}`}>{it.productId}</Link>
                {it.variantId ? (
                  <>
                    <br />
                    <span className="muted">variant {it.variantId}</span>
                  </>
                ) : null}
              </td>
              <td>
                <form action={updateAction} style={{ display: 'inline-flex', gap: '0.25rem' }}>
                  <input type="hidden" name="itemId" value={it.id} />
                  <input
                    type="number"
                    name="quantity"
                    min={1}
                    max={9999}
                    defaultValue={it.quantity}
                    style={{ width: '4rem' }}
                  />
                  <button type="submit">Update</button>
                </form>
              </td>
              <td>
                {it.unitPrice.amount.toFixed(2)} {it.unitPrice.currency}
              </td>
              <td>
                {(it.unitPrice.amount * it.quantity).toFixed(2)} {it.unitPrice.currency}
              </td>
              <td>
                <form action={removeAction} style={{ display: 'inline' }}>
                  <input type="hidden" name="itemId" value={it.id} />
                  <button type="submit">Remove</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={3} scope="row" style={{ textAlign: 'right' }}>
              Subtotal
            </th>
            <th colSpan={2}>
              {cart.subtotal.amount.toFixed(2)} {cart.subtotal.currency}
            </th>
          </tr>
        </tfoot>
      </table>
      <p className="b2b-auth__hint">
        Taxes + delivery charges are calculated at checkout.
      </p>
      <div className="b2b-auth__actions">
        {canTransact ? (
          <Link href="/checkout">
            <button type="button">Proceed to checkout</button>
          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled
            title={me?.organization?.moderationMessage ?? 'Ordering is currently unavailable.'}
            style={{ opacity: 0.6, cursor: 'not-allowed' }}
          >
            Proceed to checkout
          </button>
        )}
      </div>

      <CrossSellSection
        links={crossSellLinks}
        heading={t('product.links.crossSell')}
        locale={locale}
      />
    </div>
  );
}

async function readJar(): Promise<CartCookieJar> {
  const session = await getSessionCookie();
  const anon = await getAnonCartCookie();
  return {
    ...(session ? { session } : {}),
    ...(anon ? { anon } : {}),
  };
}

async function updateAction(formData: FormData): Promise<void> {
  'use server';
  const itemId = (formData.get('itemId') as string) ?? '';
  const quantity = Number(formData.get('quantity') ?? '0');
  if (!Number.isFinite(quantity) || quantity < 1) redirect('/cart?error=invalid-quantity');
  try {
    const result = await updateCartItem(await readJar(), itemId, quantity);
    if (result.newAnonCookie) await setAnonCartCookie(result.newAnonCookie);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not update item.';
    redirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  redirect('/cart');
}

async function removeAction(formData: FormData): Promise<void> {
  'use server';
  const itemId = (formData.get('itemId') as string) ?? '';
  try {
    const result = await removeCartItem(await readJar(), itemId);
    if (result.newAnonCookie) await setAnonCartCookie(result.newAnonCookie);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not remove item.';
    redirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  redirect('/cart');
}
