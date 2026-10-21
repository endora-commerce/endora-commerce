import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ProductSummary } from '@endora-commerce/contracts';
import { ProductCard } from '../../components/ProductCard';
import { VariantPicker } from '../../components/VariantPicker';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Feature 160 (FR-024, FR-025, FR-031) — what a card and the variant picker
 * show of price-book prices:
 *
 * - a product whose variants cost different amounts is listed "from" its
 *   lowest price;
 * - a card whose price is a charged sale strikes the buyer's own price through;
 * - the variant picker shows each variant's **resolved** price, never the old
 *   `price_override`.
 */

function summary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    sku: 'SKU-1',
    type: 'simple',
    name: 'Widget',
    slug: 'widget',
    categorySlugs: [],
    primaryAssetUrl: null,
    price: { amount: 80, currency: 'PLN' },
    stockIndicator: null,
    stockLevel: null,
    ...overrides,
  };
}

describe('ProductCard — price-book fields', () => {
  it('strikes the compare-at price through when a sale is charged (FR-025)', () => {
    const html = renderToString(
      <ProductCard product={summary({ price: { amount: 90, currency: 'PLN' }, compareAtPrice: { amount: 95, currency: 'PLN' } })} locale="pl-PL" salesChannelCode={undefined} />,
    );
    expect(html).toContain('data-testid="card-compare-at"');
    expect(html).toMatch(/<s[^>]*data-testid="card-compare-at"[^>]*>[^<]*95,00/);
  });

  it('shows no compare-at without a charged sale', () => {
    const html = renderToString(<ProductCard product={summary()} locale="pl-PL" salesChannelCode={undefined} />);
    expect(html).not.toContain('card-compare-at');
  });

  it('labels a product whose variants differ as "from" its lowest price (FR-024), EN and PL', () => {
    const pl = renderToString(<ProductCard product={summary({ priceVariesByVariant: true })} locale="pl-PL" salesChannelCode={undefined} />);
    expect(pl).toContain(tForLocale('pl-PL')('product.priceFromVariants'));
    const en = renderToString(<ProductCard product={summary({ priceVariesByVariant: true })} locale="en-US" salesChannelCode={undefined} />);
    expect(en).toContain(tForLocale('en-US')('product.priceFromVariants'));
    expect(tForLocale('en-US')('product.priceFromVariants')).not.toBe(tForLocale('pl-PL')('product.priceFromVariants'));
  });
});

describe('VariantPicker — resolved variant prices (FR-031)', () => {
  const labels = { heading: 'Variants', sku: 'SKU', stockLevel: 'In stock', outOfStock: 'Out of stock', selectThisVariant: 'Selected' };

  it('prints the resolved price of each variant that has one', () => {
    const html = renderToString(
      <VariantPicker
        productSlug="widget"
        locale="pl-PL"
        variants={[
          { id: 'r', sku: 'W-RED', variantAttributeValues: { color: 'red' }, price: { amount: '88.0000', currency: 'PLN' } },
          { id: 'b', sku: 'W-BLUE', variantAttributeValues: { color: 'blue' }, price: null },
        ]}
        labels={labels}
      />,
    );
    expect(html).toContain('data-testid="variant-price-W-RED"');
    expect(html).toContain('88,00');
    expect(html).not.toContain('variant-price-W-BLUE');
  });
});
