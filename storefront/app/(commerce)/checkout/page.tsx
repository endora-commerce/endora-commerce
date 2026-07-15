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
import { getStripeStorefrontConfig, getStripeClientSecret } from '../../../lib/api/stripe';
import { STRIPE_REDIRECT_RENDERER_KEY } from '../../../lib/payment-renderers/registry';
import {
  StripeInlinePaymentMethods,
  type StripeInlinePrepareResult,
} from '../../../components/checkout/StripeInlinePaymentMethods';
import { listCountries } from '../../../lib/api/dictionary';
import { placeOrder, previewOrderTotal } from '../../../lib/api/orders';
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
    Awaited<ReturnType<typeof listCountries>>,
    Awaited<ReturnType<typeof getStripeStorefrontConfig>> | null,
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
      // Feature 049 — active countries for the address country picker.
      listCountries({ locale }).catch(() => []),
      // Feature 049 — Stripe display mode drives whether checkout shows one
      // collapsed "Stripe" option (redirect) or the inline sub-methods.
      getStripeStorefrontConfig().catch(() => null),
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
  const [
    cartResult,
    addresses,
    deliveryMethods,
    paymentMethodsRaw,
    creditLimit,
    me,
    defaults,
    countries,
    stripeConfig,
  ] = loaded;
  if (cartResult.newAnonCookie) await setAnonCartCookie(cartResult.newAnonCookie);
  const cart = cartResult.cart;
  const canTransact = me?.organization?.canTransact ?? true;
  // Hide the credit_limit-kind method(s) when the buyer's organization
  // hasn't been granted a limit, or when the cart total clearly exceeds
  // the available credit. The backend rejects an over-limit reservation
  // anyway, but a friendlier UX is to drop the option early.
  const creditAvailable = creditLimit?.availableAmount ?? 0;
  const cartTotal = cart.subtotal.amount;
  let paymentMethods = paymentMethodsRaw.filter((m) => {
    // Defensive: the backend already only returns active methods, but never
    // offer an inactive method at checkout even if one slips through (feature
    // 049 — an inactive method must not be selectable).
    if (m.status !== 'active') return false;
    if (m.kind !== 'credit_limit') return true;
    if (!creditLimit) return false;
    return creditAvailable >= cartTotal;
  });

  // Feature 049 — in Stripe "redirect" display mode the whole payment happens on
  // Stripe's hosted page, so collapse the seeded per-method Stripe rows (card,
  // BLIK, P24, wallets) into a single "Stripe" option with an informational
  // note. In "inline" mode the sub-methods stay as-is.
  if (stripeConfig?.active && stripeConfig.displayMode === 'redirect') {
    const stripeMethods = paymentMethods.filter((m) => m.adapter === 'stripe');
    if (stripeMethods.length > 0) {
      const nonStripe = paymentMethods.filter((m) => m.adapter !== 'stripe');
      // Prefer the card row as the backing method; the concrete method is chosen
      // on Stripe's page anyway (the Checkout Session offers all enabled types).
      const primary = stripeMethods.find((m) => m.code === 'stripe_card') ?? stripeMethods[0]!;
      const collapsed = {
        ...primary,
        name: { default: 'Stripe', 'en-US': 'Stripe', 'pl-PL': 'Stripe' },
        rendererKey: STRIPE_REDIRECT_RENDERER_KEY,
      };
      paymentMethods = [...nonStripe, collapsed];
    }
  }

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

  // Feature 049 — inline Stripe: the exact Payment Element amount (incl.
  // per-product VAT) is computed server-side. Resolve an initial amount for the
  // default delivery + payment selection; the client refreshes it via a server
  // action as the buyer changes the selection. No pricing math on the client.
  const inlineStripe =
    !!stripeConfig?.active &&
    stripeConfig.displayMode === 'inline' &&
    paymentMethods.some((m) => m.adapter === 'stripe');
  let initialStripeAmountMinor = Math.max(
    1,
    Math.round((cart.grandTotal?.amount ?? cart.subtotal.amount) * 100),
  );
  if (inlineStripe) {
    const initDeliveryId =
      (defaults?.deliveryMethodId && deliveryMethods.some((m) => m.id === defaults.deliveryMethodId)
        ? defaults.deliveryMethodId
        : deliveryMethods[0]?.id) ?? '';
    const initPaymentId =
      (defaults?.paymentMethodId && paymentMethods.some((m) => m.id === defaults.paymentMethodId)
        ? defaults.paymentMethodId
        : paymentMethods[0]?.id) ?? '';
    if (initDeliveryId && initPaymentId) {
      try {
        const t = await previewOrderTotal(session, {
          deliveryMethodId: initDeliveryId,
          paymentMethodId: initPaymentId,
        });
        initialStripeAmountMinor = Math.max(1, Math.round(t.total * 100));
      } catch {
        // Keep the fallback estimate; the client refreshes to the exact amount.
      }
    }
  }

  // Feature 036 (US2) — the buyer may pick a saved address or enter a new one,
  // so an empty saved-address book no longer blocks checkout.
  const deliveryAddrs = addresses.filter((a) => a.kind === 'delivery');
  const billingAddrs = addresses.filter((a) => a.kind === 'billing');

  return (
    <div className="b2b-auth max-w-[720px]">
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
          countries={countries}
          preferredShippingAddressId={defaults?.shippingAddressId ?? null}
          preferredBillingAddressId={defaults?.billingAddressId ?? null}
          organizationName={me?.organization?.legalName || me?.organization?.name || null}
          organizationTaxId={me?.organization?.taxId ?? null}
        />

        <ShippingMethods methods={deliveryMethods} preferredId={defaults?.deliveryMethodId ?? null} />

        {inlineStripe && stripeConfig ? (
          <StripeInlinePaymentMethods
            methods={paymentMethods}
            currency={cart.subtotal.currency}
            preferredId={defaults?.paymentMethodId ?? null}
            publishableKey={stripeConfig.publishableKey}
            initialAmountMinor={initialStripeAmountMinor}
            prepareAction={submitStripeInlineAction}
            previewAction={previewTotalAction}
          />
        ) : (
          <PaymentMethods
            methods={paymentMethods}
            currency={cart.subtotal.currency}
            preferredId={defaults?.paymentMethodId ?? null}
          />
        )}

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

/**
 * Feature 036 (US2) — resolve the order payload from the checkout form: saved
 * address ids are used as-is; newly entered addresses are created in the org
 * address book first and referenced by their returned id. Shared by the plain
 * submit and the Stripe-inline submit (feature 049, item 6).
 */
async function buildPlaceOrderPayload(
  session: string,
  formData: FormData,
): Promise<Parameters<typeof placeOrder>[1]> {
  const field = (name: string): string => ((formData.get(name) as string | null) ?? '').trim();
  async function resolveAddress(kind: 'delivery' | 'billing', prefix: string): Promise<string> {
    const savedId = field(`${prefix}AddressId`);
    if (savedId) return savedId;
    const created = await createAddress(session, {
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
  const promo = (formData.get('promotionCode') as string | null) || undefined;
  const note = (formData.get('customerNote') as string | null) || undefined;
  const deliveryAddressId = await resolveAddress('delivery', 'delivery');
  const billingAddressId =
    formData.get('billingSameAsShipping') != null
      ? deliveryAddressId
      : await resolveAddress('billing', 'billing');
  const billingCompanyName = field('billingCompanyName');
  const billingTaxId = field('billingTaxId');
  return {
    deliveryAddressId,
    billingAddressId,
    deliveryMethodId: (formData.get('deliveryMethodId') as string) ?? '',
    paymentMethodId: (formData.get('paymentMethodId') as string) ?? '',
    ...(promo ? { promotionCode: promo } : {}),
    ...(note ? { customerNote: note } : {}),
    ...(billingCompanyName ? { billingCompanyName } : {}),
    ...(billingTaxId ? { billingTaxId } : {}),
  };
}

async function submitAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/checkout');

  let order;
  try {
    order = await placeOrder(session, await buildPlaceOrderPayload(session, formData));
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
  // Feature 049 — a Stripe method in the inline display mode returns no
  // redirect (nextAction `none`); collect payment on the inline Payment Element
  // step before landing on the Success Page.
  if (order.paymentMethod?.code?.startsWith('stripe_')) {
    redirect(`/checkout/pay?id=${order.id}`);
  }
  redirect(`/checkout/success?id=${order.id}`);
}

/**
 * Feature 049 (item 6) — Stripe inline submit. Places the order (creating the
 * PaymentIntent) and returns its client secret so the on-page Payment Element
 * can confirm the payment, all on the checkout page. Errors are returned (not
 * redirected) so the client can surface them or fall back to `/checkout/pay`.
 */
async function submitStripeInlineAction(formData: FormData): Promise<StripeInlinePrepareResult> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return { ok: false, error: 'Your session has expired. Please sign in again.' };

  let order;
  try {
    order = await placeOrder(session, await buildPlaceOrderPayload(session, formData));
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not place the order.';
    return { ok: false, error: message };
  }
  if (order.nextAction?.kind === 'redirect_to_gateway') {
    // Not expected in inline mode; hand the order to the pay step as a fallback.
    return { ok: false, error: 'This payment must be completed on the gateway.', orderId: order.id };
  }
  try {
    const secret = await getStripeClientSecret(session, order.id);
    return {
      ok: true,
      orderId: order.id,
      clientSecret: secret.clientSecret,
      publishableKey: secret.publishableKey,
    };
  } catch {
    // Order exists but the client secret couldn't be fetched → the client falls
    // back to the dedicated pay step.
    return { ok: false, error: 'Could not start the payment.', orderId: order.id };
  }
}

/**
 * Feature 049 — server-computed order-total preview for the inline Stripe
 * Payment Element. Keeps all pricing (per-product VAT, delivery, surcharge,
 * discount) on the server; the client only displays the returned amount.
 */
async function previewTotalAction(input: {
  deliveryMethodId: string;
  paymentMethodId: string;
  billingAddressId?: string;
}): Promise<{ ok: true; amountMinor: number; currency: string } | { ok: false }> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return { ok: false };
  try {
    const t = await previewOrderTotal(session, input);
    return { ok: true, amountMinor: Math.max(1, Math.round(t.total * 100)), currency: t.currency };
  } catch {
    return { ok: false };
  }
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
