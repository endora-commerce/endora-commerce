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
}): ReactNode {
  const images = props.assets.filter((a) => a.kind === 'image');
  const documents = props.assets.filter((a) => a.kind === 'pdf' || a.kind === 'certificate');

  return (
    <div className="b2b-gallery">
      {images.length > 0 ? (
        <ul className="b2b-gallery__images">
          {images.map((img) => (
            <li key={img.id}>
              <img src={img.url} alt={img.altText ?? props.alt} loading="lazy" />
            </li>
          ))}
        </ul>
      ) : (
        <div className="b2b-gallery__placeholder" aria-hidden="true" />
      )}
      {documents.length > 0 ? (
        <ul className="b2b-gallery__documents">
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
