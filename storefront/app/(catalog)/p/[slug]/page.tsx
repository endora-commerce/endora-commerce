import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
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
import { ViewItemTracker } from '../../../../components/analytics/EcommerceTrackers';
import { getStorefrontQuoteRequestSettings } from '../../../../lib/api/rfq';
import { getProductBySlug } from '../../../../lib/api/catalog';
import { getStorefrontProductStock } from '../../../../lib/api/inventory';
import { getResolvedPrice, PRICING_UNAVAILABLE } from '../../../../lib/api/pricing';
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
import { canonicalPath } from '../../../../lib/seo/route-seo';
import { seo } from './seo';
import { tForLocale } from '../../../../lib/i18n/messages';
import { StorefrontApiError, withoutViewer } from '../../../../lib/api/client';
import { publicApiBaseUrl } from '../../../../lib/env.mjs';

interface PageProps {
  params: Promise<{ slug: string }>;
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
  const { ctx } = await getServerContext();
  try {
    // Deliberately the anonymous answer, even for a signed-in buyer (issue
    // #265): this output is the crawler's and the social card's, it carries no
    // price to personalise, and asking it as the buyer would cost the shared
    // Data Cache entry every visitor to this page reuses.
    const product = await getProductBySlug(slug, withoutViewer(ctx));
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
      // should hold and the rest point at it.
      alternates: { canonical: canonicalPath(seo.route, { slug }) },
      openGraph: {
        title: `${product.seo.openGraph.title}${titleSuffix}`,
        description: product.seo.openGraph.description,
        images: product.seo.openGraph.imageUrl ? [product.seo.openGraph.imageUrl] : undefined,
      },
    };
  } catch {
    return { title: 'Product not found', robots: { index: false, follow: false } };
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

  let product;
  try {
    product = await getProductBySlug(slug, ctx);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) notFound();
    throw err;
  }

  const primaryCategory = product.categories[0];
  const rfqSettings = await getStorefrontQuoteRequestSettings();
  const [stock, resolvedPrice] = await Promise.all([
    getStorefrontProductStock(product.id, ctx),
    getResolvedPrice(product.id, { quantity: 1 }, ctx),
  ]);
  const customerEmail = await readCustomerEmail();
  /**
   * `price_lists` is not present (issue #124). Nothing on this page may quote a
   * figure: the catalogue's legacy `defaultPrice` projection is not a price the
   * platform stands behind, and an Add-to-cart posted against it can only come
   * back 503. The page still renders — the product, its media, its attributes —
   * with no price and no cart action; the quote path stays open where the
   * deployment offers one, because a quote is a request for a price rather than
   * a claim about one.
   */
  const pricingAbsent = resolvedPrice === PRICING_UNAVAILABLE;
  const resolved = pricingAbsent ? null : resolvedPrice;
  const price = pricingAbsent ? null : product.price;
  const isQuoteOnly = resolved?.displayMode === 'none';
  // Feature 039 (US5) — one-click buy is offered only to a logged-in buyer who
  // is eligible (setting enabled for the channel + all four valid defaults).
  const oneClickSession = await getSessionCookie();
  const oneClickEnabled = oneClickSession
    ? await getOneClickEligibility(oneClickSession, product.id)
        .then((e) => e.enabled)
        .catch(() => false)
    : false;
  // Resolve the optional variant the buyer selected via `?variant=<sku>`
  // to its UUID so the Add-to-cart form posts the right variantId.
  const selectedVariantId =
    selectedVariantSku
      ? product.variants.find((v) => v.sku === selectedVariantSku)?.id ?? null
      : null;

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
          { href: `/p/${product.slug}`, label: product.name },
        ]}
      />
      <Hook code="product.top" />

      <article className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-[24px] max-[720px]:grid-cols-1">
        {product.gallery && product.gallery.length > 0 ? (
          <GallerySwitcher gallery={product.gallery} alt={product.name} />
        ) : (
          <ProductGallery
            assets={product.assets}
            alt={product.name}
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
              SKU: <strong className="font-medium text-fg">{product.sku}</strong>
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
                locale={locale}
                labels={{ net: 'NETTO', gross: 'BRUTTO' }}
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
                />
              ) : (
                <>
                  {stock?.showNotifyButton ? (
                    <NotifyWhenAvailableDialog
                      productId={product.id}
                      defaultEmail={customerEmail}
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
                      addToCartAction={addToCartAction}
                      addToCartLabel="Dodaj do koszyka"
                      // Secondary actions row, next to compare + quote.
                      leadingAction={
                        <AddToShoppingListButton
                          apiBase={PDP_API_BASE}
                          productId={product.id}
                          {...(selectedVariantId ? { variantId: selectedVariantId } : {})}
                          label="Dodaj do listy zakupowej"
                          removeLabel="Usuń z listy zakupowej"
                          showLabel
                          className="btn btn--outline h-[40px] w-full justify-center md:w-auto"
                        />
                      }
                      // Secondary actions row, alongside the shopping-list + quote.
                      compareAction={<CompareToggle productId={product.id} variant="inline" />}
                    />
                  ) : (
                    // No buy-actions row (no price and RFQ-on-PDP off): still
                    // offer the shopping-list heart on its own.
                    <AddToShoppingListButton
                      apiBase={PDP_API_BASE}
                      productId={product.id}
                      {...(selectedVariantId ? { variantId: selectedVariantId } : {})}
                      label="Dodaj do listy zakupowej"
                      removeLabel="Usuń z listy zakupowej"
                    />
                  )}
                  {oneClickEnabled && price ? (
                    <form action={oneClickAction} style={{ display: 'inline-flex', gap: 8 }}>
                      <input type="hidden" name="productId" value={product.id} />
                      {selectedVariantId ? (
                        <input type="hidden" name="variantId" value={selectedVariantId} />
                      ) : null}
                      <button type="submit" className="b2b-cta">
                        Buy in one click
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
              />
            ) : null}
          </div>
          {!buyActionsRendered ? (
            <div className="mt-3">
              <CompareToggle productId={product.id} variant="inline" />
            </div>
          ) : null}
          <Hook code="product.buttons.after" />

          {product.type === 'configurable' && product.variants.length > 0 ? (
            <VariantPicker
              productSlug={product.slug}
              variants={product.variants}
              selectedSku={selectedVariantSku}
              labels={{
                heading: t('product.variants.heading'),
                sku: t('product.variants.sku'),
                priceOverride: t('product.variants.priceOverride'),
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

      <script
        type="application/ld+json"
        // The backend builds the JSON-LD from the product entity, so the
        // strings come from a typed source — no XSS risk.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(product.structuredDataJsonLd) }}
      />
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
  if (!session) redirect('/login');
  const productId = ((formData.get('productId') as string) ?? '').trim();
  const variantId = ((formData.get('variantId') as string) ?? '').trim();
  if (!productId) redirect('/cart?error=missing-product');

  let result;
  try {
    result = await placeOneClickOrder(session, {
      productId,
      ...(variantId ? { variantId } : {}),
    });
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not place the order.';
    redirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  if (result!.nextAction?.kind === 'redirect_to_gateway' && result!.nextAction.url) {
    redirect(result!.nextAction.url);
  }
  redirect(`/orders/${result!.order.id}`);
}

async function addGroupedToCartAction(formData: FormData): Promise<void> {
  'use server';
  // Each child of the grouped product is submitted as `item=productId:quantity`.
  // A grouped product is a fixed set, so we add one cart line per child rather
  // than the (price-less) container product itself.
  const entries = (formData.getAll('item') as string[])
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) redirect('/cart?error=missing-product');
  const jar = await readCartJar();
  let anon: string | null = jar.anon ?? null;
  try {
    for (const entry of entries) {
      const [productId, qtyRaw] = entry.split(':');
      if (!productId) continue;
      const quantity = Number(qtyRaw ?? '1');
      const qty = Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1;
      const result = await addCartItem(
        { ...jar, anon },
        { productId, quantity: qty },
      );
      // Reuse the freshly-minted anon cart for the remaining children so every
      // line lands in the same cart.
      if (result.newAnonCookie) anon = result.newAnonCookie;
    }
    if (anon && anon !== (jar.anon ?? null)) await setAnonCartCookie(anon);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not add to cart.';
    redirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  redirect('/cart');
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
  if (selections.length === 0) redirect('/cart?error=missing-product');
  const jar = await readCartJar();
  let anon: string | null = jar.anon ?? null;
  try {
    for (const sel of selections) {
      const result = await addCartItem(
        { ...jar, anon },
        { productId: sel.productId, quantity: sel.quantity },
      );
      // Reuse the freshly-minted anon cart for the remaining slots so every
      // line lands in the same cart.
      if (result.newAnonCookie) anon = result.newAnonCookie;
    }
    if (anon && anon !== (jar.anon ?? null)) await setAnonCartCookie(anon);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not add to cart.';
    redirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  redirect('/cart');
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
  if (!productId) return { status: 'error', message: 'Nie udało się dodać produktu do koszyka.' };
  const qty = Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1;
  try {
    const result = await addCartItem(await readCartJar(), {
      productId,
      ...(variantId ? { variantId } : {}),
      ...(packagingUnitId ? { packagingUnitId } : {}),
      quantity: qty,
    });
    if (result.newAnonCookie) await setAnonCartCookie(result.newAnonCookie);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Nie udało się dodać produktu do koszyka.';
    return { status: 'error', message };
  }
  return { status: 'success', token: nextAddToCartToken(prevState) };
}
