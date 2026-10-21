import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { PriceTag } from '../../components/PriceTag';

/**
 * D-287 P0 — the product page and the home page's cards are priced by the
 * catalogue read they already make.
 *
 * The product detail and the listing carry `resolvedPrice` (base, sale, display
 * mode) from the resolution that priced `price`. The product page used to ask
 * `GET /storefront/products/:id/resolved-price` beside the detail — every view
 * resolved its product twice — and the home page fanned out one such request
 * per bestseller card (`specs/pricing/read-paths-and-performance.md` §2.1).
 * The backend half — the detail calls the pricing engine once and never
 * `resolveEngine` — is asserted in
 * `backend/test/integration/price_lists/customer-own-group-every-path.test.ts`.
 */

const source = (path: string): string => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('one price resolution per catalogue surface', () => {
  it('the product page reads the detail’s resolvedPrice, and asks resolved-price only for a selected variant', () => {
    const page = source('app/(catalog)/p/[slug]/page.tsx');
    expect(page).toContain('product.resolvedPrice');
    // Feature 160 (FR-031) — a selected variant is priced as itself: exactly one
    // call, guarded by the selection, so a page without one resolves once.
    expect(page.match(/getResolvedPrice\s*\(/g) ?? []).toHaveLength(1);
    expect(page).toMatch(/if \(selectedVariantId\) \{\s*const variantResolved = await getResolvedPrice\(/);
  });

  it('the home page’s cards read the listing’s resolvedPrice, with no per-card fan-out', () => {
    const home = source('app/page.tsx');
    expect(home).not.toContain('getResolvedPricesBulk');
    expect(home).not.toMatch(/getResolvedPrice\s*\(/);
    expect(home).toContain('p.resolvedPrice');
  });

  it('a summary’s resolvedPrice renders the sale with the base struck through', () => {
    const html = renderToString(
      <PriceTag
        price={{ amount: 7, currency: 'PLN' }}
        resolved={{
          basePrice: { amount: '10.0000', currency: 'PLN' },
          salePrice: { amount: '7.0000', currency: 'PLN' },
          displayMode: 'net_only',
        }}
        locale="en-US"
        variant="pdp"
      />,
    );
    expect(html).toContain('7.00');
    expect(html).toContain('10.00');
  });
});
