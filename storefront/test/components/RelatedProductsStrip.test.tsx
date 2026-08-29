import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { BlogProductCard } from '@endora-commerce/contracts';
import { RelatedProductsStrip } from '../../app/blog/_components/RelatedProductsStrip';

/**
 * Regression guard — product links must use the canonical `/p/[slug]` route,
 * not the non-existent `/products/...` path that 404s. (Same fix applied to
 * the search autocomplete dropdown.)
 */

const PRODUCT: BlogProductCard = {
  id: '11111111-2222-4333-8444-555555555555',
  slug: 'demo-screws-0040',
  name: 'Demo screws 0040',
  mainImageUrl: null,
  price: { amount: '12.50', currency: 'PLN' },
};

describe('RelatedProductsStrip — SSR rendering', () => {
  it('renders nothing when there are no related products', () => {
    const html = renderToString(<RelatedProductsStrip products={[]} />);
    expect(html).toBe('');
  });

  it('links each product to the canonical /p/[slug] route', () => {
    const html = renderToString(
      <RelatedProductsStrip
        products={[
          PRODUCT,
          { ...PRODUCT, id: '99999999-8888-4777-8666-555555555555', slug: 'shiny-grommet', name: 'Shiny grommet' },
        ]}
      />,
    );
    expect(html).toContain('href="/p/demo-screws-0040"');
    expect(html).toContain('href="/p/shiny-grommet"');
    // The broken pattern must never come back.
    expect(html).not.toContain('/products/');
  });
});
