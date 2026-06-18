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
 * Cart page — Industria-themed (feature 027 T045 / T046 / T059 / T074 / T096).
 *
 * Layout mirrors the Industria checkout step-0 in
 * `specs/b2b-platform-storefront-ui/project/industria-views-checkout.jsx`:
 * a two-column grid with the cart card on the left (lines + footer
 * actions) and a sticky `.cart-summary` aside on the right (totals +
 * coupon + delivery hint + checkout CTA).
 *
 * Touches `POST /api/v1/cart/touch` on mount (reactivates abandoned
 * carts per FR-002).
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

  const session = await getSessionCookie();
  const me = session
    ? await getMe(session).catch(() => null)
    : null;
  const canTransact = me?.organization?.canTransact ?? true;
  // Heuristic until the backend `/me` payload exposes
  // `requiresCartApproval`: any non-`not_required` approval state on
  // the cart means the policy was on at submission time.
  const requiresApproval =
    cart.approvalStatus !== undefined && cart.approvalStatus !== 'not_required';

  const { locale } = await getServerContext();
  const upsells = cart.items.length > 0 ? await getCartUpsells(jar).catch(() => []) : [];

  const strings = STRINGS(locale);

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-[1360px] px-[24px]">
        <Breadcrumbs strings={strings.breadcrumbs} />
        <div className="rounded-md border border-line bg-surface px-[24px] py-[48px] text-center">
          <h1 className="m-0 mb-2 text-[22px] font-semibold text-fg">{strings.heading}</h1>
          <p className="m-0 mb-[18px] text-[14px] text-muted">{strings.empty}</p>
          <Link href="/catalog" className="btn btn--dark">
            {strings.browseCatalog}
          </Link>
        </div>
      </div>
    );
  }

  const primaryCta = cart.primaryCta ?? (canTransact ? 'checkout' : 'blocked_by_organization');
  const submitForApprovalNeeded = requiresApproval && cart.approvalStatus === 'not_required';

  return (
    <div className="mx-auto max-w-[1360px] px-[24px] pt-[8px] pb-[64px]">
      <Breadcrumbs strings={strings.breadcrumbs} />
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[24px] font-semibold tracking-[-0.02em] text-fg">{strings.heading}</h1>
          <p className="mt-1 text-[13px] text-muted">{strings.subheading(cart.items.length)}</p>
        </div>
      </header>

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
          strings={strings.approvalBanner}
        />
      ) : null}

      {/* Conversion-redirect banners */}
      {params.qrCreated ? (
        <div className="mb-3 rounded-md border border-[#bbf7d0] bg-[#ecfdf3] px-[14px] py-[10px] text-[13px] text-ok" role="status">
          {strings.banner.qrCreated}
        </div>
      ) : null}
      {params.listAdded ? (
        <div className="mb-3 rounded-md border border-[#bbf7d0] bg-[#ecfdf3] px-[14px] py-[10px] text-[13px] text-ok" role="status">
          {strings.banner.listAdded(params.listAdded)}
        </div>
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

      {params.error ? (
        <div className="mb-3 rounded-md border border-[#fecaca] bg-[#fef2f2] px-[14px] py-[10px] text-[13px] text-[#b91c1c]" role="alert">
          {params.error}
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_380px] items-start gap-8 max-[960px]:grid-cols-1">
        <div>
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-[22px] py-[18px]">
              <h2 className="m-0 text-[18px] font-semibold text-fg">{strings.cardHeading}</h2>
              <span className="font-mono text-[12px] text-muted">
                {strings.itemCount(cart.items.length)}
              </span>
            </div>

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

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-[22px] py-[18px]">
              <Link href="/catalog" className="btn btn--ghost">
                ← {strings.continueShopping}
              </Link>
              <CartConvertButtons
                disabled={cart.items.length === 0}
                disabledReason={null}
                convertToQrAction={convertToQrAction}
                strings={strings.convertButtons}
              />
            </div>
          </div>

          <UpsellStrip upsells={upsells} strings={strings.upsells} />
        </div>

        <aside className="sticky top-[96px] rounded-md border border-line bg-surface p-[20px]">
          <h3 className="m-0 mb-[14px] text-[14px] font-semibold text-fg">{strings.summary.heading}</h3>

          <CartTotals
            subtotal={cart.subtotal}
            discount={cart.discount ?? null}
            grandTotal={cart.grandTotal ?? cart.subtotal}
            itemCount={cart.items.length}
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

          <div className="mt-4">
            <PrimaryCtaButton
              cta={primaryCta}
              authenticated={me !== null}
              submitForApprovalNeeded={submitForApprovalNeeded}
              canTransact={canTransact}
              moderationMessage={me?.organization?.moderationMessage ?? null}
              submitAction={submitForApprovalAction}
              strings={strings.cta}
            />
          </div>

          <div className="mt-[14px] flex items-start gap-2 border-t border-line pt-[14px] text-[12px] text-muted [&_svg]:mt-[2px] [&_svg]:h-[14px] [&_svg]:w-[14px] [&_svg]:shrink-0 [&_svg]:text-ok">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>{strings.taxesNote}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Renders a Home / Cart breadcrumb above the main heading. */
function Breadcrumbs({
  strings,
}: {
  strings: { home: string; cart: string };
}): ReactNode {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        fontSize: 13,
        color: 'var(--ink-500)',
        margin: '8px 0 16px',
        display: 'flex',
        gap: 6,
      }}
    >
      <Link href="/" style={{ color: 'inherit' }}>
        {strings.home}
      </Link>
      <span aria-hidden="true">/</span>
      <span style={{ color: 'var(--ink-900)' }}>{strings.cart}</span>
    </nav>
  );
}

/** Maps a CartItem to the view-model the CartLine component expects. */
function toViewModel(it: CartItem): CartLineViewModel {
  return {
    id: it.id,
    productId: it.productId,
    variantId: it.variantId,
    // Backend resolves `productName` from Product.name against the
    // request's Accept-Language. Feature 043 — prefer `displayName`, which
    // already appends the packaging-unit name (e.g. "… (Paleta)"). When
    // unknown (race with a deleted product) fall back to SKU then productId.
    productName: it.displayName || it.productName || it.productSku || it.productId,
    sku: it.productSku ?? null,
    productSlug: it.productSlug ?? null,
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
  authenticated,
  submitForApprovalNeeded,
  canTransact,
  moderationMessage,
  submitAction,
  strings,
}: {
  cta: NonNullable<CartSummary['primaryCta']>;
  /** Whether the buyer has a valid customer session (resolved `/me`). */
  authenticated: boolean;
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
        className="btn btn--dark btn--lg btn--block"
        disabled
        aria-disabled
        title={moderationMessage ?? strings.blockedByOrganization}
        style={{ opacity: 0.55, cursor: 'not-allowed' }}
      >
        {strings.blockedByOrganization}
      </button>
    );
  }
  if (cta === 'awaiting_approval') {
    return (
      <button
        type="button"
        className="btn btn--ghost btn--lg btn--block"
        disabled
        aria-disabled
      >
        {strings.awaitingApproval}
      </button>
    );
  }
  if (submitForApprovalNeeded || cta === 'submit_for_approval') {
    return (
      <form action={submitAction}>
        <button type="submit" className="btn btn--dark btn--lg btn--block">
          {strings.submitForApproval}
        </button>
      </form>
    );
  }
  // cta === 'checkout'. /checkout requires a valid customer session, so when
  // the buyer isn't authenticated (no session, or a stale/expired session that
  // `/me` rejected) route them through login first — preserving the cart and
  // returning to checkout via `?next` — instead of letting /checkout bounce
  // them to login unexpectedly.
  const checkoutHref = authenticated ? '/checkout' : '/login?next=/checkout';
  return (
    <Link href={checkoutHref} className="btn btn--dark btn--lg btn--block">
      {strings.checkout} →
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
    redirect(`/quote-requests/${result.quoteRequestSlug}?from=cart`);
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

/* === Inline locale string catalogue =================================== */

function STRINGS(locale: string): {
  heading: string;
  subheading: (n: number) => string;
  empty: string;
  browseCatalog: string;
  cardHeading: string;
  itemCount: (n: number) => string;
  continueShopping: string;
  taxesNote: string;
  breadcrumbs: { home: string; cart: string };
  summary: { heading: string };
  line: Parameters<typeof CartLine>[0]['strings'];
  totals: Parameters<typeof CartTotals>[0]['strings'];
  coupon: Parameters<typeof CartCouponInput>[0]['strings'];
  convertButtons: Parameters<typeof CartConvertButtons>[0]['strings'];
  dropped: Parameters<typeof CartDroppedLinesBanner>[0]['strings'];
  approvalBanner: Parameters<typeof CartApprovalBanner>[0]['strings'];
  upsells: Parameters<typeof UpsellStrip>[0]['strings'];
  banner: { qrCreated: string; listAdded: (listName: string) => string };
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
      heading: 'Twój koszyk',
      subheading: (n: number) =>
        n === 1 ? '1 pozycja gotowa do kasy.' : `${n} pozycji gotowych do kasy.`,
      empty: 'Twój koszyk jest pusty.',
      browseCatalog: 'Przejdź do katalogu',
      cardHeading: 'Koszyk',
      itemCount: (n: number) => (n === 1 ? '1 pozycja' : `${n} pozycji`),
      continueShopping: 'Kontynuuj zakupy',
      taxesNote: 'Podatki i koszty dostawy zostaną naliczone w następnym kroku.',
      breadcrumbs: { home: 'Strona główna', cart: 'Koszyk' },
      summary: { heading: 'Podsumowanie' },
      line: {
        qtyLabel: 'Ilość',
        unitPriceLabel: 'Cena jednostkowa',
        lineTotalLabel: 'Wartość pozycji',
        removeLabel: 'Usuń',
        saveToListLabel: 'Zapisz na listę',
        updateLabel: 'Zaktualizuj',
        unavailable: {
          out_of_stock: 'Brak na stanie.',
          not_purchasable: 'Niedostępny.',
          no_price_in_customer_list: 'Brak ceny dla Twojego konta.',
        },
      },
      totals: {
        subtotalLabel: (n: number) =>
          n === 1 ? 'Suma netto (1 pozycja)' : `Suma netto (${n} pozycji)`,
        discountLabel: (code: string | null) => (code ? `Rabat (${code})` : 'Rabat'),
        grandTotalLabel: 'Razem netto',
        deliveryLabel: 'Dostawa',
        deliveryValue: 'naliczana w kasie',
      },
      coupon: {
        label: 'Kupon rabatowy',
        placeholder: 'KOD-KUPONU',
        applyButton: 'Zastosuj',
        clearButton: 'Usuń',
        activeCode: () => 'aktywny',
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
      approvalBanner: {
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
    subheading: (n: number) =>
      n === 1 ? '1 item ready for checkout.' : `${n} items ready for checkout.`,
    empty: 'Your cart is empty.',
    browseCatalog: 'Browse the catalog',
    cardHeading: 'Cart',
    itemCount: (n: number) => (n === 1 ? '1 item' : `${n} items`),
    continueShopping: 'Continue shopping',
    taxesNote: 'Taxes and delivery are calculated at checkout.',
    breadcrumbs: { home: 'Home', cart: 'Cart' },
    summary: { heading: 'Summary' },
    line: {
      qtyLabel: 'Quantity',
      unitPriceLabel: 'Unit price',
      lineTotalLabel: 'Line total',
      removeLabel: 'Remove',
      saveToListLabel: 'Save to list',
      updateLabel: 'Update',
      unavailable: {
        out_of_stock: 'Out of stock.',
        not_purchasable: 'No longer available.',
        no_price_in_customer_list: 'Pricing unavailable for your account.',
      },
    },
    totals: {
      subtotalLabel: (n: number) =>
        n === 1 ? 'Subtotal (1 item)' : `Subtotal (${n} items)`,
      discountLabel: (code: string | null) => (code ? `Discount (${code})` : 'Discount'),
      grandTotalLabel: 'Total',
      deliveryLabel: 'Delivery',
      deliveryValue: 'calculated at checkout',
    },
    coupon: {
      label: 'Coupon code',
      placeholder: 'COUPON-CODE',
      applyButton: 'Apply',
      clearButton: 'Remove',
      activeCode: () => 'active',
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
    approvalBanner: {
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
