import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
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
import { StockBadge } from '../../../../components/StockBadge';
import { AddToRfqForm } from '../../../../components/rfq/AddToRfqForm';
import { getProductBySlug } from '../../../../lib/api/catalog';
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

  return (
    <div className="container industria-pdp">
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

      <article className="b2b-pdp">
        {product.gallery && product.gallery.length > 0 ? (
          <GallerySwitcher gallery={product.gallery} alt={product.name} />
        ) : (
          <ProductGallery assets={product.assets} alt={product.name} />
        )}
        <div>
          <h1>{product.name}</h1>
          <small className="muted">SKU: {product.sku}</small>
          <p>{product.description}</p>

          <div className="b2b-card__meta" style={{ marginTop: 16 }}>
            <PriceTag price={product.price} locale={locale} />
            <StockBadge product={product} locale={locale} />
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
            {/* Feature 002 US5 — type switch for the action zone:
              * - simple/configurable keep the legacy Add-to-cart + RFQ
              * - grouped → GroupedSummary
              * - bundle → BundleConfigurator
              * - virtual → VirtualCta
              */}
            {product.type === 'simple' || product.type === 'configurable' ? (
              <>
                {product.price ? (
                  <a href="/cart" className="b2b-cta">
                    {t('product.addToCart')}
                  </a>
                ) : null}
                <AddToRfqForm productId={product.id} productSlug={product.slug} />
              </>
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
                <p
                  className="b2b-pdp__attribute-set"
                  style={{ fontSize: '0.875rem', color: 'var(--muted, #666)', marginBottom: 8 }}
                >
                  {product.attributeSet.name[locale] ??
                    product.attributeSet.name['en-US'] ??
                    Object.values(product.attributeSet.name)[0] ??
                    product.attributeSet.code}
                </p>
              ) : null}
              <table className="b2b-pdp__attributes">
                <tbody>
                  {Object.entries(product.attributeValues).map(([key, value]) => (
                    <tr key={key}>
                      <th scope="row">{key}</th>
                      <td>{String(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
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

      <script
        type="application/ld+json"
        // The backend builds the JSON-LD from the product entity, so the
        // strings come from a typed source — no XSS risk.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(product.structuredDataJsonLd) }}
      />
    </div>
  );
}
