import type { ReactNode } from 'react';

/**
 * Feature 002 US4 — Related + Up-sell sections rendered after the
 * attribute table on the PDP. Cross-sell entries are NOT rendered here:
 * they belong on the cart page (CrossSellSection). Backend pre-filters
 * inactive targets and channel-restricted ones, so the component just
 * renders what it gets.
 *
 * "See all" affordance: the backend caps related at 8 / up-sell at 4
 * (spec.md US4 Assumptions). When more exist, the component shows a
 * link to the full listing — but the canonical UX renders only what's
 * provided.
 */

export interface ProductLinkSummary {
  id: string;
  kind: 'related' | 'up_sell' | 'cross_sell';
  position: number;
  product: {
    id: string;
    sku: string;
    slug: string;
    name: string;
    primaryAssetUrl: string | null;
    price: { amount: number; currency: string } | null;
  };
}

export interface ProductLinksLabels {
  related: string;
  upSell: string;
  seeAll: string;
}

function LinkCard({ link }: { link: ProductLinkSummary }): ReactNode {
  return (
    <li className="b2b-product-links__card">
      <a href={`/p/${link.product.slug}`} className="b2b-product-links__link">
        {link.product.primaryAssetUrl ? (
          <img
            src={link.product.primaryAssetUrl}
            alt=""
            className="b2b-product-links__thumb"
            loading="lazy"
          />
        ) : (
          <div className="b2b-product-links__thumb b2b-product-links__thumb--placeholder" />
        )}
        <span className="b2b-product-links__name">{link.product.name}</span>
        {link.product.price ? (
          <span className="b2b-product-links__price">
            {link.product.price.amount.toFixed(2)} {link.product.price.currency}
          </span>
        ) : null}
      </a>
    </li>
  );
}

export function ProductLinksSections(props: {
  related: ProductLinkSummary[];
  upSell: ProductLinkSummary[];
  labels: ProductLinksLabels;
}): ReactNode {
  if (props.related.length === 0 && props.upSell.length === 0) return null;

  return (
    <div className="b2b-product-links">
      {props.related.length > 0 ? (
        <section className="b2b-product-links__section" data-kind="related">
          <h2 className="b2b-product-links__heading">{props.labels.related}</h2>
          <ul className="b2b-product-links__list">
            {props.related.map((link) => (
              <LinkCard key={link.id} link={link} />
            ))}
          </ul>
        </section>
      ) : null}
      {props.upSell.length > 0 ? (
        <section className="b2b-product-links__section" data-kind="up-sell">
          <h2 className="b2b-product-links__heading">{props.labels.upSell}</h2>
          <ul className="b2b-product-links__list">
            {props.upSell.map((link) => (
              <LinkCard key={link.id} link={link} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
