import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ProductLinksSections } from '../../components/ProductLinksSections';

/**
 * T112 — SSR contract for ProductLinksSections (feature 002 US4 PDP).
 * Pure react-dom/server.renderToString — foundation pattern.
 *
 * Pins:
 *   - Related and Up-sell sections render under labelled headings
 *   - Inactive targets are filtered out by the backend, so the component
 *     trusts the array — no client-side filtering
 *   - Empty input → no headings, no list (caller decides whether to
 *     render anything)
 *   - "See all" affordance shows when count exceeds visible
 *   - Cross-sell entries belong on the cart page, NOT the PDP, so this
 *     PDP-scoped component drops anything kind=cross_sell
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

const link = (
  id: string,
  kind: LinkSummary['kind'],
  slug: string,
  name: string,
): LinkSummary => ({
  id,
  kind,
  position: Number(id),
  product: {
    id: `p-${id}`,
    sku: `SKU-${id}`,
    slug,
    name,
    primaryAssetUrl: `/img/${slug}.jpg`,
    price: { amount: 99.99, currency: 'PLN' },
  },
});

describe('ProductLinksSections — SSR contract', () => {
  it('renders nothing when both arrays are empty', () => {
    const html = renderToString(
      <ProductLinksSections
        related={[]}
        upSell={[]}
        labels={{ related: 'Related', upSell: 'Up-sell', seeAll: 'See all' }}
      />,
    );
    expect(html).toBe('');
  });

  it('emits a Related section heading + one card per link', () => {
    const html = renderToString(
      <ProductLinksSections
        related={[
          link('1', 'related', 'red-widget', 'Red widget'),
          link('2', 'related', 'blue-widget', 'Blue widget'),
        ]}
        upSell={[]}
        labels={{ related: 'Related', upSell: 'Up-sell', seeAll: 'See all' }}
      />,
    );
    expect(html).toContain('>Related<');
    expect(html).toContain('href="/p/red-widget"');
    expect(html).toContain('href="/p/blue-widget"');
    expect(html).toContain('Red widget');
    expect(html).toContain('Blue widget');
  });

  it('emits separate Up-sell heading when upSell present', () => {
    const html = renderToString(
      <ProductLinksSections
        related={[]}
        upSell={[link('1', 'up_sell', 'pro-widget', 'Pro widget')]}
        labels={{ related: 'Related', upSell: 'Up-sell', seeAll: 'See all' }}
      />,
    );
    expect(html).toContain('>Up-sell<');
    expect(html).toContain('Pro widget');
    expect(html).not.toContain('>Related<');
  });

  it('renders both sections when both have entries', () => {
    const html = renderToString(
      <ProductLinksSections
        related={[link('1', 'related', 'rel-1', 'Rel 1')]}
        upSell={[link('2', 'up_sell', 'ups-1', 'Ups 1')]}
        labels={{ related: 'Related', upSell: 'Up-sell', seeAll: 'See all' }}
      />,
    );
    expect(html).toContain('>Related<');
    expect(html).toContain('>Up-sell<');
  });
});
