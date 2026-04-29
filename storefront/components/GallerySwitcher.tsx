import type { ReactNode } from 'react';

/**
 * Feature 002 US3 — label-aware product gallery for the PDP.
 *
 * Server-renders Base Image as the primary main view; the thumbnail strip
 * highlights the Small Image when one is set. Clicking a thumbnail switches
 * the main view via a hash anchor (progressive enhancement — works without
 * JS thanks to scroll-target CSS, themes can layer in client behaviour).
 */

export type GalleryLabel = 'base_image' | 'small_image' | 'thumbnail';

export interface GallerySwitcherItem {
  id: string;
  position: number;
  labels: GalleryLabel[];
  asset: { id: string; kind: string; url: string };
}

export function GallerySwitcher(props: {
  gallery: GallerySwitcherItem[];
  alt: string;
}): ReactNode {
  if (props.gallery.length === 0) {
    return <div className="b2b-gallery__placeholder" aria-hidden="true" />;
  }

  const baseImage = props.gallery.find((g) => g.labels.includes('base_image'));
  const primary = baseImage ?? props.gallery[0]!;

  return (
    <div className="b2b-gallery">
      <img
        className="b2b-gallery__main"
        src={primary.asset.url}
        alt={props.alt}
        loading="eager"
      />
      <ul className="b2b-gallery__strip">
        {props.gallery.map((item) => {
          const isSmall = item.labels.includes('small_image');
          return (
            <li key={item.id} {...(isSmall ? { 'data-small-image': 'true' } : {})}>
              <a href={`#gallery-${item.id}`}>
                <img
                  className="b2b-gallery__thumb"
                  src={item.asset.url}
                  alt={props.alt}
                  loading="lazy"
                />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
