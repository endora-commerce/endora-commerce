import type { ReactNode } from 'react';
import type { ProductAsset } from '@b2b/contracts';

/**
 * Image-only gallery for the reference theme. PDFs and certificates are
 * surfaced as a small links list below the grid so server-only rendering
 * still exposes them. Themes that need richer behaviour (lightbox, video)
 * replace this component entirely.
 */
export function ProductGallery(props: {
  assets: ProductAsset[];
  alt: string;
  /** Fallback image shown when the product has no images of its own
   *  (resolved from the `product_image_placeholder_url` setting). */
  placeholderUrl?: string | null;
}): ReactNode {
  const images = props.assets.filter((a) => a.kind === 'image');
  const documents = props.assets.filter((a) => a.kind === 'pdf' || a.kind === 'certificate');

  return (
    <div>
      {images.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0">
          {images.map((img) => (
            <li key={img.id}>
              <img
                src={img.url}
                alt={img.altText ?? props.alt}
                loading="lazy"
                className="w-full rounded-md"
              />
            </li>
          ))}
        </ul>
      ) : props.placeholderUrl ? (
        <img
          src={props.placeholderUrl}
          alt={props.alt}
          loading="lazy"
          className="aspect-[4/3] w-full rounded-md object-contain bg-surface-alt"
        />
      ) : (
        <div className="aspect-[4/3] rounded-md bg-surface-alt" aria-hidden="true" />
      )}
      {documents.length > 0 ? (
        <ul className="m-0 mt-3 flex list-none gap-3 p-0">
          {documents.map((doc) => (
            <li key={doc.id}>
              <a href={doc.url} rel="noopener" target="_blank">
                {doc.altText ?? doc.kind.toUpperCase()}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
