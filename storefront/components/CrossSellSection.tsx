import type { ReactNode } from 'react';
import type { ProductLinkSummary } from './ProductLinksSections';

/**
 * Feature 002 US4 — "You may also need" section on the
 * cart page. Receives the union of cross-sell links across all cart
 * items; deduplicates by product id so the same target shows up once
 * even when reached via multiple cart entries.
 */

export function CrossSellSection(props: {
  links: ProductLinkSummary[];
  heading: string;
  locale: string;
}): ReactNode {
  if (props.links.length === 0) return null;

  // Dedupe by target product id; keep the first-seen link's position so
  // the backend's curated ordering survives (cart-side dedup just drops
  // later duplicates).
  const seen = new Set<string>();
  const unique: ProductLinkSummary[] = [];
  for (const link of props.links) {
    if (seen.has(link.product.id)) continue;
    seen.add(link.product.id);
    unique.push(link);
  }
  if (unique.length === 0) return null;

  return (
    <section className="b2b-cross-sell" aria-labelledby="b2b-cross-sell-heading">
      <h2 id="b2b-cross-sell-heading" className="b2b-cross-sell__heading">
        {props.heading}
      </h2>
      <ul className="b2b-cross-sell__list">
        {unique.map((link) => (
          <li key={link.id} className="b2b-cross-sell__card">
            <a href={`/p/${link.product.slug}`} className="b2b-cross-sell__link">
              {link.product.primaryAssetUrl ? (
                <img
                  src={link.product.primaryAssetUrl}
                  alt=""
                  className="b2b-cross-sell__thumb"
                  loading="lazy"
                />
              ) : (
                <div className="b2b-cross-sell__thumb b2b-cross-sell__thumb--placeholder" />
              )}
              <span className="b2b-cross-sell__name">{link.product.name}</span>
              {link.product.price ? (
                <span className="b2b-cross-sell__price">
                  {link.product.price.amount.toFixed(2)} {link.product.price.currency}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
