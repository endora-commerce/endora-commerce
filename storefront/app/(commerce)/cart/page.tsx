import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getCart,
  getCartUpsells,
  removeCartItem,
  updateCartItem,
  touchCart,
  applyCartCoupon,
  clearCartCoupon,
  convertCartToQuoteRequest,
  submitCartForApproval,
  saveCartItemToShoppingList,
  type CartCookieJar,
  type CartItem,
  type CartSummary,
} from '../../../lib/api/cart';
import { listShoppingLists } from '../../../lib/api/shopping-lists';
import { getServerContext } from '../../../lib/server-context';
import {
  getAnonCartCookie,
  getSessionCookie,
  setAnonCartCookie,
} from '../../../lib/session';
import { StorefrontApiError } from '../../../lib/api/client';
import { OrganizationModerationBanner } from '../../../components/OrganizationModerationBanner';
import { CartLine, type CartLineViewModel } from '../../../components/CartLine';
import { CartTotals } from '../../../components/CartTotals';
import { UpsellStrip } from '../../../components/UpsellStrip';
import { CartCouponInput } from '../../../components/CartCouponInput';
import { CartConvertButtons } from '../../../components/CartConvertButtons';
import { CartDroppedLinesBanner } from '../../../components/CartDroppedLinesBanner';
import { CartApprovalBanner } from '../../../components/CartApprovalBanner';
import { getMe } from '../../../lib/api/account';

/**
 * Cart page (feature 027 T045 / T046 / T059 / T074 / T096).
 *
 * Composes the full feature-027 surface on top of the foundation cart:
 *   - <CartApprovalBanner /> when the buyer's Org policy is on
 *   - <CartDroppedLinesBanner /> after a conversion (URL param drives it)
 *   - <CartLine /> per row (qty / remove / save-to-list)
 *   - <CartTotals /> with optional discount
 *   - <CartCouponInput /> for coupon apply / clear
 *   - <CartConvertButtons /> for Cart → Quote Request
 *   - <UpsellStrip /> from Catalog `up_sell` product links
 *   - primary CTA derived from `cart.primaryCta` (FR-024)
 *
 * On mount, POSTs `/api/v1/cart/touch` so an `abandoned` cart returns
 * to `active` (FR-002). Anonymous shoppers are supported via the
 * `b2b_cart_anon` cookie minted by the backend on the first add.
 */

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    couponError?: string;
    couponShortfall?: string;
    couponShortfallCurrency?: string;
    qrCreated?: string;
    listAdded?: string;
    conversionDropped?: string;
  }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const jar = await readJar();

  // Activity bookkeeping — reactivates an abandoned cart. Never blocks
  // the render (the backend route is a 200/no-op when no cart exists).
  await touchCart(jar).catch(() => undefined);

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
  // Heuristic until the backend `/me` payload exposes
  // `requiresCartApproval`: any non-`not_required` approval state on
  // the cart means the policy was on at submission time. A buyer with
  // a brand-new cart will not see the "Submit for approval" CTA yet
  // — they need to start checkout first; the resulting 423 will
  // surface the policy. Tracked as a follow-up against /me.
  const requiresApproval =
    cart.approvalStatus !== undefined && cart.approvalStatus !== 'not_required';

  // Feature 027 US1 — up-sell strip. The endpoint is empty for anonymous
  // carts (no organization → no resolver context); silently fall back to
  // an empty list.
  const { locale } = await getServerContext();
  const upsells = cart.items.length > 0 ? await getCartUpsells(jar).catch(() => []) : [];

  if (cart.items.length === 0) {
    return (
      <div className="b2b-auth">
        <h1>{STRINGS(locale).heading}</h1>
        <p>{STRINGS(locale).empty}</p>
        <p>
          <Link href="/catalog">{STRINGS(locale).browseCatalog}</Link>
        </p>
      </div>
    );
  }

  const strings = STRINGS(locale);
  const primaryCta = cart.primaryCta ?? (canTransact ? 'checkout' : 'blocked_by_organization');
  const submitForApprovalNeeded = requiresApproval && cart.approvalStatus === 'not_required';

  return (
    <div className="b2b-auth" style={{ maxWidth: 960 }}>
      <h1>{strings.heading}</h1>

      <OrganizationModerationBanner
        status={me?.organization?.status}
        message={me?.organization?.moderationMessage ?? null}
      />

      {/* Feature 027 — approval-state banner (US4). */}
      {cart.approvalStatus ? (
        <CartApprovalBanner
          approvalStatus={cart.approvalStatus}
          policyOn={requiresApproval}
          rejectedReason={null}
          submitForApprovalAction={submitForApprovalAction}
          strings={strings.approvalBannerComponent}
        />
      ) : null}

      {/* Feature 027 — banner emitted on conversion redirects. */}
      {params.qrCreated ? (
        <p className="b2b-auth__hint" role="status">
          {strings.banner.qrCreated}
        </p>
      ) : null}
      {params.listAdded ? (
        <p className="b2b-auth__hint" role="status">
          {strings.banner.listAdded(params.listAdded)}
        </p>
      ) : null}
      {params.conversionDropped === '1' && (cart.droppedLines?.length ?? 0) > 0 ? (
        <CartDroppedLinesBanner
          droppedLines={(cart.droppedLines ?? []).map((d) => ({
            productId: d.productId,
            productName: d.productName,
            reason: d.reason,
          }))}
          strings={strings.dropped}
        />
      ) : null}

      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}

      <ul
        className="b2b-cart__lines"
        style={{ listStyle: 'none', padding: 0, margin: '1rem 0' }}
      >
        {cart.items.map((it) => (
          <CartLine
            key={it.id}
            line={toViewModel(it)}
            updateAction={updateAction}
            removeAction={removeAction}
            saveToListAction={saveToListAction}
            strings={strings.line}
          />
        ))}
      </ul>

      <CartTotals
        subtotal={cart.subtotal}
        discount={cart.discount ?? null}
        grandTotal={cart.grandTotal ?? cart.subtotal}
        strings={strings.totals}
      />

      <CartCouponInput
        appliedCode={cart.discount?.code ?? null}
        droppedOnRead={cart.couponDroppedThisRead ?? null}
        applyError={
          params.couponError
            ? {
                reason: params.couponError as
                  | 'invalid_code'
                  | 'expired'
                  | 'below_min_spend'
                  | 'wrong_channel'
                  | 'wrong_customer_group'
                  | 'wrong_organization'
                  | 'coupon_format_invalid',
                ...(params.couponShortfall && params.couponShortfallCurrency
                  ? {
                      shortfall: {
                        amount: Number(params.couponShortfall),
                        currency: params.couponShortfallCurrency,
                      },
                    }
                  : {}),
              }
            : null
        }
        applyAction={applyCouponAction}
        clearAction={clearCouponAction}
        strings={strings.coupon}
      />

      <p className="b2b-auth__hint">{strings.taxesNote}</p>

      <div className="b2b-auth__actions" style={{ display: 'flex', gap: '0.75rem' }}>
        <PrimaryCtaButton
          cta={primaryCta}
          submitForApprovalNeeded={submitForApprovalNeeded}
          canTransact={canTransact}
          moderationMessage={me?.organization?.moderationMessage ?? null}
          submitAction={submitForApprovalAction}
          strings={strings.cta}
        />
        <CartConvertButtons
          disabled={cart.items.length === 0}
          disabledReason={null}
          convertToQrAction={convertToQrAction}
          strings={strings.convertButtons}
        />
      </div>

      <UpsellStrip upsells={upsells} strings={strings.upsells} />
    </div>
  );
}

/** Maps a CartItem to the view-model the CartLine component expects. */
function toViewModel(it: CartItem): CartLineViewModel {
  return {
    id: it.id,
    productId: it.productId,
    variantId: it.variantId,
    productName: it.productId, // backend doesn't surface a product name yet
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    lineTotal: it.lineTotal ?? {
      amount: it.unitPrice.amount * it.quantity,
      currency: it.unitPrice.currency,
    },
    ...(it.unavailable !== undefined ? { unavailable: it.unavailable } : {}),
    ...(it.unavailableReason !== undefined ? { unavailableReason: it.unavailableReason } : {}),
  };
}

/**
 * Renders the page's primary CTA. Source of truth is the backend's
 * `cart.primaryCta` field; the fallback covers anonymous carts (the
 * backend can't compute primaryCta without an org context). Feature
 * 027 T096.
 */
function PrimaryCtaButton({
  cta,
  submitForApprovalNeeded,
  canTransact,
  moderationMessage,
  submitAction,
  strings,
}: {
  cta: NonNullable<CartSummary['primaryCta']>;
  submitForApprovalNeeded: boolean;
  canTransact: boolean;
  moderationMessage: string | null;
  submitAction: (formData: FormData) => Promise<void>;
  strings: {
    checkout: string;
    submitForApproval: string;
    awaitingApproval: string;
    blockedByOrganization: string;
  };
}): ReactNode {
  if (!canTransact || cta === 'blocked_by_organization') {
    return (
      <button
        type="button"
        disabled
        aria-disabled
        title={moderationMessage ?? strings.blockedByOrganization}
        style={{ opacity: 0.6, cursor: 'not-allowed' }}
      >
        {strings.blockedByOrganization}
      </button>
    );
  }
  if (cta === 'awaiting_approval') {
    return (
      <button type="button" disabled aria-disabled style={{ opacity: 0.6 }}>
        {strings.awaitingApproval}
      </button>
    );
  }
  if (submitForApprovalNeeded || cta === 'submit_for_approval') {
    return (
      <form action={submitAction}>
        <button type="submit">{strings.submitForApproval}</button>
      </form>
    );
  }
  // cta === 'checkout'
  return (
    <Link href="/checkout">
      <button type="button">{strings.checkout}</button>
    </Link>
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

async function saveToListAction(formData: FormData): Promise<void> {
  'use server';
  const itemId = (formData.get('itemId') as string) ?? '';
  const jar = await readJar();
  if (!jar.session) {
    redirect('/cart?error=' + encodeURIComponent('Sign in to save to a list.'));
  }
  try {
    const lists = await listShoppingLists(jar.session ?? '').catch(() => []);
    if (lists.length === 0) {
      redirect(
        '/cart?error=' +
          encodeURIComponent(
            'You have no shopping list yet. Create one from the account menu.',
          ),
      );
    }
    // No modal picker yet — save to the most-recently-updated list and
    // tell the buyer which one. A modal picker is a follow-up.
    const target = lists[0]!;
    await saveCartItemToShoppingList(jar, itemId, target.id);
    redirect(`/cart?listAdded=${encodeURIComponent(target.name)}`);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not save line to list.';
    redirect(`/cart?error=${encodeURIComponent(message)}`);
  }
}

async function applyCouponAction(formData: FormData): Promise<void> {
  'use server';
  const code = ((formData.get('code') as string) ?? '').trim().toUpperCase();
  if (!code) redirect('/cart?couponError=coupon_format_invalid');
  try {
    const result = await applyCartCoupon(await readJar(), code);
    if (result.outcome === 'rejected') {
      const qs = new URLSearchParams({ couponError: result.reason });
      if (result.shortfall) {
        qs.set('couponShortfall', String(result.shortfall.amount));
        qs.set('couponShortfallCurrency', result.shortfall.currency);
      }
      redirect(`/cart?${qs.toString()}`);
    }
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not apply coupon.';
    redirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  redirect('/cart');
}

async function clearCouponAction(): Promise<void> {
  'use server';
  try {
    await clearCartCoupon(await readJar());
  } catch {
    // Idempotent — silent fall-through is the spec.
  }
  redirect('/cart');
}

async function convertToQrAction(formData: FormData): Promise<void> {
  'use server';
  const note = ((formData.get('note') as string) ?? '').trim() || null;
  try {
    const result = await convertCartToQuoteRequest(await readJar(), note);
    redirect(
      `/account/quote-requests/${result.quoteRequestSlug}?from=cart`,
    );
  } catch (err) {
    const message =
      err instanceof StorefrontApiError
        ? err.message
        : 'Could not convert cart to a quote request.';
    redirect(`/cart?error=${encodeURIComponent(message)}`);
  }
}

async function submitForApprovalAction(): Promise<void> {
  'use server';
  try {
    await submitCartForApproval(await readJar());
  } catch (err) {
    const message =
      err instanceof StorefrontApiError
        ? err.message
        : 'Could not submit cart for approval.';
    redirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  redirect('/cart');
}

/**
 * Inline string catalogue keyed by locale. Mirrors the keys in
 * `backend/src/modules/carts/i18n/{en,pl}.json` so the storefront copy
 * and the backend error messages stay coherent. Once the storefront's
 * shared MessageKey catalogue grows a `cart.*` namespace these can
 * migrate.
 */
function STRINGS(locale: string): {
  heading: string;
  empty: string;
  browseCatalog: string;
  taxesNote: string;
  line: import('../../../components/CartLine').CartLineViewModel extends never
    ? never
    : Parameters<typeof CartLine>[0]['strings'];
  totals: Parameters<typeof CartTotals>[0]['strings'];
  coupon: Parameters<typeof CartCouponInput>[0]['strings'];
  convertButtons: Parameters<typeof CartConvertButtons>[0]['strings'];
  dropped: Parameters<typeof CartDroppedLinesBanner>[0]['strings'];
  approvalBannerComponent: Parameters<typeof CartApprovalBanner>[0]['strings'];
  upsells: Parameters<typeof UpsellStrip>[0]['strings'];
  banner: {
    qrCreated: string;
    listAdded: (listName: string) => string;
  };
  cta: {
    checkout: string;
    submitForApproval: string;
    awaitingApproval: string;
    blockedByOrganization: string;
  };
} {
  const pl = locale.startsWith('pl');
  if (pl) {
    return {
      heading: 'Koszyk',
      empty: 'Twój koszyk jest pusty.',
      browseCatalog: 'Przejdź do katalogu',
      taxesNote: 'Podatki i koszty dostawy są naliczane w kasie.',
      line: {
        qtyLabel: 'Ilość',
        unitPriceLabel: 'Cena jednostkowa',
        lineTotalLabel: 'Wartość pozycji',
        removeLabel: 'Usuń',
        saveToListLabel: 'Zapisz na liście',
        unavailable: {
          out_of_stock: 'Brak na stanie.',
          not_purchasable: 'Niedostępny.',
          no_price_in_customer_list: 'Brak ceny dla Twojego konta.',
        },
      },
      totals: {
        subtotalLabel: 'Suma częściowa',
        discountLabel: (code: string) => `Rabat (${code})`,
        grandTotalLabel: 'Razem',
      },
      coupon: {
        label: 'Kupon rabatowy',
        placeholder: 'Wpisz kod kuponu',
        applyButton: 'Zastosuj',
        clearButton: 'Usuń kupon',
        activeCode: (code: string) => `Kupon ${code} jest aktywny.`,
        autoDropped: (code: string) =>
          `Kupon ${code} nie obowiązuje już dla tego koszyka i został usunięty.`,
        rejectedReason: (reason: string, shortfall?: { amount: number; currency: string }) => {
          const labels: Record<string, string> = {
            invalid_code: 'Nieprawidłowy kod kuponu.',
            expired: 'Kod kuponu wygasł.',
            below_min_spend: shortfall
              ? `Dodaj jeszcze ${shortfall.amount.toFixed(2)} ${shortfall.currency}, aby odblokować ten kupon.`
              : 'Dodaj więcej produktów, aby odblokować ten kupon.',
            wrong_channel: 'Ten kupon nie obowiązuje w tym kanale sprzedaży.',
            wrong_customer_group: 'Ten kupon nie jest dostępny dla Twojej grupy klientów.',
            wrong_organization: 'Ten kupon nie jest dostępny dla Twojej organizacji.',
            coupon_format_invalid: "Kupony mogą zawierać tylko duże litery, cyfry, '-' i '_'.",
          };
          return labels[reason] ?? 'Nie udało się zastosować kuponu.';
        },
      },
      convertButtons: {
        convertToQrLabel: 'Zamień na zapytanie ofertowe',
        convertToQrHint: 'Wyślij ten koszyk do działu sprzedaży jako zapytanie ofertowe.',
      },
      dropped: {
        heading: 'Niektóre pozycje zostały pominięte',
        intro: 'Następujące produkty nie zostały dodane, ponieważ:',
        reasonNotPurchasable: 'produkt jest niedostępny',
        reasonOutOfStock: 'brak na stanie',
        reasonNoPriceInCustomerList: 'brak ceny dla Twojego konta',
        reasonRemovedByConversion: 'pominięto podczas konwersji',
      },
      approvalBannerComponent: {
        pending: 'Twój koszyk oczekuje na akceptację administratora organizacji.',
        approved: 'Twój koszyk został zaakceptowany i jest gotowy do realizacji.',
        rejected: (reason: string | null) =>
          reason
            ? `Twój koszyk został odrzucony przez administratora organizacji. Powód: ${reason}`
            : 'Twój koszyk został odrzucony przez administratora organizacji.',
        policyOn: 'Twoja organizacja wymaga akceptacji koszyka przed realizacją.',
        submitButton: 'Zgłoś do akceptacji',
      },
      upsells: {
        heading: 'Możesz też potrzebować',
        noPriceLabel: 'Cena na zapytanie',
      },
      banner: {
        qrCreated: 'Twój koszyk został wysłany do działu sprzedaży jako nowe zapytanie ofertowe.',
        listAdded: (listName: string) =>
          `Pozycja została zapisana na liście „${listName}".`,
      },
      cta: {
        checkout: 'Przejdź do kasy',
        submitForApproval: 'Zgłoś do akceptacji',
        awaitingApproval: 'Oczekuje na akceptację',
        blockedByOrganization: 'Kasa niedostępna',
      },
    };
  }
  return {
    heading: 'Your cart',
    empty: 'Your cart is empty.',
    browseCatalog: 'Browse the catalog',
    taxesNote: 'Taxes and delivery charges are calculated at checkout.',
    line: {
      qtyLabel: 'Quantity',
      unitPriceLabel: 'Unit price',
      lineTotalLabel: 'Line total',
      removeLabel: 'Remove',
      saveToListLabel: 'Save to list',
      unavailable: {
        out_of_stock: 'Out of stock.',
        not_purchasable: 'No longer available.',
        no_price_in_customer_list: 'Pricing unavailable for your account.',
      },
    },
    totals: {
      subtotalLabel: 'Subtotal',
      discountLabel: (code: string) => `Discount (${code})`,
      grandTotalLabel: 'Total',
    },
    coupon: {
      label: 'Coupon code',
      placeholder: 'Enter coupon code',
      applyButton: 'Apply',
      clearButton: 'Remove coupon',
      activeCode: (code: string) => `Coupon ${code} is active.`,
      autoDropped: (code: string) =>
        `The coupon ${code} is no longer valid for this cart and has been removed.`,
      rejectedReason: (reason: string, shortfall?: { amount: number; currency: string }) => {
        const labels: Record<string, string> = {
          invalid_code: 'This coupon code is invalid.',
          expired: 'This coupon code has expired.',
          below_min_spend: shortfall
            ? `Add ${shortfall.amount.toFixed(2)} ${shortfall.currency} more to unlock this coupon.`
            : 'Add more to your cart to unlock this coupon.',
          wrong_channel: 'This coupon does not apply in this sales channel.',
          wrong_customer_group: 'This coupon is not available for your customer group.',
          wrong_organization: 'This coupon is not available for your organization.',
          coupon_format_invalid: "Coupon codes use only uppercase letters, digits, '-' and '_'.",
        };
        return labels[reason] ?? 'This coupon code could not be applied.';
      },
    },
    convertButtons: {
      convertToQrLabel: 'Convert to quote request',
      convertToQrHint: 'Send this cart to sales as a quote request.',
    },
    dropped: {
      heading: 'Some lines were skipped',
      intro: 'These products were not added because:',
      reasonNotPurchasable: 'no longer available',
      reasonOutOfStock: 'out of stock',
      reasonNoPriceInCustomerList: 'no price available',
      reasonRemovedByConversion: 'skipped during conversion',
    },
    approvalBannerComponent: {
      pending: 'Your cart is awaiting approval by an organization administrator.',
      approved: 'Your cart has been approved and is ready for checkout.',
      rejected: (reason: string | null) =>
        reason
          ? `Your cart was rejected by an organization administrator. Reason: ${reason}`
          : 'Your cart was rejected by an organization administrator.',
      policyOn: 'Your organization requires cart approval before checkout.',
      submitButton: 'Submit for approval',
    },
    upsells: {
      heading: 'You might also need',
      noPriceLabel: 'Price on request',
    },
    banner: {
      qrCreated: "We've sent your cart to sales as a new quote request.",
      listAdded: (listName: string) => `Saved line to your "${listName}" list.`,
    },
    cta: {
      checkout: 'Proceed to checkout',
      submitForApproval: 'Submit for approval',
      awaitingApproval: 'Awaiting approval',
      blockedByOrganization: 'Checkout unavailable',
    },
  };
}
