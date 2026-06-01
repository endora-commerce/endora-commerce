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
      style={{
        background: '#fffaeb',
        border: '1px solid #d4a000',
        borderRadius: '0.25rem',
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
      }}
    >
      <h2 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>{strings.heading}</h2>
      <p style={{ margin: '0 0 0.5rem' }}>{strings.intro}</p>
      <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
        {droppedLines.map((line) => (
          <li key={line.productId}>
            <strong>{line.productName}</strong>
            {' — '}
            <span style={{ color: '#a06000' }}>{labelFor(line.reason, strings)}</span>
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
