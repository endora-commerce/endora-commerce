export type BackgroundKind = 'none' | 'solid' | 'gradient' | 'image' | 'video';
export type MediaSourceKind = 'url' | 'library';

export interface BackgroundValue {
  kind: BackgroundKind;
  color?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngle?: number;
  imageSource?: MediaSourceKind;
  imageUrl?: string;
  imageAssetId?: string;
  videoSource?: MediaSourceKind;
  videoUrl?: string;
  videoAssetId?: string;
}

export type BackgroundProp = string | BackgroundValue | undefined;

/** Rebases host-relative media URLs onto the API origin (never the page origin). */
export function absolutizeBackgroundMediaUrl(url: string, mediaBaseUrl?: string): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (!url.startsWith('/')) return url;
  const base = mediaBaseUrl?.replace(/\/+$/, '');
  return base ? `${base}${url}` : url;
}

export function normalizeBackground(value: BackgroundProp): BackgroundValue {
  if (value === undefined || value === null || value === '') {
    return { kind: 'none' };
  }
  if (typeof value === 'string') {
    if (value === 'transparent') return { kind: 'none' };
    return { kind: 'solid', color: value };
  }
  if (!value.kind) return { kind: 'none' };
  return value;
}

export function backgroundToStyle(
  value: BackgroundProp,
  assets: Record<string, { url: string }> = {},
  mediaBaseUrl?: string,
): {
  style: Record<string, string>;
  videoUrl?: string;
} {
  const bg = normalizeBackground(value);
  if (bg.kind === 'none') return { style: {} };

  if (bg.kind === 'solid') {
    const color = bg.color && bg.color !== 'transparent' ? bg.color : undefined;
    return color ? { style: { backgroundColor: color } } : { style: {} };
  }

  if (bg.kind === 'gradient') {
    const from = bg.gradientFrom ?? '#ffffff';
    const to = bg.gradientTo ?? '#000000';
    const angle = bg.gradientAngle ?? 135;
    return {
      style: {
        background: `linear-gradient(${angle}deg, ${from}, ${to})`,
      },
    };
  }

  if (bg.kind === 'image') {
    const raw =
      bg.imageSource === 'library' && bg.imageAssetId
        ? assets[bg.imageAssetId]?.url ||
          (bg.imageAssetId ? `/assets/file/${bg.imageAssetId}` : '')
        : bg.imageUrl ?? '';
    const url = absolutizeBackgroundMediaUrl(raw, mediaBaseUrl);
    if (!url) return { style: {} };
    return {
      style: {
        backgroundImage: `url("${url.replace(/"/g, '\\"')}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      },
    };
  }

  if (bg.kind === 'video') {
    const raw =
      bg.videoSource === 'library' && bg.videoAssetId
        ? assets[bg.videoAssetId]?.url ||
          (bg.videoAssetId ? `/assets/file/${bg.videoAssetId}` : '')
        : bg.videoUrl ?? '';
    const url = absolutizeBackgroundMediaUrl(raw, mediaBaseUrl);
    return {
      style: {
        position: 'relative',
        overflow: 'hidden',
      },
      ...(url ? { videoUrl: url } : {}),
    };
  }

  return { style: {} };
}
