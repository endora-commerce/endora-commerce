import type { ReactNode } from 'react';

/**
 * Feature 002 US5 — read-only summary of a grouped product's children
 * with a single "Add bundle to cart" CTA. Buyer cannot configure a
 * grouped product (research §US5: grouped = fixed contents, bundle =
 * configurable).
 */

export interface GroupedSummaryItem {
  id: string;
  position: number;
  quantity: number;
  product: {
    id: string;
    sku: string;
    slug: string;
    name: string;
    primaryAssetUrl: string | null;
    price: { amount: number; currency: string } | null;
  };
}

export function GroupedSummary(props: {
  items: GroupedSummaryItem[];
  addToCartLabel: string;
}): ReactNode {
  if (props.items.length === 0) return null;

  return (
    <div className="b2b-grouped-summary">
      <ul className="b2b-grouped-summary__list">
        {props.items.map((item) => (
          <li key={item.id} className="b2b-grouped-summary__row">
            <span className="b2b-grouped-summary__qty">{item.quantity} ×</span>
            <a href={`/p/${item.product.slug}`} className="b2b-grouped-summary__link">
              {item.product.name}
            </a>
            {item.product.price ? (
              <span className="b2b-grouped-summary__price">
                {(item.product.price.amount * item.quantity).toFixed(2)}{' '}
                {item.product.price.currency}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <a href="/cart" className="b2b-cta">
        {props.addToCartLabel}
      </a>
    </div>
  );
}
