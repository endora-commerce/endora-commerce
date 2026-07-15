import { normalizeResponsive } from '@b2b/page-builder-core';
import type { CSSProperties, ReactElement } from 'react';

export function ProductCardSkeleton(): ReactElement {
  return (
    <article className="cmsc-pb-product-card cmsc-pb-skel-product-card" aria-hidden>
      <div className="cmsc-pb-product-card__media cmsc-pb-product-card__media--square">
        <div className="cmsc-pb-skel-block cmsc-pb-skel-product-card__media-fill" />
      </div>
      <div className="cmsc-pb-product-card__body">
        <div className="cmsc-pb-skel-block cmsc-pb-skel-product-card__line cmsc-pb-skel-product-card__line--sku" />
        <div className="cmsc-pb-skel-block cmsc-pb-skel-product-card__line cmsc-pb-skel-product-card__line--name" />
        <div className="cmsc-pb-skel-block cmsc-pb-skel-product-card__line cmsc-pb-skel-product-card__line--stock" />
        <div className="cmsc-pb-skel-block cmsc-pb-skel-product-card__line cmsc-pb-skel-product-card__line--price" />
      </div>
    </article>
  );
}

type ResponsiveNumber = number | { base: number; tablet?: number; desktop?: number };

function slideBasisPercent(perView: number): string {
  return `${100 / Math.max(1, perView)}%`;
}

function skeletonTrackStyle(slidesPerView: ResponsiveNumber, gap: ResponsiveNumber): CSSProperties {
  const slides = normalizeResponsive(slidesPerView, 1);
  const gaps = normalizeResponsive(gap, 16);
  const tabletSlides = slides.tablet ?? slides.base;
  const desktopSlides = slides.desktop ?? tabletSlides;
  const tabletGap = gaps.tablet ?? gaps.base;
  const desktopGap = gaps.desktop ?? tabletGap;

  return {
    gap: `${gaps.base}px`,
    ['--slide-basis' as string]: slideBasisPercent(slides.base),
    ['--slide-basis-md' as string]: slideBasisPercent(tabletSlides),
    ['--slide-basis-lg' as string]: slideBasisPercent(desktopSlides),
    ['--pb-skel-gap' as string]: `${gaps.base}px`,
    ['--pb-skel-gap-md' as string]: `${tabletGap}px`,
    ['--pb-skel-gap-lg' as string]: `${desktopGap}px`,
  };
}

export function ProductSliderSkeleton({
  count = 3,
  slidesPerView = 1,
  gap = 16,
}: {
  count?: number;
  slidesPerView?: ResponsiveNumber;
  gap?: ResponsiveNumber;
}): ReactElement {
  return (
    <div className="cmsc-pb-skel-carousel" aria-busy="true" aria-label="Loading products">
      <div className="cmsc-pb-skel-carousel__track" style={skeletonTrackStyle(slidesPerView, gap)}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="cmsc-pb-skel-carousel__slide">
            <ProductCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProductGridSkeleton({
  count = 4,
  columns = 4,
  gap = 16,
}: {
  count?: number;
  columns?: number;
  gap?: number;
}): ReactElement {
  return (
    <ul
      className="cmsc-pb-product-grid cmsc-pb-skel-grid"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}
      aria-busy="true"
      aria-label="Loading products"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <ProductCardSkeleton />
        </li>
      ))}
    </ul>
  );
}

export function CategoryListSkeleton({ count = 5 }: { count?: number }): ReactElement {
  return (
    <ul className="cmsc-pb-category-list cmsc-pb-skel-list" aria-busy="true" aria-label="Loading categories">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <div
            className="cmsc-pb-skel-block cmsc-pb-skel-category-line"
            style={{ width: `${55 + (i % 3) * 12}%` }}
          />
        </li>
      ))}
    </ul>
  );
}

export function CategoryGridSkeleton({
  count = 4,
  columns = 4,
  gap = 16,
}: {
  count?: number;
  columns?: number;
  gap?: number;
}): ReactElement {
  return (
    <ul
      className="cmsc-pb-category-grid cmsc-pb-skel-grid"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}
      aria-busy="true"
      aria-label="Loading categories"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="cmsc-pb-skel-category-card">
          <div className="cmsc-pb-skel-block cmsc-pb-skel-category-card__media" />
          <div className="cmsc-pb-skel-block cmsc-pb-skel-category-card__line" />
        </li>
      ))}
    </ul>
  );
}
