import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionCookie, getAnonCartCookie, setAnonCartCookie } from '../../../lib/session';
import {
  getCart,
  applyCartCoupon,
  clearCartCoupon,
  type CartCookieJar,
} from '../../../lib/api/cart';
import { listAddresses, createAddress } from '../../../lib/api/organization';
import { listDeliveryMethods, listPaymentMethods } from '../../../lib/api/methods';
import { placeOrder } from '../../../lib/api/orders';
import { getMyCreditLimit } from '../../../lib/api/credit-limit';
import { getResolvedQuickOrderDefaults } from '../../../lib/api/quick-order';
import { CreditLimitWidget } from '../../../components/CreditLimitWidget';
import { PaymentMethods } from '../../../components/checkout/PaymentMethods';
import { ShippingMethods } from '../../../components/checkout/ShippingMethods';
import { AddressSection } from '../../../components/checkout/AddressSection';
import { PlaceOrderButton } from '../../../components/checkout/PlaceOrderButton';
import { CouponField } from '../../../components/checkout/CouponField';
import { getServerContext } from '../../../lib/server-context';
import { formatMoney } from '../../../lib/i18n/money';
import { OrganizationModerationBanner } from '../../../components/OrganizationModerationBanner';
import { StorefrontApiError } from '../../../lib/api/client';
import { getMe } from '../../../lib/api/account';
import { BeginCheckoutTracker } from '../../../components/analytics/EcommerceTrackers';

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
  searchParams: Promise<{ error?: string; couponError?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/checkout');

  const params = await searchParams;
  const jar: CartCookieJar = await readJar();
  // Feature 036 (T039) — resolve the active locale so checkout components
  // can render their copy in PL/EN.
  const { locale } = await getServerContext();

  let loaded: [
    Awaited<ReturnType<typeof getCart>>,
    Awaited<ReturnType<typeof listAddresses>>,
    Awaited<ReturnType<typeof listDeliveryMethods>>,
    Awaited<ReturnType<typeof listPaymentMethods>>,
    Awaited<ReturnType<typeof getMyCreditLimit>> | null,
    Awaited<ReturnType<typeof getMe>> | null,
    Awaited<ReturnType<typeof getResolvedQuickOrderDefaults>> | null,
  ];
  try {
    loaded = await Promise.all([
      getCart(jar),
      listAddresses(session),
      listDeliveryMethods(),
      listPaymentMethods(),
      // Credit limit is optional context — an org without a granted limit (or a
      // failing lookup) must not bounce a logged-in buyer to login or crash the
      // page. Downstream already treats a null limit as "no credit option".
      getMyCreditLimit(session).catch(() => null),
      getMe(session).catch(() => null),
      // Feature 039 (US2) — resolved default ordering preferences to pre-select.
      getResolvedQuickOrderDefaults(session).catch(() => null),
    ]);
  } catch (err) {
    // A stale/expired `b2b_session` cookie is still truthy, so it slips past
    // the `!session` guard above but the backend rejects it with 401. Treat
    // that as "not logged in" and bounce to login with a return path, rather
    // than crashing the page with an unhandled UNAUTHORIZED error.
    if (err instanceof StorefrontApiError && err.status === 401) {
      redirect('/login?next=/checkout');
    }
    throw err;
  }
  const [cartResult, addresses, deliveryMethods, paymentMethodsRaw, creditLimit, me, defaults] =
    loaded;
  if (cartResult.newAnonCookie) await setAnonCartCookie(cartResult.newAnonCookie);
  const cart = cartResult.cart;
  const canTransact = me?.organization?.canTransact ?? true;
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

  // Feature 036 (US2) — the buyer may pick a saved address or enter a new one,
  // so an empty saved-address book no longer blocks checkout.
  const deliveryAddrs = addresses.filter((a) => a.kind === 'delivery');
  const billingAddrs = addresses.filter((a) => a.kind === 'billing');

  return (
    <div className="b2b-auth max-w-[720px]">
      {/* Feature 049 — GA4 begin_checkout (no-op unless Enhanced Ecommerce is on). */}
      <BeginCheckoutTracker
        currency={cart.subtotal.currency}
        items={cart.items.map((it) => ({
          sku: it.productSku ?? it.productId,
          name: it.productName ?? it.productId,
          price: it.unitPrice.amount,
          quantity: it.quantity,
          currency: it.unitPrice.currency,
        }))}
      />
      <h1>Checkout</h1>
      <OrganizationModerationBanner
        status={me?.organization?.status}
        message={me?.organization?.moderationMessage ?? null}
      />
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}

      <form action={submitAction} className="b2b-auth__form">
        <AddressSection
          deliveryAddresses={deliveryAddrs}
          billingAddresses={billingAddrs}
          locale={locale}
          preferredShippingAddressId={defaults?.shippingAddressId ?? null}
          preferredBillingAddressId={defaults?.billingAddressId ?? null}
          organizationName={me?.organization?.legalName || me?.organization?.name || null}
          organizationTaxId={me?.organization?.taxId ?? null}
        />

        <ShippingMethods methods={deliveryMethods} preferredId={defaults?.deliveryMethodId ?? null} />

        <PaymentMethods
          methods={paymentMethods}
          currency={cart.subtotal.currency}
          preferredId={defaults?.paymentMethodId ?? null}
        />

        <CouponField
          applied={cart.discount ?? null}
          error={params.couponError ?? null}
          applyAction={applyCouponAction}
          clearAction={clearCouponAction}
          locale={locale}
        />
        <div className="b2b-auth__field">
          <label htmlFor="note">Note for the seller (optional)</label>
          <textarea id="note" name="customerNote" rows={3} maxLength={4000} placeholder=" " />
        </div>

        {creditLimit ? (
          <div className="mt-[16px]">
            <CreditLimitWidget limit={creditLimit} locale={locale} />
            {creditAvailable < cartTotal ? (
              <p className="b2b-auth__hint">
                Your cart total ({formatMoney(cartTotal, cart.subtotal.currency, locale)}) exceeds the
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
                <td style={{ fontFamily: 'var(--font-sans)' }}>
                  {/* Feature 043 — `displayName` carries the packaging-unit
                      suffix (e.g. "… (Paleta)"); prefer it over the bare
                      `productName`. Surface the SKU beneath for buyer
                      reference, matching the cart line. */}
                  <div>{it.displayName || it.productName || it.productId}</div>
                  {it.productSku ? (
                    <div className="font-mono text-[11px] uppercase text-muted">
                      {it.productSku}
                    </div>
                  ) : null}
                </td>
                <td className="text-right">x {it.quantity}</td>
                <td className="text-right">
                  {formatMoney(it.unitPrice.amount * it.quantity, it.unitPrice.currency, locale)}
                </td>
              </tr>
            ))}
            <tr>
              <th colSpan={2} scope="row" className="text-right">
                Subtotal
              </th>
              <th className="text-right">
                {formatMoney(cart.subtotal.amount, cart.subtotal.currency, locale)}
              </th>
            </tr>
            {cart.discount ? (
              <tr>
                <th colSpan={2} scope="row" className="text-right">
                  Discount ({cart.discount.code})
                </th>
                <th className="text-right">
                  −{formatMoney(cart.discount.amount, cart.discount.currency, locale)}
                </th>
              </tr>
            ) : null}
            {cart.grandTotal ? (
              <tr>
                <th colSpan={2} scope="row" className="text-right">
                  <strong>Total</strong>
                </th>
                <th className="text-right">
                  <strong>
                    {formatMoney(cart.grandTotal.amount, cart.grandTotal.currency, locale)}
                  </strong>
                </th>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div className="b2b-auth__actions items-center justify-between">
          <Link
            href="/cart"
            className="inline-flex items-center gap-2 rounded-sm border border-line bg-surface px-[16px] py-[10px] font-medium text-fg-soft transition-[background-color,border-color,color] duration-150 hover:border-line-strong hover:bg-surface-alt hover:text-[color:var(--ink-900)]"
          >
            ← Back to cart
          </Link>
          <PlaceOrderButton
            canTransact={canTransact}
            label="Place order"
            pendingLabel="Placing order…"
            title={me?.organization?.moderationMessage ?? 'Ordering is currently unavailable.'}
          />
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

  // Feature 036 (US2) — resolve a shipping/billing address: a saved id is used
  // as-is; a newly entered address is created in the org address book first and
  // referenced by its returned id.
  const field = (name: string): string => ((formData.get(name) as string | null) ?? '').trim();
  async function resolveAddress(kind: 'delivery' | 'billing', prefix: string): Promise<string> {
    const savedId = field(`${prefix}AddressId`);
    if (savedId) return savedId;
    const created = await createAddress(session!, {
      kind,
      recipientName: field(`${prefix}_recipientName`),
      street: field(`${prefix}_street`),
      city: field(`${prefix}_city`),
      postalCode: field(`${prefix}_postalCode`),
      country: field(`${prefix}_country`),
      ...(field(`${prefix}_phone`) ? { phone: field(`${prefix}_phone`) } : {}),
    });
    return created.id;
  }

  let order;
  try {
    const deliveryAddressId = await resolveAddress('delivery', 'delivery');
    const billingAddressId =
      formData.get('billingSameAsShipping') != null
        ? deliveryAddressId
        : await resolveAddress('billing', 'billing');

    const billingCompanyName = field('billingCompanyName');
    const billingTaxId = field('billingTaxId');
    order = await placeOrder(session, {
      deliveryAddressId,
      billingAddressId,
      deliveryMethodId: (formData.get('deliveryMethodId') as string) ?? '',
      paymentMethodId: (formData.get('paymentMethodId') as string) ?? '',
      ...(promo ? { promotionCode: promo } : {}),
      ...(note ? { customerNote: note } : {}),
      ...(billingCompanyName ? { billingCompanyName } : {}),
      ...(billingTaxId ? { billingTaxId } : {}),
    });
  } catch (err) {
    // Feature 036 (US4) — placement failed: the transaction rolled back, so the
    // cart is intact. Send the buyer to the Failure Page with a reason-specific
    // message and a "Try again" button (rather than re-rendering checkout).
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not place the order.';
    redirect(`/checkout/failure?reason=${encodeURIComponent(message)}`);
  }
  // Feature 036 — a gateway method returns a redirect next-action; send the
  // buyer to the gateway. Otherwise land on the Success Page, which shows the
  // customer-facing business Order ID.
  if (order.nextAction?.kind === 'redirect_to_gateway') {
    redirect(order.nextAction.url);
  }
  redirect(`/checkout/success?id=${order.id}`);
}

/**
 * Feature 036 (US3) — apply (or replace) a coupon on the cart, then re-render
 * checkout so the discount is reflected in the summary before placing the
 * order. The cart is the source of truth `placeOrder` reads. A rejected code
 * round-trips back with a reason-specific message; totals stay unchanged.
 */
async function applyCouponAction(formData: FormData): Promise<void> {
  'use server';
  const jar = await readJar();
  if (!jar.session && !jar.anon) redirect('/login?next=/checkout');
  const code = ((formData.get('couponCode') as string | null) ?? '').trim();
  if (!code) redirect('/checkout');
  const result = await applyCartCoupon(jar, code);
  if (result.outcome === 'rejected') {
    redirect(`/checkout?couponError=${encodeURIComponent(couponRejectionMessage(result.reason))}`);
  }
  redirect('/checkout');
}

async function clearCouponAction(): Promise<void> {
  'use server';
  const jar = await readJar();
  if (!jar.session && !jar.anon) redirect('/login?next=/checkout');
  await clearCartCoupon(jar);
  redirect('/checkout');
}

/** Map the typed coupon-rejection reasons to a localized buyer message. */
function couponRejectionMessage(reason: string): string {
  switch (reason) {
    case 'invalid_code':
    case 'coupon_format_invalid':
      return 'This coupon code is invalid.';
    case 'expired':
      return 'This coupon has expired.';
    case 'below_min_spend':
      return 'Your cart does not meet this coupon’s minimum spend.';
    case 'wrong_channel':
    case 'wrong_customer_group':
    case 'wrong_organization':
      return 'This coupon is not available for your account.';
    default:
      return 'This coupon could not be applied.';
  }
}
