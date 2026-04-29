import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { VariantPicker } from '../../components/VariantPicker';

/**
 * T043 — Server-rendering test for the VariantPicker (feature 002 US2).
 * Mirrors the foundation `seo/components.test.tsx` pattern: pure
 * `react-dom/server.renderToString` calls so the assertions run on the
 * SSR HTML — no JSDOM / RTL boot needed (foundation doesn't ship one).
 *
 * Constitution Principle VII (SEO/discoverability) requires variants to
 * be crawlable + functional without JavaScript; these tests pin that
 * contract.
 */

const labels = {
  heading: 'Variants',
  sku: 'SKU',
  priceOverride: 'Price',
  stockLevel: 'In stock',
  outOfStock: 'Out of stock',
  selectThisVariant: 'Currently selected',
} as const;

describe('VariantPicker — SSR contract', () => {
  it('renders nothing when there are zero variants', () => {
    const html = renderToString(
      <VariantPicker productSlug="widget" variants={[]} labels={labels} />,
    );
    expect(html).toBe('');
  });

  it('emits one anchor per variant with /p/<slug>?variant=<sku>', () => {
    const html = renderToString(
      <VariantPicker
        productSlug="widget"
        variants={[
          { id: 'a', sku: 'WID-RED-M', variantAttributeValues: { color: 'red', size: 'M' } },
          { id: 'b', sku: 'WID-BLUE-L', variantAttributeValues: { color: 'blue', size: 'L' } },
        ]}
        labels={labels}
      />,
    );
    expect(html).toContain('href="/p/widget?variant=WID-RED-M"');
    expect(html).toContain('href="/p/widget?variant=WID-BLUE-L"');
  });

  it('marks exactly one (the selected) variant with aria-current="true"', () => {
    const html = renderToString(
      <VariantPicker
        productSlug="widget"
        variants={[
          { id: 'a', sku: 'WID-A', variantAttributeValues: { color: 'red' } },
          { id: 'b', sku: 'WID-B', variantAttributeValues: { color: 'blue' } },
        ]}
        selectedSku="WID-A"
        labels={labels}
      />,
    );
    // Exactly one anchor carries aria-current="true" — the selected one.
    expect(html.match(/aria-current="true"/g)?.length ?? 0).toBe(1);
    // The selected anchor MUST be the one whose href ends with the
    // selected SKU. Match the anchor open tag and check it's WID-A's.
    const aMatch = html.match(/<a[^>]*aria-current="true"[^>]*>/);
    expect(aMatch?.[0] ?? '').toContain('href="/p/widget?variant=WID-A"');
  });

  it('marks out-of-stock variants with aria-disabled and the localized label', () => {
    const html = renderToString(
      <VariantPicker
        productSlug="widget"
        variants={[
          { id: 'a', sku: 'WID-OOS', variantAttributeValues: {}, stockLevel: 0 },
          { id: 'b', sku: 'WID-OK', variantAttributeValues: {}, stockLevel: 5 },
        ]}
        labels={labels}
      />,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html.match(/aria-disabled="true"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('Out of stock');
    expect(html).toContain('In stock: 5');
  });

  it('renders priceOverride when present', () => {
    const html = renderToString(
      <VariantPicker
        productSlug="widget"
        variants={[
          { id: 'a', sku: 'WID-PRICED', variantAttributeValues: {}, priceOverride: 49.99 },
        ]}
        labels={labels}
      />,
    );
    expect(html).toContain('Price');
    expect(html).toContain('49.99');
  });

  it('SKU is shown inside a <code> for crawler-friendly identification', () => {
    const html = renderToString(
      <VariantPicker
        productSlug="widget"
        variants={[
          { id: 'a', sku: 'WID-SEMANTIC', variantAttributeValues: {} },
        ]}
        labels={labels}
      />,
    );
    expect(html).toContain('<code>WID-SEMANTIC</code>');
  });
});
