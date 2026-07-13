'use client';

import { useEffect, useState } from 'react';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import type { CmsProductCardProps } from '../schema/component-types.js';

function formatPrice(product: CmsProductSummary, locale: string): string | null {
  if (!product.price) return null;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: product.price.currency,
  }).format(product.price.amount);
}

export function CmsProductCardView({
  product,
  locale = 'pl-PL',
  showPrice = true,
  showSku = true,
  showStock = true,
  imageRatio = 'square',
  variant = 'default',
  ctaLabel,
}: {
  product: CmsProductSummary;
  locale?: string;
  showPrice?: boolean;
  showSku?: boolean;
  showStock?: boolean;
  imageRatio?: CmsProductCardProps['imageRatio'];
  variant?: CmsProductCardProps['variant'];
  ctaLabel?: string;
}): React.ReactElement {
  const ratioClass = imageRatio === '4:3' ? 'cmsc-pb-product-card__media--43' : 'cmsc-pb-product-card__media--square';
  const price = showPrice ? formatPrice(product, locale) : null;

  return (
    <article className={`cmsc-pb-product-card cmsc-pb-product-card--${variant}`}>
      <a href={`/p/${product.slug}`} className={`cmsc-pb-product-card__media ${ratioClass}`}>
        {product.primaryAssetUrl ? (
          <img src={product.primaryAssetUrl} alt={product.name} loading="lazy" />
        ) : (
          <span className="cmsc-pb-product-card__placeholder" aria-hidden />
        )}
      </a>
      <div className="cmsc-pb-product-card__body">
        {showSku && product.sku ? <span className="cmsc-pb-product-card__sku">{product.sku}</span> : null}
        <a href={`/p/${product.slug}`} className="cmsc-pb-product-card__name">
          {product.name}
        </a>
        {showStock && product.stockLevel != null ? (
          <span className="cmsc-pb-product-card__stock">{String(product.stockLevel)}</span>
        ) : null}
        {price ? <span className="cmsc-pb-product-card__price">{price}</span> : null}
        {ctaLabel ? (
          <a href={`/p/${product.slug}`} className="cmsc-pb-product-card__cta">
            {ctaLabel}
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function CmsProductCardLoader(
  props: CmsProductCardProps & { locale?: string; editing?: boolean },
): React.ReactElement {
  const { productSlug, editing = false, locale = 'pl-PL', ...viewProps } = props;
  const [product, setProduct] = useState<CmsProductSummary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!productSlug) {
      setProduct(null);
      setError(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { fetchProductsBySlugs } = await import('../utils/catalog-fetch.js');
        const list = await fetchProductsBySlugs([productSlug]);
        if (!cancelled) {
          setProduct(list[0] ?? null);
          setError(!list[0]);
        }
      } catch {
        if (!cancelled) {
          setProduct(null);
          setError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productSlug]);

  if (!productSlug) {
    return (
      <div className="cmsc-pb-product-card cmsc-pb-product-card--placeholder">
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Select a product</p>
      </div>
    );
  }
  if (error || !product) {
    return (
      <div className="cmsc-pb-product-card cmsc-pb-product-card--placeholder">
        <p className="cmsc:text-sm cmsc:text-[#64748b]">
          {editing ? `Loading product…` : 'Product unavailable'}
        </p>
      </div>
    );
  }
  return <CmsProductCardView product={product} locale={locale} {...viewProps} />;
}
