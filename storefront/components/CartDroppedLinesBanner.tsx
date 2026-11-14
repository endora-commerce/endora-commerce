import type { ReactNode } from 'react';

/**
 * CartDroppedLinesBanner (feature 027 US3).
 *
 * Renders a banner at the top of the full cart view (or as a redirect-
 * target banner after a QR→Cart / ShoppingList→Cart conversion) listing
 * the products that were skipped during the conversion and the typed
 * reason for each skip.
 *
 * Feature 155 (FR-011) — a line left out because it would leave its product
 * below a minimum is reported as such, with the minimum, distinct from
 * "no price available".
 *
 * Returns null when the list is empty — the consumer can render
 * unconditionally.
 */

export type DroppedLineReason =
  | 'not_purchasable'
  | 'out_of_stock'
  | 'no_price_in_customer_list'
  | 'removed_by_conversion'
  | 'below_minimum';

interface DroppedLine {
  productId: string;
  productName: string;
  reason: DroppedLineReason;
  /** Feature 155 — the minimum a `below_minimum` line missed. */
  minimum?: number | undefined;
}

interface CartDroppedLinesBannerProps {
  droppedLines: DroppedLine[];
  /** Locale-aware strings. */
  strings: {
    heading: string;
    intro: string;
    reasonNotPurchasable: string;
    reasonOutOfStock: string;
    reasonNoPriceInCustomerList: string;
    reasonRemovedByConversion: string;
    /** Feature 155 — `droppedBelowMinimumReason(minimum, locale)` from `lib/batchReport`. */
    reasonBelowMinimum: (minimum: number | undefined) => string;
  };
}

export function CartDroppedLinesBanner({
  droppedLines,
  strings,
}: CartDroppedLinesBannerProps): ReactNode {
  if (droppedLines.length === 0) return null;
  return (
    <div role="alert" className="b2b-auth__warning mb-4 px-4 py-3 text-[14px]">
      <h2 className="m-0 mb-2 text-[0.95rem]">{strings.heading}</h2>
      <p className="m-0 mb-2">{strings.intro}</p>
      <ul className="m-0 pl-5">
        {droppedLines.map((line, index) => (
          // A product can be dropped twice (two variants), so the product id alone is no key.
          <li key={`${line.productId}:${index}`}>
            <strong>{line.productName}</strong>
            {' — '}
            <span className="text-warn">{labelFor(line, strings)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function labelFor(line: DroppedLine, strings: CartDroppedLinesBannerProps['strings']): string {
  switch (line.reason) {
    case 'not_purchasable':
      return strings.reasonNotPurchasable;
    case 'out_of_stock':
      return strings.reasonOutOfStock;
    case 'no_price_in_customer_list':
      return strings.reasonNoPriceInCustomerList;
    case 'removed_by_conversion':
      return strings.reasonRemovedByConversion;
    case 'below_minimum':
      return strings.reasonBelowMinimum(line.minimum);
  }
}
