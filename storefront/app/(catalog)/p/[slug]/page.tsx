import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../../../components/Breadcrumbs';
import { ProductGallery } from '../../../../components/ProductGallery';
import { PriceTag } from '../../../../components/PriceTag';
import { StockBadge } from '../../../../components/StockBadge';
import { getProductBySlug } from '../../../../lib/api/catalog';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';
import { StorefrontApiError } from '../../../../lib/api/client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * PDP — server-rendered, with backend-resolved meta + JSON-LD, gallery,
 * attribute table, and an action zone (request quote / add to cart). The
 * action buttons are server-rendered links today; a theme adds client-side
 * cart wiring by replacing them.
 */

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { ctx } = await getServerContext();
  try {
    const product = await getProductBySlug(slug, ctx);
    return {
      title: product.seo.metaTitle,
      description: product.seo.metaDescription,
      openGraph: {
        title: product.seo.openGraph.title,
        description: product.seo.openGraph.description,
        images: product.seo.openGraph.imageUrl ? [product.seo.openGraph.imageUrl] : undefined,
      },
    };
  } catch {
    return { title: 'Product not found' };
  }
}

export default async function ProductPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
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
    <>
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
        <ProductGallery assets={product.assets} alt={product.name} />
        <div>
          <h1>{product.name}</h1>
          <small className="muted">SKU: {product.sku}</small>
          <p>{product.description}</p>

          <div className="b2b-card__meta" style={{ marginTop: 16 }}>
            <PriceTag price={product.price} locale={locale} />
            <StockBadge product={product} locale={locale} />
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <a href="#" className="b2b-cta">
              {product.price ? t('product.addToCart') : t('product.requestQuote')}
            </a>
          </div>

          {Object.keys(product.attributeValues).length > 0 ? (
            <table className="b2b-pdp__attributes" style={{ marginTop: 24 }}>
              <tbody>
                {Object.entries(product.attributeValues).map(([key, value]) => (
                  <tr key={key}>
                    <th scope="row">{key}</th>
                    <td>{String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </article>

      <script
        type="application/ld+json"
        // The backend builds the JSON-LD from the product entity, so the
        // strings come from a typed source — no XSS risk.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(product.structuredDataJsonLd) }}
      />
    </>
  );
}
