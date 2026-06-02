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
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-2 rounded-md border border-line p-[12px]">
        {props.items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-[13px]">
            <span className="font-mono text-muted">{item.quantity} ×</span>
            <a href={`/p/${item.product.slug}`} className="text-fg hover:text-accent">
              {item.product.name}
            </a>
            {item.product.price ? (
              <span className="ml-auto font-mono font-medium text-fg">
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
