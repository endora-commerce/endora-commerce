'use client';

import { type CSSProperties } from 'react';
import {
  CORNER_RADIUS_PX,
  resolveResponsiveNumber,
  type BreakpointTier,
} from '@endora-commerce/page-builder-core';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import type { CmsProductCardProps } from '../schema/component-types.js';
import { useCatalogBlockData } from '../hooks/use-catalog-block-data.js';
import { productCardDataRequest } from '../utils/catalog-block-data.js';

function formatPrice(product: CmsProductSummary, locale: string): string | null {
  if (!product.price) return null;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: product.price.currency,
  }).format(product.price.amount);
}

function mediaRatioClass(imageRatio: CmsProductCardProps['imageRatio']): string {
  if (imageRatio === '4:3') return 'cmsc-pb-product-card__media--43';
  if (imageRatio === '16:9') return 'cmsc-pb-product-card__media--169';
  if (imageRatio === 'auto') return 'cmsc-pb-product-card__media--auto';
  return 'cmsc-pb-product-card__media--square';
}

export function productCardLayoutStyle(
  props: {
    maxWidthPx?: CmsProductCardProps['maxWidthPx'];
    imageHeightPx?: CmsProductCardProps['imageHeightPx'];
    imageObjectFit?: CmsProductCardProps['imageObjectFit'];
    cornerRadius?: CmsProductCardProps['cornerRadius'];
  },
  tier: BreakpointTier = 'desktop',
): { card: CSSProperties; media: CSSProperties; img: CSSProperties } {
  const maxWidth = resolveResponsiveNumber(props.maxWidthPx, tier, 0);
  const imageHeight = resolveResponsiveNumber(props.imageHeightPx, tier, 0);
  return {
    card: {
      ...(maxWidth > 0 ? { maxWidth: `${maxWidth}px`, width: '100%' } : {}),
      ...(props.cornerRadius
        ? { borderRadius: `${CORNER_RADIUS_PX[props.cornerRadius]}px` }
        : {}),
    },
    media: {
      ...(imageHeight > 0 ? { height: `${imageHeight}px`, aspectRatio: 'unset' } : {}),
    },
    img: {
      objectFit: props.imageObjectFit ?? 'contain',
      ...(props.imageObjectFit && props.imageObjectFit !== 'contain'
        ? { maxWidth: '100%', maxHeight: '100%' }
        : {}),
    },
  };
}

export function CmsProductCardView({
  product,
  locale = 'pl-PL',
  showPrice = true,
  showSku = true,
  showStock = true,
  imageRatio = 'square',
  imageObjectFit = 'contain',
  maxWidthPx,
  imageHeightPx,
  cornerRadius,
  variant = 'default',
  ctaLabel,
  previewTier = 'desktop',
}: {
  product: CmsProductSummary;
  locale?: string;
  showPrice?: boolean;
  showSku?: boolean;
  showStock?: boolean;
  imageRatio?: CmsProductCardProps['imageRatio'];
  imageObjectFit?: CmsProductCardProps['imageObjectFit'];
  maxWidthPx?: CmsProductCardProps['maxWidthPx'];
  imageHeightPx?: CmsProductCardProps['imageHeightPx'];
  cornerRadius?: CmsProductCardProps['cornerRadius'];
  variant?: CmsProductCardProps['variant'];
  ctaLabel?: string;
  previewTier?: BreakpointTier;
}): React.ReactElement {
  const ratioClass = mediaRatioClass(imageRatio);
  const price = showPrice ? formatPrice(product, locale) : null;
  const layout = productCardLayoutStyle(
    {
      ...(maxWidthPx !== undefined ? { maxWidthPx } : {}),
      ...(imageHeightPx !== undefined ? { imageHeightPx } : {}),
      ...(imageObjectFit !== undefined ? { imageObjectFit } : {}),
      ...(cornerRadius !== undefined ? { cornerRadius } : {}),
    },
    previewTier,
  );

  return (
    <article
      className={`cmsc-pb-product-card cmsc-pb-product-card--${variant}`}
      style={layout.card}
    >
      <a
        href={`/p/${product.slug}`}
        className={`cmsc-pb-product-card__media ${ratioClass}`}
        style={layout.media}
      >
        {product.primaryAssetUrl ? (
          <img
            src={product.primaryAssetUrl}
            alt={product.name}
            loading="lazy"
            style={layout.img}
          />
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
  props: CmsProductCardProps & { locale?: string; editing?: boolean; previewTier?: BreakpointTier },
): React.ReactElement {
  const { productSlug, editing = false, locale = 'pl-PL', previewTier, ...viewProps } = props;
  // Provided by the page's server render on the storefront; fetched from an effect only in
  // the editor preview, which is the one caller that ever sees `loading`.
  const { loading, data } = useCatalogBlockData<CmsProductSummary[]>(productCardDataRequest({ productSlug }));
  const product = data?.[0] ?? null;

  if (!productSlug) {
    return (
      <div className="cmsc-pb-product-card cmsc-pb-product-card--placeholder">
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Select a product</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="cmsc-pb-product-card cmsc-pb-product-card--placeholder">
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Loading product…</p>
      </div>
    );
  }
  if (!product) {
    return (
      <div className="cmsc-pb-product-card cmsc-pb-product-card--placeholder">
        <p className="cmsc:text-sm cmsc:text-[#64748b]">
          {editing ? 'Product not found' : 'Product unavailable'}
        </p>
      </div>
    );
  }
  return (
    <CmsProductCardView
      product={product}
      locale={locale}
      {...(previewTier !== undefined ? { previewTier } : {})}
      {...viewProps}
    />
  );
}
