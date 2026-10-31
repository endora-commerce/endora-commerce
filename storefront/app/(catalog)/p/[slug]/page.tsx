import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  type AddToCartResult,
  nextAddToCartToken,
} from '../../../../lib/cartAddState';
import { Breadcrumbs } from '../../../../components/Breadcrumbs';
import { ProductGallery } from '../../../../components/ProductGallery';
import { GallerySwitcher } from '../../../../components/GallerySwitcher';
import { AttachmentsList } from '../../../../components/AttachmentsList';
import { ProductLinksSections } from '../../../../components/ProductLinksSections';
import { ProductTabs, type ProductTab } from '../../../../components/ProductTabs';
import { BundleConfigurator } from '../../../../components/BundleConfigurator';
import { GroupedSummary } from '../../../../components/GroupedSummary';
import { VirtualCta } from '../../../../components/VirtualCta';
import { VariantPicker } from '../../../../components/VariantPicker';
import { PriceTag } from '../../../../components/PriceTag';
import { PdpPriceToggle } from '../../../../components/pricing/PdpPriceToggle';
import { StockBadge } from '../../../../components/StockBadge';
import { NotifyWhenAvailableDialog } from '../../../../components/inventory/NotifyWhenAvailableDialog';
import { BackorderHint } from '../../../../components/inventory/BackorderHint';
import { ProductBuyActions } from '../../../../components/ProductBuyActions';
import { AddToShoppingListButton } from '../../../../components/AddToShoppingListButton';
import { CompareToggle } from '../../../../components/CompareToggle';
import { QuoteRequestCta } from '../../../../components/pricing/QuoteRequestCta';

// Handed to client components (shopping-list heart, buy actions) that fetch
// from the browser, so it must be the public, build-time-baked
// `NEXT_PUBLIC_API_BASE_URL` — never the server-only `BACKEND_BASE_URL`
// (internal `http://backend:3001`) that triggers a Mixed Content block.
const PDP_API_BASE = publicApiBaseUrl();
import { ParametryTab } from '../../../../components/attributes/ParametryTab';
import { Hook } from '../../../../components/Hook';
import { JsonLd } from '../../../../lib/seo/JsonLd';
import { ViewItemTracker } from '../../../../components/analytics/EcommerceTrackers';
import { getStorefrontQuoteRequestSettings } from '../../../../lib/api/rfq';
import { getProductBySlug, resolveProductKey } from '../../../../lib/api/catalog';
import { getResolvedPrice, PRICING_UNAVAILABLE } from '../../../../lib/api/pricing';
import { getStorefrontProductStock } from '../../../../lib/api/inventory';
import { getMe } from '../../../../lib/api/account';
import { addCartItem, type CartCookieJar } from '../../../../lib/api/cart';
import {
  getAnonCartCookie,
  getSessionCookie,
  setAnonCartCookie,
} from '../../../../lib/session';
import { cookies } from 'next/headers';
import {
  getOneClickEligibility,
  placeOneClickOrder,
} from '../../../../lib/api/quick-order';
import { getServerContext } from '../../../../lib/server-context';
import { alternateLanguages, productById, productIdForKey } from './resolution';
import { tForLocale } from '../../../../lib/i18n/messages';
import { cartActionFailure } from '../../../../lib/cart-action-failure';
import { withoutViewer } from '../../../../lib/api/client';
import { publicApiBaseUrl } from '../../../../lib/env.mjs';
import { localeRedirect } from '../../../../lib/i18n/navigation';

interface PageProps {
  params: Promise<{ slug: string }>;
  /**
   * `variant` — a preselected variant SKU. The page language is the path's
   * (feature 167, OR-4); 163's interim `?lang=` is no longer read.
   */
  searchParams?: Promise<{ variant?: string | string[] }>;
}

/**
 * PDP — server-rendered, with backend-resolved meta + JSON-LD, gallery,
 * attribute table, and an action zone (request quote / add to cart). The
 * action buttons are server-rendered links today; a theme adds client-side
 * cart wiring by replacing them.
 */

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const search = searchParams ? await searchParams : {};
  const variantSku = typeof search.variant === 'string' ? search.variant : null;
  const { ctx, locale } = await getServerContext();
  // Deliberately the anonymous answer, even for a signed-in buyer (issue
  // #265): this output is the crawler's and the social card's, it carries no
  // price to personalise, and asking it as the buyer would cost the shared
  // Data Cache entry every visitor to this page reuses.
  const anonymous = withoutViewer(ctx);
  try {
    // Feature 163 — the key first (K1). A redirect key has no metadata of its
    // own: the page answers the permanent redirect, so nothing here is indexed.
    const resolution = await resolveProductKey(slug, anonymous);
    if (resolution.kind === 'redirect') return { robots: { index: false, follow: true } };
    const product = await getProductBySlug(resolution.productId, anonymous);
    const languages = alternateLanguages(product.paths);
    // Feature 002 (T052) — if `?variant=<sku>` is present and the
    // SKU is a known variant, surface the variant's identity in the
    // social card title so different variants get distinct previews
    // when shared. Foundation's ProductVariant entity does NOT have
    // its own assets, so the OG image keeps coming from the parent
    // Product (this is intentional — until variants get their own
    // primary asset, sharing variant URLs reuses the parent image).
    const selectedVariant =
      variantSku != null
        ? product.variants.find((v) => v.sku === variantSku) ?? null
        : null;
    const titleSuffix = selectedVariant ? ` — ${selectedVariant.sku}` : '';
    return {
      title: `${product.seo.metaTitle}${titleSuffix}`,
      description: product.seo.metaDescription,
      // Indexable (FR-010/FR-012), and the canonical is the product's own path
      // **without** `?variant=`: every variant URL is the same product page
      // with a different preselection, so one of them is the page a crawler
      // should hold and the rest point at it. Feature 163 (FR-074) — both the
      // canonical and the `hreflang` alternates are the backend's paths, built
      // for the effective key per language; alternates only where the product
      // is available to anonymous visitors.
      alternates: {
        canonical: product.paths.canonical,
        ...(languages ? { languages } : {}),
      },
      openGraph: {
        title: `${product.seo.openGraph.title}${titleSuffix}`,
        description: product.seo.openGraph.description,
        images: product.seo.openGraph.imageUrl ? [product.seo.openGraph.imageUrl] : undefined,
      },
    };
  } catch {
    return { title: tForLocale(locale)('commerce.pdp.notFound'), robots: { index: false, follow: false } };
  }
}

export default async function ProductPage({
  params,
  searchParams,
}: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const search = searchParams ? await searchParams : {};
  const selectedVariantSku = typeof search.variant === 'string' ? search.variant : null;
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);

  // Feature 163 — which product the key names here, or the permanent redirect to
  // where it moved (FR-071, FR-072); then the product, read by id.
  const productId = await productIdForKey(slug, ctx);
  const product = await productById(productId, ctx);

  const primaryCategory = product.categories[0];
  const rfqSettings = await getStorefrontQuoteRequestSettings();
  const stock = await getStorefrontProductStock(product.id, ctx);
  const customerEmail = await readCustomerEmail();
  /**
   * D-287 P0 — **one** resolution prices this page. The product detail carries
   * the base / sale / display-mode split (`resolvedPrice`) from the resolution
   * that priced `price`; this page used to ask
   * `GET /storefront/products/:id/resolved-price` as well, so every view
   * resolved the product twice.
   *
   * `price_lists` not being present (issue #124) still quotes nothing: the
   * catalogue detail cannot price without it and refuses, so no figure reaches
   * this page from a module the platform is not serving. A viewer whose
   * display mode withholds prices (`none`, e.g. a guest on a channel that hides
   * prices until sign-in) is answered `price: null` and a `resolvedPrice` with
   * no amounts and `displayMode: 'none'`.
   */
  let resolved = product.resolvedPrice ?? null;
  let price = product.price;
  const isQuoteOnly = resolved?.displayMode === 'none';
  // Feature 039 (US5) — one-click buy is offered only to a logged-in buyer who
  // is eligible (setting enabled for the channel + all four valid defaults).
  const oneClickSession = await getSessionCookie();
  const oneClickEnabled = oneClickSession
    ? await getOneClickEligibility(oneClickSession, product.id, ctx)
        .then((e) => e.enabled)
        .catch(() => false)
    : false;
  // Resolve the optional variant the buyer selected via `?variant=<sku>`
  // to its UUID so the Add-to-cart form posts the right variantId.
  const selectedVariantId =
    selectedVariantSku
      ? product.variants.find((v) => v.sku === selectedVariantSku)?.id ?? null
      : null;
  // Feature 160 (FR-031) — a selected variant is priced as itself: the price
  // the cart will charge for it, resolved by the price books. One resolution,
  // and only when a variant is selected; the listing's "from" price stands
  // otherwise.
  let selectedVariantPrice: { amount: string; currency: string } | null = null;
  if (selectedVariantId) {
    const variantResolved = await getResolvedPrice(product.id, { variantId: selectedVariantId }, ctx);
    if (variantResolved && variantResolved !== PRICING_UNAVAILABLE) {
      resolved = {
        basePrice: variantResolved.basePrice,
        salePrice: variantResolved.salePrice,
        displayMode: variantResolved.displayMode,
        // Feature 161 (FR-026) — the variant's own "list price / your price".
        ...(variantResolved.listPrice ? { listPrice: variantResolved.listPrice } : {}),
      };
      const charged = variantResolved.salePrice ?? variantResolved.basePrice;
      selectedVariantPrice = charged;
      price = charged ? { amount: Number(charged.amount), currency: charged.currency } : null;
    }
  }

  // The "Add to compare" toggle rides in the ProductBuyActions second row when
  // that row renders; otherwise it's shown on its own below the action zone.
  const buyShowCart = !!price && !stock?.showNotifyButton;
  const buyShowQuote = rfqSettings.showAddToQuoteOnPdp;
  const buyActionsRendered =
    (product.type === 'simple' || product.type === 'configurable') &&
    !isQuoteOnly &&
    (!!price || buyShowQuote) &&
    (buyShowCart || buyShowQuote);

  // Industria PDP detail tabs (below the gallery). "Opis" (description) is the
  // lead tab; "Parametry" and "Załączniki" are added only when they have
  // content — mirroring the reference `.tabs`/`.tabpanel` section.
  const visibleAttributes =
    (product as { visibleAttributes?: Array<{ key: string; label: string; valueType: string; valueRendered: string }> })
      .visibleAttributes ?? null;
  const hasAttributeValues = Object.keys(product.attributeValues).length > 0;
  const productTabs: ProductTab[] = [];
  if (product.description) {
    productTabs.push({
      id: 'description',
      label: t('product.tabs.description'),
      panel: (
        <p className="max-w-[70ch] whitespace-pre-line text-[15px] leading-[1.7] text-muted">
          {product.description}
        </p>
      ),
    });
  }
  if (hasAttributeValues || (visibleAttributes && visibleAttributes.length > 0)) {
    productTabs.push({
      id: 'parameters',
      label: t('product.tabs.parameters'),
      panel: (
        <div className="flex flex-col gap-6">
          {hasAttributeValues ? (
            <div>
              {product.attributeSet ? (
                <p className="mb-2 text-[0.875rem] text-muted">
                  {product.attributeSet.name[locale] ??
                    product.attributeSet.name['en-US'] ??
                    Object.values(product.attributeSet.name)[0] ??
                    product.attributeSet.code}
                </p>
              ) : null}
              <table className="w-full border-collapse">
                <tbody>
                  {Object.entries(product.attributeValues).map(([key, value]) => (
                    <tr key={key}>
                      <th
                        scope="row"
                        className="border-b border-line p-[8px] text-left text-[13px] font-medium text-muted"
                      >
                        {key}
                      </th>
                      <td className="border-b border-line p-[8px] text-left font-mono text-[13px]">
                        {String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {/* Feature 012 / US6 — "Parametry produktu": only attributes the
              operator flagged isVisibleOnProductPage AND that have a value on
              this product. Renders null when nothing matches (FR-030). */}
          <ParametryTab attributes={visibleAttributes} locale={locale} />
        </div>
      ),
    });
  }
  if (product.attachments && product.attachments.length > 0) {
    productTabs.push({
      id: 'attachments',
      label: t('product.tabs.attachments'),
      count: product.attachments.length,
      panel: <AttachmentsList attachments={product.attachments} locale={locale} />,
    });
  }

  // Feature 167 — `<html lang>` is the path language, which is this page's, so
  // T155 (B3)'s own `lang` mark on this element is gone.
  return (
    <div className="mx-auto max-w-[1360px] px-[24px] pt-[18px] pb-[64px] max-md:pb-[96px]">
      {/* Feature 049 — GA4 view_item (no-op unless Enhanced Ecommerce is on). */}
      <ViewItemTracker
        item={{
          sku: product.sku,
          name: product.name,
          price: price?.amount ?? 0,
          quantity: 1,
          ...(price?.currency ? { currency: price.currency } : {}),
        }}
      />
      <Breadcrumbs
        crumbs={[
          { href: '/', label: t('nav.home') },
          { href: '/catalog', label: t('catalog.heading') },
          ...(primaryCategory
            ? [{ href: `/c/${primaryCategory.slug}`, label: primaryCategory.name }]
            : []),
          // Feature 163 — the page's own URL as the backend built it (`productPath()`).
          { href: product.paths.canonical, label: product.name },
        ]}
      />
      <Hook code="product.top" />

      <article className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-[24px] max-[720px]:grid-cols-1">
        {product.gallery && product.gallery.length > 0 ? (
          <GallerySwitcher gallery={product.gallery} alt={product.name} locale={locale} />
        ) : (
          <ProductGallery
            assets={product.assets}
            alt={product.name}
            locale={locale}
            placeholderUrl={product.primaryAssetUrl}
          />
        )}
        <div>
          {/* Industria PDP identity header: category eyebrow, title, and a
              monospace id-strip — mirrors `.pdp__brand` / `.pdp__title` /
              `.pdp__id-strip` from the design. */}
          {primaryCategory ? (
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-subtle">
              {primaryCategory.name}
            </div>
          ) : null}
          <h1 className="mt-[4px] mb-[12px] text-[26px] font-semibold leading-[1.25] tracking-[-0.015em] text-fg">
            {product.name}
          </h1>
          <div className="mb-[16px] flex flex-wrap items-center gap-x-[18px] gap-y-[6px] border-y border-line py-[10px] font-mono text-[12px] text-muted">
            <span className="inline-flex gap-[6px]">
              {t('commerce.pdp.sku')} <strong className="font-medium text-fg">{product.sku}</strong>
            </span>
          </div>
          {/* Give the price extra breathing room (above + below) so it draws the
              eye on the PDP. In both-mode the net/gross switch pins to the price
              block's top-right and the stock badge drops below; otherwise the
              badge sits directly beside the price. */}
          {resolved && resolved.displayMode === 'both' ? (
            <div className="my-7">
              <PdpPriceToggle
                basePrice={resolved.basePrice}
                salePrice={resolved.salePrice}
                listPrice={resolved.listPrice ?? null}
                listPriceLabel={t('product.listPrice')}
                yourPriceLabel={t('product.yourPrice')}
                locale={locale}
              />
              <div className="mt-3">
                <StockBadge product={product} stock={stock} locale={locale} />
              </div>
            </div>
          ) : (
            <div className="my-7 flex flex-wrap items-center gap-3">
              <PriceTag
                price={price}
                resolved={resolved}
                locale={locale}
                variant="pdp"
              />
              <StockBadge product={product} stock={stock} locale={locale} />
            </div>
          )}

          {stock?.backorderEnabled && stock.isOutOfStock ? (
            <BackorderHint label={t('product.backorder.hint')} />
          ) : null}

          <div className="mt-4 flex flex-col items-stretch gap-3">
            {/* Feature 002 US5 — type switch for the action zone:
              * - simple/configurable keep the legacy Add-to-cart + RFQ
              * - grouped → GroupedSummary
              * - bundle → BundleConfigurator
              * - virtual → VirtualCta
              */}
            {product.type === 'simple' || product.type === 'configurable' ? (
              isQuoteOnly ? (
                <QuoteRequestCta
                  productId={product.id}
                  productSlug={product.slug}
                  productName={product.name}
                  unitPrice={price ?? null}
                  variant="pdp"
                  minOrderQuantity={product.minOrderQuantity ?? null}
                  locale={locale}
                />
              ) : (
                <>
                  {stock?.showNotifyButton ? (
                    <NotifyWhenAvailableDialog
                      productId={product.id}
                      defaultEmail={customerEmail}
                      salesChannelCode={ctx.salesChannelCode}
                      labels={{
                        cta: t('product.notify.cta'),
                        dialogTitle: t('product.notify.dialogTitle'),
                        emailLabel: t('product.notify.emailLabel'),
                        submit: t('product.notify.submit'),
                        submitting: t('product.notify.submitting'),
                        success: t('product.notify.success'),
                        errorGeneric: t('product.notify.errorGeneric'),
                        cancel: t('product.notify.cancel'),
                      }}
                    />
                  ) : null}
                  {price || rfqSettings.showAddToQuoteOnPdp ? (
                    <ProductBuyActions
                      productId={product.id}
                      productSlug={product.slug}
                      productName={product.name}
                      unitPrice={price ?? null}
                      {...(selectedVariantId ? { variantId: selectedVariantId } : {})}
                      showCart={!!price && !stock?.showNotifyButton}
                      showQuote={rfqSettings.showAddToQuoteOnPdp}
                      packagingUnits={product.packagingUnits}
                      singlePieceLabel={t('product.packaging.singlePiece')}
                      piecesLabel={t('product.packaging.pieces')}
                      minOrderQuantity={product.minOrderQuantity ?? null}
                      locale={locale}
                      addToCartAction={addToCartAction}
                      addToCartLabel={t('product.addToCart')}
                      // Secondary actions row, next to compare + quote.
                      leadingAction={
                        <AddToShoppingListButton
                          apiBase={PDP_API_BASE}
                          productId={product.id}
                          {...(selectedVariantId ? { variantId: selectedVariantId } : {})}
                          label={t('commerce.pdp.shoppingList.add')}
                          removeLabel={t('commerce.pdp.shoppingList.remove')}
                          showLabel
                          className="btn btn--outline h-[40px] w-full justify-center md:w-auto"
                        />
                      }
                      // Secondary actions row, alongside the shopping-list + quote.
                      compareAction={
                        <CompareToggle
                          productId={product.id}
                          variant="inline"
                          salesChannelCode={ctx.salesChannelCode}
                          locale={locale}
                        />
                      }
                    />
                  ) : (
                    // No buy-actions row (no price and RFQ-on-PDP off): still
                    // offer the shopping-list heart on its own.
                    <AddToShoppingListButton
                      apiBase={PDP_API_BASE}
                      productId={product.id}
                      {...(selectedVariantId ? { variantId: selectedVariantId } : {})}
                      label={t('commerce.pdp.shoppingList.add')}
                      removeLabel={t('commerce.pdp.shoppingList.remove')}
                    />
                  )}
                  {oneClickEnabled && price ? (
                    <form action={oneClickAction} style={{ display: 'inline-flex', gap: 8 }}>
                      <input type="hidden" name="productId" value={product.id} />
                      {selectedVariantId ? (
                        <input type="hidden" name="variantId" value={selectedVariantId} />
                      ) : null}
                      <button type="submit" className="b2b-cta">
                        {t('commerce.pdp.oneClick')}
                      </button>
                    </form>
                  ) : null}
                </>
              )
            ) : null}
            {product.type === 'virtual' && product.virtual ? (
              <VirtualCta
                productId={product.id}
                virtual={product.virtual}
                labels={{
                  buyAndDownload: t('product.virtual.buyAndDownload'),
                  digitalDelivery: t('product.virtual.digitalDelivery'),
                }}
                addToCartAction={addToCartAction}
                locale={locale}
              />
            ) : null}
          </div>
          {!buyActionsRendered ? (
            <div className="mt-3">
              <CompareToggle
                productId={product.id}
                variant="inline"
                salesChannelCode={ctx.salesChannelCode}
                locale={locale}
              />
            </div>
          ) : null}
          <Hook code="product.buttons.after" />

          {product.type === 'configurable' && product.variants.length > 0 ? (
            <VariantPicker
              productSlug={product.slug}
              locale={locale}
              variants={product.variants.map((v) => ({
                ...v,
                price: v.id === selectedVariantId ? selectedVariantPrice : null,
              }))}
              selectedSku={selectedVariantSku}
              labels={{
                heading: t('product.variants.heading'),
                sku: t('product.variants.sku'),
                stockLevel: t('product.variants.stockLevel'),
                outOfStock: t('product.variants.outOfStock'),
                selectThisVariant: t('product.variants.selectThisVariant'),
              }}
            />
          ) : null}

          {product.type === 'grouped' && product.groupedItems ? (
            <GroupedSummary
              items={product.groupedItems}
              addToCartLabel={t('product.grouped.addBundleToCart')}
              addToCartAction={addGroupedToCartAction}
              locale={locale}
            />
          ) : null}

          {product.type === 'bundle' && product.bundleSlots ? (
            <BundleConfigurator
              productSlug={product.slug}
              slots={product.bundleSlots}
              labels={{
                addToCart: t('product.bundle.addToCart'),
                requiredSlot: t('product.bundle.requiredSlot'),
              }}
              locale={locale}
              addToCartAction={addBundleToCartAction}
            />
          ) : null}

        </div>
      </article>

      {productTabs.length > 0 ? <ProductTabs tabs={productTabs} /> : null}

      {product.links ? (
        <ProductLinksSections
          related={product.links.related}
          upSell={product.links.upSell}
          labels={{
            related: t('product.links.related'),
            upSell: t('product.links.upSell'),
            seeAll: t('product.links.seeAll'),
          }}
          locale={locale}
        />
      ) : null}
      <Hook code="product.bottom" />

      <JsonLd data={product.structuredDataJsonLd} />
    </div>
  );
}

async function readCustomerEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get('b2b_session')?.value;
  if (!session) return null;
  try {
    const me = await getMe(session);
    return me.customerAccount.email;
  } catch {
    return null;
  }
}

async function readCartJar(): Promise<CartCookieJar> {
  const session = await getSessionCookie();
  const anon = await getAnonCartCookie();
  return {
    ...(session ? { session } : {}),
    ...(anon ? { anon } : {}),
  };
}

/**
 * The request's locale, for an action's failure message (issue #249). It is
 * read while handling a failure — possibly the backend being unreachable, which
 * `getServerContext` reads too — so it never throws: an unreadable locale
 * falls back to the catalogue's default rather than replacing the shopper's
 * error with an error page.
 */
async function failureLocale(): Promise<string | undefined> {
  try {
    return (await getServerContext()).locale;
  } catch {
    return undefined;
  }
}

/**
 * Add-to-cart server action for the PDP. POSTs to the carts module,
 * persists the `b2b_cart_anon` cookie the backend mints on the first
 * call (without it the redirect lands on `/cart` with no jar and the
 * full GET returns an empty cart), then redirects to `/cart`.
 */
/**
 * One-click buy server action (feature 039 / US5). Places the order from the
 * buyer's defaults and routes by the payment `nextAction`: a gateway redirect
 * goes to the payment URL; otherwise (bank transfer / no payment step) we land
 * on the order/success page.
 */
async function oneClickAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const productId = ((formData.get('productId') as string) ?? '').trim();
  const variantId = ((formData.get('variantId') as string) ?? '').trim();
  if (!productId) return await localeRedirect('/cart?error=missing-product');

  let result;
  try {
    const { ctx } = await getServerContext();
    result = await placeOneClickOrder(
      session,
      {
        productId,
        ...(variantId ? { variantId } : {}),
      },
      ctx,
    );
  } catch (err) {
    const message = cartActionFailure(err, await failureLocale(), 'product.oneClickFailed');
    return await localeRedirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  if (result!.nextAction?.kind === 'redirect_to_gateway' && result!.nextAction.url) {
    return await localeRedirect(result!.nextAction.url);
  }
  return await localeRedirect(`/orders/${result!.order.id}`);
}

async function addGroupedToCartAction(formData: FormData): Promise<void> {
  'use server';
  // Each child of the grouped product is submitted as `item=productId:quantity`.
  // A grouped product is a fixed set, so we add one cart line per child rather
  // than the (price-less) container product itself.
  const entries = (formData.getAll('item') as string[])
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return await localeRedirect('/cart?error=missing-product');
  const jar = await readCartJar();
  let anon: string | null = jar.anon ?? null;
  // `ctx` carries the storefront's language and channel, so a refusal reads in the page's language.
  const { ctx } = await getServerContext();
  try {
    for (const entry of entries) {
      const [productId, qtyRaw] = entry.split(':');
      if (!productId) continue;
      const quantity = Number(qtyRaw ?? '1');
      const qty = Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1;
      const result = await addCartItem(
        { ...jar, anon },
        { productId, quantity: qty },
        ctx,
      );
      // Reuse the freshly-minted anon cart for the remaining children so every
      // line lands in the same cart.
      if (result.newAnonCookie) anon = result.newAnonCookie;
    }
    if (anon && anon !== (jar.anon ?? null)) await setAnonCartCookie(anon);
  } catch (err) {
    const message = cartActionFailure(err, await failureLocale(), 'product.addToCartFailed');
    return await localeRedirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect('/cart');
}

async function addBundleToCartAction(formData: FormData): Promise<void> {
  'use server';
  // A bundle PDP submits, per slot, the selected option's PRODUCT id
  // (`slot_<slotId>_product`) and a quantity (`slot_<slotId>_qty`). The cart
  // API has no native bundle line, so — like grouped products — we add one
  // cart line per selected slot option. Unselected optional slots are skipped.
  const selections: { productId: string; quantity: number }[] = [];
  for (const [key, value] of formData.entries()) {
    const match = /^slot_(.+)_product$/.exec(key);
    if (!match) continue;
    const productId = String(value).trim();
    if (!productId) continue;
    const quantityRaw = formData.get(`slot_${match[1]}_qty`);
    const quantity = Number(quantityRaw ?? '1');
    const qty = Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1;
    selections.push({ productId, quantity: qty });
  }
  if (selections.length === 0) return await localeRedirect('/cart?error=missing-product');
  const jar = await readCartJar();
  let anon: string | null = jar.anon ?? null;
  const { ctx } = await getServerContext();
  try {
    for (const sel of selections) {
      const result = await addCartItem(
        { ...jar, anon },
        { productId: sel.productId, quantity: sel.quantity },
        ctx,
      );
      // Reuse the freshly-minted anon cart for the remaining slots so every
      // line lands in the same cart.
      if (result.newAnonCookie) anon = result.newAnonCookie;
    }
    if (anon && anon !== (jar.anon ?? null)) await setAnonCartCookie(anon);
  } catch (err) {
    const message = cartActionFailure(err, await failureLocale(), 'product.addToCartFailed');
    return await localeRedirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect('/cart');
}

// PDP add-to-cart. Returns a result state (consumed by `useActionState` in the
// buy-actions client components) instead of redirecting to `/cart`, so the buyer
// stays on the product page and sees a "product added" confirmation popup.
async function addToCartAction(
  prevState: AddToCartResult,
  formData: FormData,
): Promise<AddToCartResult> {
  'use server';
  const productId = ((formData.get('productId') as string) ?? '').trim();
  const variantId = ((formData.get('variantId') as string) ?? '').trim();
  const packagingUnitId = ((formData.get('packagingUnitId') as string) ?? '').trim();
  const quantity = Number(formData.get('quantity') ?? '1');
  if (!productId) {
    return {
      status: 'error',
      message: cartActionFailure(null, await failureLocale(), 'product.addToCartFailed'),
    };
  }
  const qty = Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1;
  try {
    // `ctx` carries the storefront's language: the minimum refusal (FR-008) is worded in it.
    const { ctx } = await getServerContext();
    const result = await addCartItem(
      await readCartJar(),
      {
        productId,
        ...(variantId ? { variantId } : {}),
        ...(packagingUnitId ? { packagingUnitId } : {}),
        quantity: qty,
      },
      ctx,
    );
    if (result.newAnonCookie) await setAnonCartCookie(result.newAnonCookie);
  } catch (err) {
    return {
      status: 'error',
      message: cartActionFailure(err, await failureLocale(), 'product.addToCartFailed'),
    };
  }
  return { status: 'success', token: nextAddToCartToken(prevState) };
}
