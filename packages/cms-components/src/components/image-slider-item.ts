import type { CSSProperties } from 'react';
import { CORNER_RADIUS_PX } from '@b2b/page-builder-core';
import type { ImageSliderItem } from '../schema/component-types.js';

/** Flatten nested `image` onto top-level fields used by resolveImageUrl. */
export function normalizeImageSliderItem(item: ImageSliderItem): ImageSliderItem {
  const image = item.image;
  if (!image) return item;
  return {
    ...item,
    imageSource: image.imageSource ?? item.imageSource ?? 'url',
    src: image.src ?? item.src ?? '',
    assetId: image.assetId ?? item.assetId ?? '',
  };
}

export function syncImageSliderItemImage(item: ImageSliderItem): ImageSliderItem {
  const imageSource = item.image?.imageSource ?? item.imageSource ?? 'url';
  const src = item.image?.src ?? item.src ?? '';
  const assetId = item.image?.assetId ?? item.assetId ?? '';
  return {
    ...item,
    image: { imageSource, src, assetId },
    imageSource,
    src,
    assetId,
  };
}

export function imageSliderTitleStyle(item: ImageSliderItem): CSSProperties {
  const radius = item.titleBorderRadius
    ? CORNER_RADIUS_PX[item.titleBorderRadius]
    : undefined;
  const borderWidth = item.titleBorderWidth ?? 0;
  return {
    ...(item.titleBackground ? { background: item.titleBackground } : {}),
    ...(item.titleColor ? { color: item.titleColor } : {}),
    ...(item.titlePaddingPx != null ? { padding: `${item.titlePaddingPx}px` } : {}),
    ...(radius != null ? { borderRadius: `${radius}px` } : {}),
    ...(borderWidth > 0
      ? {
          borderStyle: 'solid',
          borderWidth: `${borderWidth}px`,
          borderColor: item.titleBorderColor ?? '#ffffff',
        }
      : {}),
  };
}
