import type { ReactNode } from 'react';

/**
 * CartDroppedLinesBanner (feature 027 US3).
 *
 * Renders a banner at the top of the full cart view (or as a redirect-
 * target banner after a QR→Cart / ShoppingList→Cart conversion) listing
 * the products that were skipped during the conversion and the typed
 * reason for each skip.
 *
 * Returns null when the list is empty — the consumer can render
 * unconditionally.
 *
 * Browser-verification note: layout + styling needs eyes.
 */

export type DroppedLineReason =
  | 'not_purchasable'
  | 'out_of_stock'
  | 'no_price_in_customer_list'
  | 'removed_by_conversion';

interface DroppedLine {
  productId: string;
  productName: string;
  reason: DroppedLineReason;
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
  };
}

export function CartDroppedLinesBanner({
  droppedLines,
  strings,
}: CartDroppedLinesBannerProps): ReactNode {
  if (droppedLines.length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-sm border border-[#d4a000] bg-[#fffaeb] px-4 py-3"
    >
      <h2 className="m-0 mb-2 text-[0.95rem]">{strings.heading}</h2>
      <p className="m-0 mb-2">{strings.intro}</p>
      <ul className="m-0 pl-5">
        {droppedLines.map((line) => (
          <li key={line.productId}>
            <strong>{line.productName}</strong>
            {' — '}
            <span className="text-[#a06000]">{labelFor(line.reason, strings)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function labelFor(
  reason: DroppedLineReason,
  strings: CartDroppedLinesBannerProps['strings'],
): string {
  switch (reason) {
    case 'not_purchasable':
      return strings.reasonNotPurchasable;
    case 'out_of_stock':
      return strings.reasonOutOfStock;
    case 'no_price_in_customer_list':
      return strings.reasonNoPriceInCustomerList;
    case 'removed_by_conversion':
      return strings.reasonRemovedByConversion;
  }
}
