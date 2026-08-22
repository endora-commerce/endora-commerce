import type { ReactNode } from 'react';
import type { ProductAsset } from '@endora-commerce/contracts';
import { GallerySwitcher, type GallerySwitcherItem } from './GallerySwitcher';
import { toAbsoluteAssetUrl } from '../lib/asset-url';

/**
 * PDP gallery for products that expose flat `assets` (no label-aware
 * `gallery` payload). Images and videos are mapped into the shared
 * `GallerySwitcher` presentation — square main viewport, zoom pill, and a
 * thumbnail strip below the main view (Industria design). PDFs and
 * certificates are surfaced as a small links list under the gallery.
 */
export function ProductGallery(props: {
  assets: ProductAsset[];
  alt: string;
  /** Fallback image shown when the product has no images of its own
   *  (resolved from the `product_image_placeholder_url` setting). */
  placeholderUrl?: string | null;
}): ReactNode {
  const media = props.assets.filter((a) => a.kind === 'image' || a.kind === 'video');
  const documents = props.assets.filter((a) => a.kind === 'pdf' || a.kind === 'certificate');

  const gallery: GallerySwitcherItem[] = media.map((a, i) => ({
    id: a.id,
    position: i,
    labels: i === 0 ? ['base_image'] : [],
    asset: { id: a.id, kind: a.kind, url: a.url },
  }));

  return (
    <div>
      {gallery.length > 0 ? (
        <GallerySwitcher gallery={gallery} alt={props.alt} />
      ) : props.placeholderUrl ? (
        <img
          src={toAbsoluteAssetUrl(props.placeholderUrl)}
          alt={props.alt}
          loading="lazy"
          className="aspect-square w-full rounded-md border border-line bg-surface object-contain"
        />
      ) : (
        <div className="aspect-square rounded-md bg-surface-alt" aria-hidden="true" />
      )}
      {documents.length > 0 ? (
        <ul className="m-0 mt-3 flex list-none gap-3 p-0">
          {documents.map((doc) => (
            <li key={doc.id}>
              <a href={toAbsoluteAssetUrl(doc.url)} rel="noopener" target="_blank">
                {doc.altText ?? doc.kind.toUpperCase()}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
