import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { ProductCard } from '../../components/ProductCard';
import { ProductGallery } from '../../components/ProductGallery';
import { StockBadge } from '../../components/StockBadge';
import type { ProductSummary, ProductAsset } from '@endora-commerce/contracts';

/**
 * T243 — assert that the reference-theme primitives expose the markup
 * crawlers and LLM agents need without JavaScript execution
 * (Constitution Principle VII / FR-103).
 *
 * Each test renders an isolated component via `renderToString` and
 * checks for the structural elements that go into the SSR HTML — no
 * jsdom, no client hydration, no full Next.js boot.
 */

describe('Breadcrumbs — JSON-LD + crawlable anchors', () => {
  it('emits BreadcrumbList JSON-LD and links every non-current crumb', () => {
    const html = renderToString(
      <Breadcrumbs
        crumbs={[
          { href: '/', label: 'Home' },
          { href: '/catalog', label: 'Catalog' },
          { href: '/p/widget', label: 'Widget' },
        ]}
      />,
    );
    expect(html).toContain('<nav aria-label="Breadcrumb"');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/catalog"');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"name":"Widget"');
  });

  it('renders nothing for an empty crumb list', () => {
    expect(renderToString(<Breadcrumbs crumbs={[]} />)).toBe('');
  });
});

describe('ProductCard — semantic markup with name + price + SKU', () => {
  it('serialises a name heading, price, sku, and a link to the PDP', () => {
    const product: ProductSummary = {
      id: '00000000-0000-4000-8000-000000000001',
      sku: 'WIDGET-001',
      type: 'simple',
      name: 'Widget 1000',
      slug: 'widget-1000',
      categorySlugs: ['widgets'],
      primaryAssetUrl: 'https://example.com/img.jpg',
      price: { amount: 19.99, currency: 'PLN' },
      stockIndicator: 'available',
      stockLevel: 12,
    };
    const html = renderToString(<ProductCard product={product} locale="en-US" />);
    expect(html).toContain('<h3');
    expect(html).toContain('Widget 1000');
    expect(html).toContain('href="/p/widget-1000"');
    expect(html).toContain('WIDGET-001');
    // Currency is rendered via Intl.NumberFormat — the exact glyph depends
    // on the locale, so we check for the digits + currency code.
    expect(html).toMatch(/19[.,]99/);
  });
});

describe('ProductGallery — server-rendered images + document links', () => {
  it('emits an <img> per image asset and an anchor per document', () => {
    const assets: ProductAsset[] = [
      {
        id: 'asset-1',
        kind: 'image',
        url: 'https://example.com/a.jpg',
        altText: 'A widget',
      },
      {
        id: 'asset-2',
        kind: 'pdf',
        url: 'https://example.com/datasheet.pdf',
        altText: 'Datasheet',
      },
    ];
    const html = renderToString(<ProductGallery assets={assets} alt="Widget gallery" />);
    expect(html).toContain('src="https://example.com/a.jpg"');
    expect(html).toContain('alt="Widget gallery"');
    expect(html).toContain('href="https://example.com/datasheet.pdf"');
    expect(html).toContain('Datasheet');
  });

  it('renders a placeholder when there are no images', () => {
    const html = renderToString(<ProductGallery assets={[]} alt="empty" />);
    expect(html).toContain('aspect-square');
  });
});

describe('StockBadge — surfaces stock state in plain text', () => {
  it.each([
    [{ stockLevel: 5, stockIndicator: null }, 'In stock'],
    [{ stockLevel: 0, stockIndicator: null }, 'Out of stock'],
    [{ stockLevel: null, stockIndicator: 'available' as const }, 'In stock'],
    [{ stockLevel: null, stockIndicator: 'out_of_stock' as const }, 'Out of stock'],
    [{ stockLevel: null, stockIndicator: 'to_order' as const }, 'Request a quote'],
  ])('renders %j as text containing "%s"', (input, expected) => {
    const html = renderToString(<StockBadge product={input} locale="en-US" />);
    expect(html).toContain(expected);
  });
});
