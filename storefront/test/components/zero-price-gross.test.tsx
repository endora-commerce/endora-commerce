import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ProductSummary } from '@endora-commerce/contracts';
import { ProductRow } from '../../components/ProductRow';
import { ProductCard } from '../../components/ProductCard';

/**
 * Issue #132 — a free product renders as free, on the listing surfaces too.
 *
 * The backend chain now keeps "no price" and "priced at zero" apart in the
 * type. The storefront has to keep them apart in the render: a `0` amount is a
 * price and gets the same net + gross treatment every other amount gets.
 */

function summary(price: ProductSummary['price']): ProductSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    sku: 'SKU-1',
    type: 'simple',
    name: 'Widget',
    slug: 'widget',
    categorySlugs: [],
    primaryAssetUrl: null,
    price,
    stockIndicator: null,
    stockLevel: null,
  };
}

describe('ProductRow — a zero price is a price', () => {
  it('renders both the net and the derived gross figure for a price of zero', () => {
    const html = renderToString(
      <ProductRow product={summary({ amount: 0, currency: 'PLN' })} locale="pl-PL" />,
    );
    expect(html).toContain('od / szt.');
    expect(html).toContain('brutto');
  });

  it('renders no price at all — and no gross line — when there is none', () => {
    const html = renderToString(
      <ProductRow product={summary(null)} locale="pl-PL" />,
    );
    expect(html).not.toContain('brutto');
  });

  it('derives the gross figure at a caller-supplied rate', () => {
    const html = renderToString(
      <ProductRow
        product={summary({ amount: 100, currency: 'PLN' })}
        locale="pl-PL"
        vatRate={0.05}
      />,
    );
    expect(html).toMatch(/105/);
    expect(html).not.toMatch(/123/);
  });
});

describe('ProductCard — a zero price keeps its gross line', () => {
  it('renders the derived gross line for a price of zero', () => {
    const html = renderToString(
      <ProductCard product={summary({ amount: 0, currency: 'PLN' })} locale="pl-PL" />,
    );
    expect(html).toContain('brutto');
  });

  it('derives the gross figure at a caller-supplied rate', () => {
    const html = renderToString(
      <ProductCard
        product={summary({ amount: 100, currency: 'PLN' })}
        locale="pl-PL"
        vatRate={0.05}
      />,
    );
    expect(html).toMatch(/105/);
    expect(html).not.toMatch(/123/);
  });
});
