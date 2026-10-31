import type { ReactNode } from 'react';
import {
  CART_UNAVAILABLE,
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
import { CartPrimaryCta } from '../../../components/CartPrimaryCta';
import { getMe } from '../../../lib/api/account';
import { getProductDisplayMode, PRICING_UNAVAILABLE } from '../../../lib/api/pricing';
import { lineAmountHalfUp, type DisplayMode } from '@endora-commerce/contracts';
import type { Metadata } from 'next';
import {
  cartBlocksCheckout,
  cartLineDisplayName,
  cartLineEditError,
  cartLineEditErrorHref,
  parseCartQuantityEdit,
} from '../../../lib/cartMinimum';
import { droppedBelowMinimumReason } from '../../../lib/batchReport';
import { tForLocale } from '../../../lib/i18n/messages';
import { format } from '../../../lib/i18n/format';
import { pluralKey } from '../../../lib/i18n/plural';
import { formatMoney } from '../../../lib/i18n/money';
import { formatCount } from '../../../lib/orderMinimum';
import { cartActionFailure } from '../../../lib/cart-action-failure';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../lib/i18n/localized-link';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

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
    /** U4 — the line whose quantity edit `error` refuses; the sentence renders beside it. */
    errorItem?: string;
    /** U4 — what the buyer typed into that line, kept in its field. */
    typed?: string;
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
  if (result === CART_UNAVAILABLE) {
    // `carts` is not present (issue #132). The page renders the absence rather
    // than a Next error page: an empty cart is a cart, and this is not one.
    const { locale: absentLocale } = await getServerContext();
    const absentStrings = STRINGS(absentLocale);
    return (
      <div className="mx-auto max-w-[1360px] px-[24px]">
        <Breadcrumbs strings={absentStrings.breadcrumbs} />
        <div className="rounded-md border border-line bg-surface px-[24px] py-[48px] text-center">
          <h1 className="m-0 mb-2 text-[22px] font-semibold text-fg">
            {absentStrings.unavailable.heading}
          </h1>
          <p className="m-0 mb-[18px] text-[14px] text-muted">
            {absentStrings.unavailable.body}
          </p>
          <LocalizedLink href="/catalog" className="btn btn--dark">
            {absentStrings.browseCatalog}
          </LocalizedLink>
        </div>
      </div>
    );
  }
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

  const { locale, ctx } = await getServerContext();

  // Resolve ONE price display mode for the whole cart so the net/gross
  // presentation matches the PDP and product cards. It is resolved for the
  // buyer in front of the page (issue #271): `ctx` carries their session, so
  // the endpoint walks the same Product → Category → Organization → Settings
  // chain the resolved price on the PDP walks, for the same viewer. Before
  // that, this call forwarded no credential and the endpoint answered as a
  // guest, so a signed-in buyer whose deployment sets the two `pricing.*` keys
  // differently read one convention here and the other on the product page.
  // Resolved from the first line's product; falls back to net when unreachable.
  //
  // Absent `price_lists` resolves to net too, and that is a decision rather than
  // a fallback (issue #124): a cart line carries the net price that was quoted
  // when it was added, which is a real figure, while a gross presentation would
  // have to be derived from a tax authority this deployment is not serving.
  // Showing what was quoted is honest; deriving a gross total from it would not
  // be.
  const resolvedDisplayMode =
    cart.items.length > 0 && cart.items[0]
      ? await getProductDisplayMode(cart.items[0].productId, ctx)
      : null;
  const displayMode: DisplayMode =
    resolvedDisplayMode && resolvedDisplayMode !== PRICING_UNAVAILABLE
      ? resolvedDisplayMode.displayMode
      : 'net_only';

  const upsells = cart.items.length > 0 ? await getCartUpsells(jar).catch(() => []) : [];

  const strings = STRINGS(locale);

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-[1360px] px-[24px]">
        <Breadcrumbs strings={strings.breadcrumbs} />
        <div className="rounded-md border border-line bg-surface px-[24px] py-[48px] text-center">
          <h1 className="m-0 mb-2 text-[22px] font-semibold text-fg">{strings.heading}</h1>
          <p className="m-0 mb-[18px] text-[14px] text-muted">{strings.empty}</p>
          <LocalizedLink href="/catalog" className="btn btn--dark">
            {strings.browseCatalog}
          </LocalizedLink>
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
        locale={locale}
      />

      {/* Feature 027 — approval-state banner (US4). */}
      {cart.approvalStatus ? (
        <CartApprovalBanner
          approvalStatus={cart.approvalStatus}
          policyOn={requiresApproval}
          rejectedReason={null}
          submitForApprovalAction={submitForApprovalAction}
          linesBlockedNote={cartBlocksCheckout(cart) ? tForLocale(locale)('cart.approvalBlocked') : null}
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
            minimum: d.minimum,
          }))}
          strings={strings.dropped}
        />
      ) : null}

      {params.error && !cart.items.some((it) => cartLineEditError(params, it.id) !== null) ? (
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
                line={toViewModel(it, locale)}
                updateAction={updateAction}
                removeAction={removeAction}
                saveToListAction={saveToListAction}
                locale={locale}
                displayMode={displayMode}
                editError={cartLineEditError(params, it.id)}
                strings={strings.line}
              />
            ))}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-[22px] py-[18px]">
              <LocalizedLink href="/catalog" className="btn btn--ghost">
                ← {strings.continueShopping}
              </LocalizedLink>
              <CartConvertButtons
                disabled={cart.items.length === 0}
                disabledReason={null}
                convertToQrAction={convertToQrAction}
                strings={strings.convertButtons}
              />
            </div>
          </div>

          <UpsellStrip upsells={upsells} locale={locale} strings={strings.upsells} />
        </div>

        <aside className="sticky top-[96px] rounded-md border border-line bg-surface p-[20px]">
          <h3 className="m-0 mb-[14px] text-[14px] font-semibold text-fg">{strings.summary.heading}</h3>

          <CartTotals
            subtotal={cart.subtotal}
            discount={cart.discount ?? null}
            grandTotal={cart.grandTotal ?? cart.subtotal}
            itemCount={cart.items.length}
            locale={locale}
            displayMode={displayMode}
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
            <CartPrimaryCta
              cta={primaryCta}
              authenticated={me !== null}
              submitForApprovalNeeded={submitForApprovalNeeded}
              canTransact={canTransact}
              moderationMessage={me?.organization?.moderationMessage ?? null}
              submitAction={submitForApprovalAction}
              linesBlockCheckout={cartBlocksCheckout(cart)}
              linesBlockedNote={tForLocale(locale)('cart.checkoutBlocked')}
              approvalBlockedNote={tForLocale(locale)('cart.approvalBlocked')}
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
  strings: { label: string; home: string; cart: string };
}): ReactNode {
  return (
    <nav
      aria-label={strings.label}
      style={{
        fontSize: 13,
        color: 'var(--ink-500)',
        margin: '8px 0 16px',
        display: 'flex',
        gap: 6,
      }}
    >
      <LocalizedLink href="/" style={{ color: 'inherit' }}>
        {strings.home}
      </LocalizedLink>
      <span aria-hidden="true">/</span>
      <span style={{ color: 'var(--ink-900)' }}>{strings.cart}</span>
    </nav>
  );
}

/** Maps a CartItem to the view-model the CartLine component expects. */
function toViewModel(it: CartItem, locale: string): CartLineViewModel {
  return {
    id: it.id,
    productId: it.productId,
    variantId: it.variantId,
    // Backend resolves `productName` from Product.name against the
    // request's Accept-Language. Feature 043 — prefer `displayName`, which
    // already appends the packaging-unit name (e.g. "… (Paleta)"). When
    // unknown (a deleted product, FR-037) fall back to the SKU, then to a
    // sentence — never to the raw product id.
    productName: cartLineDisplayName(it, locale),
    sku: it.productSku ?? null,
    productSlug: it.productSlug ?? null,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    lineTotal: it.lineTotal ?? {
      amount: Number(lineAmountHalfUp(it.unitPrice.amount, it.quantity)),
      currency: it.unitPrice.currency,
    },
    ...(it.unavailable !== undefined ? { unavailable: it.unavailable } : {}),
    ...(it.unavailableReason !== undefined ? { unavailableReason: it.unavailableReason } : {}),
    // Feature 155 — the input floor and the server's below-minimum verdict.
    packagingUnitName: it.packagingUnitName ?? null,
    minOrderQuantity: it.minOrderQuantity ?? null,
    belowMinimum: it.belowMinimum ?? null,
  };
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
  // A stepper button posts `step`; the typed input and the one-step fix post `quantity`.
  const step = formData.get('step');
  const typed = formData.get('quantity');
  const edit = parseCartQuantityEdit({
    step: typeof step === 'string' ? step : null,
    quantity: typeof typed === 'string' ? typed : null,
  });
  const typedValue = step === null && typeof typed === 'string' ? typed : null;
  // The backend words its refusal (the minimum sentence) in the language it is asked in.
  const { locale, ctx } = await getServerContext();
  const t = tForLocale(locale);
  if (edit.kind === 'invalid') return await localeRedirect(cartLineEditErrorHref(itemId, t('cart.line.quantityInvalid'), typedValue));
  try {
    // `quantity: 0` removes the line (FR-007, contract §2), whatever its minimum.
    const quantity = edit.kind === 'remove' ? 0 : edit.quantity;
    const result = await updateCartItem(await readJar(), itemId, quantity, ctx);
    if (result.newAnonCookie) await setAnonCartCookie(result.newAnonCookie);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : t('cart.line.updateFailed');
    return await localeRedirect(cartLineEditErrorHref(itemId, message, typedValue));
  }
  return await localeRedirect('/cart');
}

async function removeAction(formData: FormData): Promise<void> {
  'use server';
  const itemId = (formData.get('itemId') as string) ?? '';
  const { locale, ctx } = await getServerContext();
  try {
    const result = await removeCartItem(await readJar(), itemId, ctx);
    if (result.newAnonCookie) await setAnonCartCookie(result.newAnonCookie);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : tForLocale(locale)('cart.line.removeFailed');
    return await localeRedirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect('/cart');
}

async function saveToListAction(formData: FormData): Promise<void> {
  'use server';
  const itemId = (formData.get('itemId') as string) ?? '';
  const jar = await readJar();
  const t = tForLocale((await getServerContext()).locale);
  if (!jar.session) {
    return await localeRedirect('/cart?error=' + encodeURIComponent(t('commerce.cart.error.signInToSave')));
  }
  try {
    const lists = await listShoppingLists(jar.session ?? '').catch(() => []);
    if (lists.length === 0) {
      return await localeRedirect(
        '/cart?error=' +
          encodeURIComponent(t('commerce.cart.error.noShoppingList')),
      );
    }
    const target = lists[0]!;
    await saveCartItemToShoppingList(jar, itemId, target.id);
    return await localeRedirect(`/cart?listAdded=${encodeURIComponent(target.name)}`);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : t('commerce.cart.error.saveToListFailed');
    return await localeRedirect(`/cart?error=${encodeURIComponent(message)}`);
  }
}

async function applyCouponAction(formData: FormData): Promise<void> {
  'use server';
  const code = ((formData.get('code') as string) ?? '').trim().toUpperCase();
  const t = tForLocale((await getServerContext()).locale);
  if (!code) return await localeRedirect('/cart?couponError=coupon_format_invalid');
  try {
    const result = await applyCartCoupon(await readJar(), code);
    if (result.outcome === 'rejected') {
      const qs = new URLSearchParams({ couponError: result.reason });
      if (result.shortfall) {
        qs.set('couponShortfall', String(result.shortfall.amount));
        qs.set('couponShortfallCurrency', result.shortfall.currency);
      }
      return await localeRedirect(`/cart?${qs.toString()}`);
    }
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : t('commerce.cart.error.applyCouponFailed');
    return await localeRedirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect('/cart');
}

async function clearCouponAction(): Promise<void> {
  'use server';
  try {
    await clearCartCoupon(await readJar());
  } catch {
    // Idempotent — silent fall-through is the spec.
  }
  return await localeRedirect('/cart');
}

async function convertToQrAction(formData: FormData): Promise<void> {
  'use server';
  const note = ((formData.get('note') as string) ?? '').trim() || null;
  const t = tForLocale((await getServerContext()).locale);
  try {
    const result = await convertCartToQuoteRequest(await readJar(), note);
    return await localeRedirect(`/quote-requests/${result.quoteRequestSlug}?from=cart`);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : t('commerce.cart.error.convertFailed');
    return await localeRedirect(`/cart?error=${encodeURIComponent(message)}`);
  }
}

async function submitForApprovalAction(): Promise<void> {
  'use server';
  // `ctx` carries the storefront's language: without it the backend worded its refusal
  // in its own default, whatever language the page was in (U4).
  const { locale, ctx } = await getServerContext();
  try {
    await submitCartForApproval(await readJar(), ctx);
  } catch (err) {
    // A refusal the backend worded (FR-039's minimum refusal, in the request's
    // language) passes through; anything else is the catalogue's sentence.
    const message = cartActionFailure(err, locale, 'cart.submitForApprovalFailed');
    return await localeRedirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect('/cart');
}

/* === Inline locale string catalogue =================================== */

function STRINGS(locale: string): {
  heading: string;
  subheading: (n: number) => string;
  empty: string;
  /** Issue #132 — the `carts` module is absent; distinct from an empty cart. */
  unavailable: { heading: string; body: string };
  browseCatalog: string;
  cardHeading: string;
  itemCount: (n: number) => string;
  continueShopping: string;
  taxesNote: string;
  breadcrumbs: { label: string; home: string; cart: string };
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
  const t = tForLocale(locale);
  return {
    heading: t('commerce.cart.heading'),
    subheading: (n: number) =>
      format(t(pluralKey('commerce.cart.subheading', n, locale)), { count: formatCount(n, locale) }),
    empty: t('commerce.cart.empty'),
    unavailable: {
      heading: t('commerce.cart.unavailable.heading'),
      body: t('commerce.cart.unavailable.body'),
    },
    browseCatalog: t('commerce.common.browseCatalog'),
    cardHeading: t('nav.cart'),
    itemCount: (n: number) =>
      format(t(pluralKey('lineGroups.summary.items', n, locale)), { count: formatCount(n, locale) }),
    continueShopping: t('commerce.common.continueShopping'),
    taxesNote: t('commerce.cart.taxesNote'),
    breadcrumbs: { label: t('commerce.common.breadcrumb'), home: t('nav.home'), cart: t('nav.cart') },
    summary: { heading: t('commerce.common.summary') },
    line: {
      qtyLabel: t('common.quantity'),
      unitPriceLabel: t('commerce.cart.line.unitPrice'),
      lineTotalLabel: t('commerce.common.lineTotal'),
      removeLabel: t('commerce.common.remove'),
      saveToListLabel: t('commerce.cart.line.saveToList'),
      updateLabel: t('commerce.cart.line.update'),
      netSuffix: t('commerce.common.net'),
      grossSuffix: t('commerce.common.gross'),
      unavailable: {
        out_of_stock: t('commerce.cart.line.unavailable.outOfStock'),
        not_purchasable: t('commerce.cart.line.unavailable.notPurchasable'),
        no_price_in_customer_list: t('commerce.cart.line.unavailable.noPriceInCustomerList'),
      },
    },
    totals: {
      subtotalLabel: (n: number) =>
        format(t(pluralKey('commerce.cart.totals.subtotal', n, locale)), { count: formatCount(n, locale) }),
      discountLabel: (code: string | null) =>
        code ? format(t('commerce.common.discountWithCode'), { code }) : t('commerce.common.discount'),
      grandTotalLabel: t('commerce.common.total'),
      deliveryLabel: t('commerce.cart.totals.delivery'),
      deliveryValue: t('commerce.cart.totals.deliveryValue'),
      netSuffix: t('commerce.common.net'),
      grossSuffix: t('commerce.common.gross'),
    },
    coupon: {
      label: t('commerce.cart.coupon.label'),
      placeholder: t('commerce.cart.coupon.placeholder'),
      applyButton: t('checkout.coupon.apply'),
      clearButton: t('commerce.common.remove'),
      activeCode: () => t('commerce.cart.coupon.active'),
      autoDropped: (code: string) => format(t('commerce.cart.coupon.autoDropped'), { code }),
      rejectedReason: (reason: string, shortfall?: { amount: number; currency: string }) => {
        const labels: Record<string, string> = {
          invalid_code: t('commerce.cart.coupon.rejected.invalidCode'),
          expired: t('commerce.cart.coupon.rejected.expired'),
          below_min_spend: shortfall
            ? format(t('commerce.cart.coupon.rejected.belowMinSpendAmount'), {
                amount: formatMoney(shortfall.amount, shortfall.currency, locale),
              })
            : t('commerce.cart.coupon.rejected.belowMinSpend'),
          wrong_channel: t('commerce.cart.coupon.rejected.wrongChannel'),
          wrong_customer_group: t('commerce.cart.coupon.rejected.wrongCustomerGroup'),
          wrong_organization: t('commerce.cart.coupon.rejected.wrongOrganization'),
          coupon_format_invalid: t('commerce.cart.coupon.rejected.formatInvalid'),
        };
        return labels[reason] ?? t('commerce.cart.coupon.rejected.generic');
      },
    },
    convertButtons: {
      convertToQrLabel: t('commerce.cart.convert.label'),
      convertToQrHint: t('commerce.cart.convert.hint'),
    },
    dropped: {
      heading: t('commerce.cart.dropped.heading'),
      intro: t('commerce.cart.dropped.intro'),
      reasonNotPurchasable: t('commerce.cart.dropped.reason.notPurchasable'),
      reasonOutOfStock: t('commerce.cart.dropped.reason.outOfStock'),
      reasonNoPriceInCustomerList: t('commerce.cart.dropped.reason.noPriceInCustomerList'),
      reasonRemovedByConversion: t('commerce.cart.dropped.reason.removedByConversion'),
      reasonBelowMinimum: (minimum: number | undefined) => droppedBelowMinimumReason(minimum, locale),
    },
    approvalBanner: {
      pending: t('commerce.cart.approval.pending'),
      approved: t('commerce.cart.approval.approved'),
      rejected: (reason: string | null) =>
        reason
          ? format(t('commerce.cart.approval.rejectedWithReason'), { reason })
          : t('commerce.cart.approval.rejected'),
      policyOn: t('commerce.cart.approval.policyOn'),
      submitButton: t('commerce.common.submitForApproval'),
    },
    upsells: {
      heading: t('commerce.cart.upsells.heading'),
      noPriceLabel: t('commerce.common.priceOnRequest'),
    },
    banner: {
      qrCreated: t('commerce.cart.banner.qrCreated'),
      listAdded: (listName: string) => format(t('commerce.cart.banner.listAdded'), { list: listName }),
    },
    cta: {
      checkout: t('commerce.cart.cta.checkout'),
      submitForApproval: t('commerce.common.submitForApproval'),
      awaitingApproval: t('commerce.cart.cta.awaitingApproval'),
      blockedByOrganization: t('commerce.cart.cta.blockedByOrganization'),
    },
  };
}
