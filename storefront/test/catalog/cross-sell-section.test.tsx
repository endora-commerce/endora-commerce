import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CrossSellSection } from '../../components/CrossSellSection';

/**
 * T113 — SSR contract for CrossSellSection (feature 002 US4 cart).
 * Pure react-dom/server.renderToString — foundation pattern.
 *
 * Pins:
 *   - Renders nothing when array is empty
 *   - One card per link with name + price + product link href
 *   - Deduplicates across cart items: when the same target appears via
 *     multiple cart entries, it's rendered once
 *   - Single section heading "Dokup także" / "You may also need"
 */

type LinkSummary = {
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
};

const link = (id: string, slug: string, name: string, productId?: string): LinkSummary => ({
  id,
  kind: 'cross_sell',
  position: Number(id),
  product: {
    id: productId ?? `p-${id}`,
    sku: `SKU-${id}`,
    slug,
    name,
    primaryAssetUrl: null,
    price: { amount: 19.99, currency: 'PLN' },
  },
});

describe('CrossSellSection — SSR contract', () => {
  it('renders nothing when no cross-sell links', () => {
    const html = renderToString(
      <CrossSellSection links={[]} heading="You may also need" locale="en-US" />,
    );
    expect(html).toBe('');
  });

  it('renders a single section heading + one card per link', () => {
    const html = renderToString(
      <CrossSellSection
        links={[link('1', 'gloves', 'Safety gloves'), link('2', 'helmet', 'Helmet')]}
        heading="You may also need"
        locale="en-US"
      />,
    );
    expect(html.match(/You may also need/g)?.length ?? 0).toBe(1);
    expect(html).toContain('Safety gloves');
    expect(html).toContain('Helmet');
    expect(html).toContain('href="/p/gloves"');
    expect(html).toContain('href="/p/helmet"');
  });

  it('deduplicates cross-sell targets across cart items', () => {
    const sharedProduct = 'p-shared-1';
    const html = renderToString(
      <CrossSellSection
        links={[
          link('1', 'shared', 'Shared item', sharedProduct),
          link('2', 'shared', 'Shared item', sharedProduct),
          link('3', 'unique', 'Unique item'),
        ]}
        heading="You may also need"
        locale="en-US"
      />,
    );
    // 'Shared item' appears once; 'Unique item' appears once.
    expect(html.match(/Shared item/g)?.length ?? 0).toBe(1);
    expect(html.match(/Unique item/g)?.length ?? 0).toBe(1);
  });
});
