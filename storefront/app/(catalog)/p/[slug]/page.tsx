import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs } from '../../../../components/Breadcrumbs';
import { ProductGallery } from '../../../../components/ProductGallery';
import { GallerySwitcher } from '../../../../components/GallerySwitcher';
import { AttachmentsList } from '../../../../components/AttachmentsList';
import { ProductLinksSections } from '../../../../components/ProductLinksSections';
import { BundleConfigurator } from '../../../../components/BundleConfigurator';
import { GroupedSummary } from '../../../../components/GroupedSummary';
import { VirtualCta } from '../../../../components/VirtualCta';
import { VariantPicker } from '../../../../components/VariantPicker';
import { PriceTag } from '../../../../components/PriceTag';
import { PdpPriceToggle } from '../../../../components/pricing/PdpPriceToggle';
import { PdpStickyBuyBar } from '../../../../components/mobile/PdpStickyBuyBar';
import { StockBadge } from '../../../../components/StockBadge';
import { NotifyWhenAvailableDialog } from '../../../../components/inventory/NotifyWhenAvailableDialog';
import { BackorderHint } from '../../../../components/inventory/BackorderHint';
import { ProductBuyActions } from '../../../../components/ProductBuyActions';
import { AddToShoppingListButton } from '../../../../components/AddToShoppingListButton';
import { QuoteRequestCta } from '../../../../components/pricing/QuoteRequestCta';

const PDP_API_BASE =
  process.env['NEXT_PUBLIC_BACKEND_BASE_URL'] ??
  process.env['BACKEND_BASE_URL'] ??
  'http://localhost:3001';
import { ParametryTab } from '../../../../components/attributes/ParametryTab';
import { Hook } from '../../../../components/Hook';
import { getStorefrontQuoteRequestSettings } from '../../../../lib/api/rfq';
import { getProductBySlug } from '../../../../lib/api/catalog';
import { getStorefrontProductStock } from '../../../../lib/api/inventory';
import { getResolvedPrice } from '../../../../lib/api/pricing';
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
import { tForLocale } from '../../../../lib/i18n/messages';
import { StorefrontApiError } from '../../../../lib/api/client';

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
    const product = await getProductBySlug(slug, ctx);
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
      openGraph: {
        title: `${product.seo.openGraph.title}${titleSuffix}`,
        description: product.seo.openGraph.description,
        images: product.seo.openGraph.imageUrl ? [product.seo.openGraph.imageUrl] : undefined,
      },
    };
  } catch {
    return { title: 'Product not found' };
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
  const isQuoteOnly = resolvedPrice?.displayMode === 'none';
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

  // Feature 044 / US3 — mobile sticky add-to-cart bar visibility mirrors the
  // inline "Add to cart" conditions (simple/configurable, priced, not
  // quote-only, not notify-only). The datasheet shortcut points at the first
  // attachment, when present.
  const showStickyBuyBar =
    (product.type === 'simple' || product.type === 'configurable') &&
    !isQuoteOnly &&
    !!product.price &&
    !stock?.showNotifyButton;
  const datasheetHref = product.attachments?.[0]?.asset.url;

  return (
    <div className="mx-auto max-w-[1360px] px-[24px] pt-[18px] pb-[64px] max-md:pb-[96px]">
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
          {product.description ? (
            <p className="mb-4 text-[15px] leading-[1.55] text-muted">{product.description}</p>
          ) : null}

          {/* Keep the stock badge directly beside the price (not pushed to the
              opposite edge) so availability reads as part of the price block. */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {resolvedPrice && resolvedPrice.displayMode === 'both' ? (
              <PdpPriceToggle
                basePrice={resolvedPrice.basePrice}
                salePrice={resolvedPrice.salePrice}
                locale={locale}
                labels={{ net: 'NETTO', gross: 'BRUTTO' }}
              />
            ) : (
              <PriceTag
                price={product.price}
                resolved={resolvedPrice}
                locale={locale}
                variant="pdp"
              />
            )}
            <StockBadge product={product} stock={stock} locale={locale} />
          </div>

          {stock?.backorderEnabled && stock.isOutOfStock ? (
            <BackorderHint label={t('product.backorder.hint')} />
          ) : null}

          <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
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
                  unitPrice={product.price ?? null}
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
                  {product.price || rfqSettings.showAddToQuoteOnPdp ? (
                    <ProductBuyActions
                      productId={product.id}
                      productSlug={product.slug}
                      productName={product.name}
                      unitPrice={product.price ?? null}
                      {...(selectedVariantId ? { variantId: selectedVariantId } : {})}
                      showCart={!!product.price && !stock?.showNotifyButton}
                      showQuote={rfqSettings.showAddToQuoteOnPdp}
                      packagingUnits={product.packagingUnits}
                      singlePieceLabel={t('product.packaging.singlePiece')}
                      piecesLabel={t('product.packaging.pieces')}
                      addToCartAction={addToCartAction}
                      addToCartLabel={t('product.addToCart')}
                      // First action in the row, right before "Dodaj do zapytania".
                      leadingAction={
                        <AddToShoppingListButton
                          apiBase={PDP_API_BASE}
                          productId={product.id}
                          {...(selectedVariantId ? { variantId: selectedVariantId } : {})}
                          label="Dodaj do listy zakupowej"
                          removeLabel="Usuń z listy zakupowej"
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
                      label="Dodaj do listy zakupowej"
                      removeLabel="Usuń z listy zakupowej"
                    />
                  )}
                  {oneClickEnabled && product.price ? (
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
                virtual={product.virtual}
                labels={{
                  buyAndDownload: t('product.virtual.buyAndDownload'),
                  digitalDelivery: t('product.virtual.digitalDelivery'),
                }}
              />
            ) : null}
          </div>
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
            />
          ) : null}

          {product.attachments && product.attachments.length > 0 ? (
            <AttachmentsList attachments={product.attachments} locale={locale} />
          ) : null}

          {Object.keys(product.attributeValues).length > 0 ? (
            <div style={{ marginTop: 24 }}>
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

          {/* Feature 012 / US6 — "Parametry produktu" tab. Surfaces only
              attributes the operator has flagged isVisibleOnProductPage
              AND that have a value on this product. Renders the resolved
              per-locale option label for select-style values. Returns
              null (omits the tab) when nothing matches (FR-030). */}
          <ParametryTab
            attributes={
              (product as { visibleAttributes?: Array<{ key: string; label: string; valueType: string; valueRendered: string }> })
                .visibleAttributes ?? null
            }
            locale={locale}
          />
        </div>
      </article>

      {product.links ? (
        <ProductLinksSections
          related={product.links.related}
          upSell={product.links.upSell}
          labels={{
            related: t('product.links.related'),
            upSell: t('product.links.upSell'),
            seeAll: t('product.links.seeAll'),
          }}
        />
      ) : null}
      <Hook code="product.bottom" />

      {showStickyBuyBar ? (
        <PdpStickyBuyBar
          productId={product.id}
          {...(selectedVariantId ? { variantId: selectedVariantId } : {})}
          addToCartAction={addToCartAction}
          addToCartLabel={t('product.addToCart')}
          {...(datasheetHref ? { datasheetHref } : {})}
        />
      ) : null}

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

async function addToCartAction(formData: FormData): Promise<void> {
  'use server';
  const productId = ((formData.get('productId') as string) ?? '').trim();
  const variantId = ((formData.get('variantId') as string) ?? '').trim();
  const packagingUnitId = ((formData.get('packagingUnitId') as string) ?? '').trim();
  const quantity = Number(formData.get('quantity') ?? '1');
  if (!productId) redirect('/cart?error=missing-product');
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
      err instanceof StorefrontApiError ? err.message : 'Could not add to cart.';
    redirect(`/cart?error=${encodeURIComponent(message)}`);
  }
  redirect('/cart');
}
