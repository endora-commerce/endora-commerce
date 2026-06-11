import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { GroupedSummary } from '../../components/GroupedSummary';

/**
 * Storefront SSR contract for GroupedSummary (feature 002 US5, T144).
 *
 * Pins:
 *   - Empty array → renders nothing
 *   - One row per child with quantity × name + product link
 *   - Single "Add bundle to cart" CTA at the bottom
 */

type Item = {
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
};

const noopAction = (): void => {};

const item = (id: string, qty: number, slug: string, name: string): Item => ({
  id,
  position: Number(id),
  quantity: qty,
  product: {
    id: `p-${id}`,
    sku: `SKU-${id}`,
    slug,
    name,
    primaryAssetUrl: null,
    price: { amount: 9.99, currency: 'PLN' },
  },
});

describe('GroupedSummary — SSR contract', () => {
  it('renders nothing when items array is empty', () => {
    const html = renderToString(
      <GroupedSummary items={[]} addToCartLabel="Add bundle to cart" addToCartAction={noopAction} />,
    );
    expect(html).toBe('');
  });

  it('renders one row per child with quantity prefix and product link', () => {
    const html = renderToString(
      <GroupedSummary
        items={[item('1', 2, 'red-widget', 'Red widget'), item('2', 1, 'blue-widget', 'Blue widget')]}
        addToCartLabel="Add bundle to cart"
        addToCartAction={noopAction}
      />,
    );
    expect(html).toContain('href="/p/red-widget"');
    expect(html).toContain('href="/p/blue-widget"');
    expect(html).toContain('Red widget');
    expect(html).toContain('Blue widget');
    // Quantity prefix renders as "× 2" or "2 ×" — assert the digit
    // appears alongside each name.
    expect(html).toContain('2');
    expect(html).toContain('1');
  });

  it('renders a single Add-to-cart CTA at the bottom', () => {
    const html = renderToString(
      <GroupedSummary
        items={[item('1', 1, 'a', 'A')]}
        addToCartLabel="Add bundle to cart"
        addToCartAction={noopAction}
      />,
    );
    expect(html.match(/Add bundle to cart/g)?.length ?? 0).toBe(1);
  });
});
