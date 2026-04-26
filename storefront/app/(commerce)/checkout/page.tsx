import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionCookie, getAnonCartCookie, setAnonCartCookie } from '../../../lib/session';
import { getCart, type CartCookieJar } from '../../../lib/api/cart';
import { listAddresses } from '../../../lib/api/organization';
import { listDeliveryMethods, listPaymentMethods } from '../../../lib/api/methods';
import { placeOrder } from '../../../lib/api/orders';
import { getMyCreditLimit } from '../../../lib/api/credit-limit';
import { CreditLimitWidget } from '../../../components/CreditLimitWidget';
import { StorefrontApiError } from '../../../lib/api/client';

/**
 * Checkout (T157 / FR-046, FR-049). One page, four sections — pick a
 * delivery address + a billing address from the org's saved set, choose
 * delivery + payment methods, optionally add a promotion code or note,
 * and submit. The submit calls `POST /orders`; on success we redirect to
 * the confirmation page at `/orders/[id]`.
 *
 * Anonymous shoppers are bounced to /login first because order placement
 * needs an authenticated session.
 */

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/checkout');

  const params = await searchParams;
  const jar: CartCookieJar = await readJar();

  const [cartResult, addresses, deliveryMethods, paymentMethodsRaw, creditLimit] =
    await Promise.all([
      getCart(jar),
      listAddresses(session),
      listDeliveryMethods(),
      listPaymentMethods(),
      getMyCreditLimit(session),
    ]);
  if (cartResult.newAnonCookie) await setAnonCartCookie(cartResult.newAnonCookie);
  const cart = cartResult.cart;
  // Hide the credit_limit-kind method(s) when the buyer's organization
  // hasn't been granted a limit, or when the cart total clearly exceeds
  // the available credit. The backend rejects an over-limit reservation
  // anyway, but a friendlier UX is to drop the option early.
  const creditAvailable = creditLimit?.availableAmount ?? 0;
  const cartTotal = cart.subtotal.amount;
  const paymentMethods = paymentMethodsRaw.filter((m) => {
    if (m.kind !== 'credit_limit') return true;
    if (!creditLimit) return false;
    return creditAvailable >= cartTotal;
  });

  if (cart.items.length === 0) {
    return (
      <div className="b2b-auth">
        <h1>Checkout</h1>
        <p>Your cart is empty — add a product before checking out.</p>
        <p>
          <Link href="/catalog">Browse the catalog</Link>
        </p>
      </div>
    );
  }

  const deliveryAddrs = addresses.filter((a) => a.kind === 'delivery');
  const billingAddrs = addresses.filter((a) => a.kind === 'billing');

  if (deliveryAddrs.length === 0 || billingAddrs.length === 0) {
    return (
      <div className="b2b-auth">
        <h1>Checkout</h1>
        <p className="b2b-auth__error">
          You need at least one delivery and one billing address. Add them under{' '}
          <Link href="/organization/addresses">Organization → Addresses</Link>.
        </p>
      </div>
    );
  }

  const defaultDelivery = deliveryAddrs.find((a) => a.isDefault) ?? deliveryAddrs[0]!;
  const defaultBilling = billingAddrs.find((a) => a.isDefault) ?? billingAddrs[0]!;

  return (
    <div className="b2b-auth" style={{ maxWidth: 720 }}>
      <h1>Checkout</h1>
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}

      <form action={submitAction} className="b2b-auth__form">
        <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
          <legend style={{ fontWeight: 600 }}>Delivery address</legend>
          <select name="deliveryAddressId" defaultValue={defaultDelivery.id}>
            {deliveryAddrs.map((a) => (
              <option key={a.id} value={a.id}>
                {a.recipientName} — {a.street}, {a.postalCode} {a.city}, {a.country}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
          <legend style={{ fontWeight: 600 }}>Billing address</legend>
          <select name="billingAddressId" defaultValue={defaultBilling.id}>
            {billingAddrs.map((a) => (
              <option key={a.id} value={a.id}>
                {a.recipientName} — {a.street}, {a.postalCode} {a.city}, {a.country}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
          <legend style={{ fontWeight: 600 }}>Delivery method</legend>
          {deliveryMethods.map((m) => (
            <label key={m.id} style={{ display: 'block' }}>
              <input
                type="radio"
                name="deliveryMethodId"
                value={m.id}
                defaultChecked={m.id === deliveryMethods[0]!.id}
              />{' '}
              {pickName(m.name)} — {m.cost.amount.toFixed(2)} {m.cost.currency}
            </label>
          ))}
        </fieldset>

        <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
          <legend style={{ fontWeight: 600 }}>Payment method</legend>
          {paymentMethods.map((m) => (
            <label key={m.id} style={{ display: 'block' }}>
              <input
                type="radio"
                name="paymentMethodId"
                value={m.id}
                defaultChecked={m.id === paymentMethods[0]!.id}
              />{' '}
              {pickName(m.name)} <span className="muted">({m.kind})</span>
            </label>
          ))}
        </fieldset>

        <div className="b2b-auth__field">
          <label htmlFor="promo">Promotion code (optional)</label>
          <input id="promo" name="promotionCode" maxLength={64} />
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="note">Note for the seller (optional)</label>
          <textarea id="note" name="customerNote" rows={3} maxLength={4000} />
        </div>

        {creditLimit ? (
          <div style={{ marginTop: 'var(--b2b-spacing, 16px)' }}>
            <CreditLimitWidget limit={creditLimit} />
            {creditAvailable < cartTotal ? (
              <p className="b2b-auth__hint">
                Your cart total ({cartTotal.toFixed(2)} {cart.subtotal.currency}) exceeds the
                available credit. The credit-limit payment option is hidden until you reduce
                the cart or contact support to raise your limit.
              </p>
            ) : null}
          </div>
        ) : null}

        <h3>Review</h3>
        <table className="b2b-account__table">
          <tbody>
            {cart.items.map((it) => (
              <tr key={it.id}>
                <td>{it.productId}</td>
                <td>x {it.quantity}</td>
                <td>
                  {(it.unitPrice.amount * it.quantity).toFixed(2)} {it.unitPrice.currency}
                </td>
              </tr>
            ))}
            <tr>
              <th colSpan={2} scope="row" style={{ textAlign: 'right' }}>
                Subtotal
              </th>
              <th>
                {cart.subtotal.amount.toFixed(2)} {cart.subtotal.currency}
              </th>
            </tr>
          </tbody>
        </table>

        <div className="b2b-auth__actions">
          <button type="submit">Place order</button>
        </div>
      </form>
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

async function submitAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/checkout');

  const promo = (formData.get('promotionCode') as string | null) || undefined;
  const note = (formData.get('customerNote') as string | null) || undefined;

  let orderId: string;
  try {
    const order = await placeOrder(session, {
      deliveryAddressId: (formData.get('deliveryAddressId') as string) ?? '',
      billingAddressId: (formData.get('billingAddressId') as string) ?? '',
      deliveryMethodId: (formData.get('deliveryMethodId') as string) ?? '',
      paymentMethodId: (formData.get('paymentMethodId') as string) ?? '',
      ...(promo ? { promotionCode: promo } : {}),
      ...(note ? { customerNote: note } : {}),
    });
    orderId = order.id;
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not place the order.';
    redirect(`/checkout?error=${encodeURIComponent(message)}`);
  }
  redirect(`/orders/${orderId}`);
}

function pickName(name: Record<string, string>): string {
  return name['en-US'] ?? Object.values(name)[0] ?? 'Method';
}
