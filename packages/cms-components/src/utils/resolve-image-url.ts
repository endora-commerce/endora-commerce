import type { BreakpointTier } from '@b2b/page-builder-core';

export type ImageSourceKind = 'url' | 'library';

export interface CmsAssetMap {
  [assetId: string]: { url: string; mimeType?: string };
}

export interface ImageUrlProps {
  imageSource?: ImageSourceKind;
  src?: string;
  assetId?: string;
}

/**
 * Rebases host-relative media URLs onto the API origin.
 * Never uses `window.location.origin` — admin/storefront origins have no `/assets/file` route.
 */
export function absolutizeMediaUrl(url: string, mediaBaseUrl?: string): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (!url.startsWith('/')) return url;
  const base = mediaBaseUrl?.replace(/\/+$/, '');
  return base ? `${base}${url}` : url;
}

export function resolveImageUrl(
  props: ImageUrlProps,
  _tier: BreakpointTier | null,
  assets: CmsAssetMap = {},
  mediaBaseUrl?: string,
): string {
  const source = props.imageSource ?? 'url';

  if (source === 'library' && props.assetId) {
    const fromAssets = assets[props.assetId]?.url;
    const raw = fromAssets && fromAssets.length > 0 ? fromAssets : `/assets/file/${props.assetId}`;
    return absolutizeMediaUrl(raw, mediaBaseUrl);
  }

  return props.src ? absolutizeMediaUrl(props.src, mediaBaseUrl) : '';
}
