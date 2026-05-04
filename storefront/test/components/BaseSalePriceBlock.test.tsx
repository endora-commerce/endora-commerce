import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BaseSalePriceBlock } from '../../components/pricing/BaseSalePriceBlock';

/**
 * T071 — typographic-treatment coverage for the Base/Sale price block
 * across the three resolver outcomes the storefront has to render:
 *   - Base only (no Sale list matched).
 *   - Base + Sale (Special-Price treatment).
 *   - displayMode === 'none' (every price element hidden).
 *
 * Each test uses `renderToString` so the component is exercised
 * exactly the way the SSR HTML reaches the client (Constitution
 * Principle VII / FR-103) — same path the SEO suite uses for the
 * other reference-theme primitives.
 */

describe('BaseSalePriceBlock — Base only', () => {
  it('renders the formatted base amount without the strike-through column', () => {
    const html = renderToString(
      <BaseSalePriceBlock
        basePrice={{ amount: '199.00', currency: 'PLN' }}
        displayMode="net_only"
        locale="pl-PL"
      />,
    );
    expect(html).toContain('b2b-pricing-block');
    expect(html).toContain('data-display-mode="net_only"');
    expect(html).not.toContain('b2b-pricing-block__base--struck');
    expect(html).not.toContain('b2b-pricing-block__sale');
    // The amount is rendered through Intl.NumberFormat so the digit
    // group is locale-specific — assert the digits + currency code.
    expect(html).toMatch(/199/);
  });

  it('honours the gross_only display mode by surfacing only the gross column', () => {
    const html = renderToString(
      <BaseSalePriceBlock
        basePrice={{ amount: '100.00', currency: 'PLN' }}
        displayMode="gross_only"
        locale="pl-PL"
      />,
    );
    expect(html).toContain('b2b-pricing-block__columns--gross');
    expect(html).not.toContain('b2b-pricing-block__columns--net');
    // 100.00 net at the default 0.23 VAT rate → 123.00 gross
    expect(html).toMatch(/123/);
  });

  it('renders both columns for the both display mode', () => {
    const html = renderToString(
      <BaseSalePriceBlock
        basePrice={{ amount: '50.00', currency: 'EUR' }}
        displayMode="both"
        locale="en-US"
      />,
    );
    expect(html).toContain('b2b-pricing-block__columns--both');
    expect(html).toMatch(/50\.00/);
    // 50 net × 1.23 = 61.50 gross
    expect(html).toMatch(/61\.50/);
  });
});

describe('BaseSalePriceBlock — Base + Sale', () => {
  it('renders the Base struck-through alongside the Sale-highlighted amount', () => {
    const html = renderToString(
      <BaseSalePriceBlock
        basePrice={{ amount: '200.00', currency: 'PLN' }}
        salePrice={{ amount: '160.00', currency: 'PLN' }}
        displayMode="net_only"
        locale="pl-PL"
      />,
    );
    expect(html).toContain('b2b-pricing-block__base--struck');
    expect(html).toContain('b2b-pricing-block__sale');
    expect(html).toContain('Special price');
    expect(html).toMatch(/200/);
    expect(html).toMatch(/160/);
  });

  it('still renders the Sale price when displayMode is gross_only', () => {
    const html = renderToString(
      <BaseSalePriceBlock
        basePrice={{ amount: '100.00', currency: 'PLN' }}
        salePrice={{ amount: '80.00', currency: 'PLN' }}
        displayMode="gross_only"
        locale="pl-PL"
      />,
    );
    // 80 net × 1.23 = 98.40 gross — surfaced as the Sale amount
    expect(html).toMatch(/98[.,]40/);
    // Base struck-through column is also gross — 100 × 1.23 = 123.00
    expect(html).toMatch(/123/);
  });
});

describe('BaseSalePriceBlock — displayMode none', () => {
  it('renders absolutely nothing when the resolved mode hides every price element', () => {
    const html = renderToString(
      <BaseSalePriceBlock
        basePrice={{ amount: '50.00', currency: 'PLN' }}
        salePrice={{ amount: '40.00', currency: 'PLN' }}
        displayMode="none"
        locale="pl-PL"
      />,
    );
    expect(html).toBe('');
  });

  it('renders nothing when basePrice is null (resolver had no usable bracket)', () => {
    const html = renderToString(
      <BaseSalePriceBlock basePrice={null} displayMode="net_only" locale="pl-PL" />,
    );
    expect(html).toBe('');
  });
});
