import type { ReactNode } from 'react';
import type { ResolvedMenuItem } from '@endora-commerce/contracts';

interface MenuAssetProps {
  item: ResolvedMenuItem;
  className?: string;
}

/**
 * Renders a menu item of kind `asset`. Image assets render as `<img>`;
 * video assets render as a muted, autoplay loop with `preload="metadata"`
 * so the panel appears responsive without forcing a full download.
 */
export function MenuAsset({ item, className }: MenuAssetProps): ReactNode {
  const asset = item.asset;
  if (!asset) return null;
  if (asset.kind === 'image') {
    return (
      <img
        src={asset.url}
        alt={asset.label ?? item.label}
        className={className ?? 'h-auto w-full rounded-md object-cover'}
      />
    );
  }
  if (asset.kind === 'video') {
    return (
      <video
        src={asset.url}
        className={className ?? 'h-auto w-full rounded-md'}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label={asset.label ?? item.label}
      />
    );
  }
  return null;
}
