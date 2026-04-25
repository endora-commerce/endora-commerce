import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProductSummary } from '@b2b/contracts';
import { PriceTag } from './PriceTag';
import { StockBadge } from './StockBadge';
import { CompareToggle } from './CompareToggle';

/**
 * A grid-item product card. Keeps markup simple and semantic so
 * a theme's CSS can restyle it without touching the JSX.
 */
export function ProductCard(props: {
  product: ProductSummary;
  locale: string;
}): ReactNode {
  const { product, locale } = props;
  return (
    <article className="b2b-card">
      <Link href={`/p/${product.slug}`} className="b2b-card__link">
        <div className="b2b-card__media">
          {product.primaryAssetUrl ? (
            <img src={product.primaryAssetUrl} alt={product.name} loading="lazy" />
          ) : (
            <div className="b2b-card__media-placeholder" aria-hidden="true" />
          )}
        </div>
        <h3 className="b2b-card__name">{product.name}</h3>
      </Link>
      <div className="b2b-card__meta">
        <PriceTag price={product.price} locale={locale} />
        <StockBadge product={product} locale={locale} />
      </div>
      <small className="b2b-card__sku">{product.sku}</small>
      <CompareToggle slug={product.slug} locale={locale} />
    </article>
  );
}
