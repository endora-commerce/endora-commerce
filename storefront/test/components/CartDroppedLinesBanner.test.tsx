import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartDroppedLinesBanner } from '../../components/CartDroppedLinesBanner';

/**
 * Feature 027 US3 — SSR contract for CartDroppedLinesBanner.
 *
 * Renders nothing on an empty list. Renders a yellow banner with the
 * intro line and a `<li>` per dropped product with a reason-specific
 * localised label.
 */

const STRINGS = {
  heading: 'Some lines were skipped',
  intro: 'These products were not added because:',
  reasonNotPurchasable: 'no longer available',
  reasonOutOfStock: 'out of stock',
  reasonNoPriceInCustomerList: 'no price available',
  reasonRemovedByConversion: 'skipped during conversion',
};

describe('CartDroppedLinesBanner — SSR rendering', () => {
  it('renders nothing on an empty list', () => {
    const html = renderToString(
      <CartDroppedLinesBanner droppedLines={[]} strings={STRINGS} />,
    );
    expect(html).toBe('');
  });

  it('renders one row per dropped line with the typed reason', () => {
    const html = renderToString(
      <CartDroppedLinesBanner
        droppedLines={[
          {
            productId: '00000000-0000-4000-8000-000000000101',
            productName: 'Brass widget',
            reason: 'not_purchasable',
          },
          {
            productId: '00000000-0000-4000-8000-000000000102',
            productName: 'Steel gear',
            reason: 'out_of_stock',
          },
        ]}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Some lines were skipped');
    expect(html).toContain('Brass widget');
    expect(html).toContain('no longer available');
    expect(html).toContain('Steel gear');
    expect(html).toContain('out of stock');
  });

  it('renders the no_price_in_customer_list reason label', () => {
    const html = renderToString(
      <CartDroppedLinesBanner
        droppedLines={[
          {
            productId: '00000000-0000-4000-8000-000000000101',
            productName: 'Bronze part',
            reason: 'no_price_in_customer_list',
          },
        ]}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Bronze part');
    expect(html).toContain('no price available');
  });
});
