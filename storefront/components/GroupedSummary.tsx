import type { ReactNode } from 'react';
import { formatMoney } from '../lib/i18n/money';

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
  /**
   * Server action that adds the whole set to the cart. Each child is submitted
   * as a hidden `item` field encoded `productId:quantity`; the action loops
   * over them and adds one cart line per child.
   */
  addToCartAction: (formData: FormData) => void | Promise<void>;
  /** Active Sales Channel display locale (e.g. `pl-PL`). */
  locale?: string;
}): ReactNode {
  if (props.items.length === 0) return null;

  return (
    <form action={props.addToCartAction} className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-2 rounded-md border border-line p-[12px]">
        {props.items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-[13px]">
            <span className="font-mono text-muted">{item.quantity} ×</span>
            <a href={`/p/${item.product.slug}`} className="text-fg hover:text-accent">
              {item.product.name}
            </a>
            {item.product.price ? (
              <span className="ml-auto font-mono font-medium text-fg">
                {formatMoney(item.product.price.amount * item.quantity, item.product.price.currency, props.locale)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {props.items.map((item) => (
        <input
          key={item.id}
          type="hidden"
          name="item"
          value={`${item.product.id}:${item.quantity}`}
        />
      ))}
      <button type="submit" className="b2b-cta">
        {props.addToCartLabel}
      </button>
    </form>
  );
}
