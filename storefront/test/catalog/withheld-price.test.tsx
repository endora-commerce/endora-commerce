import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ProductSummary, SearchSuggestItem } from '@endora-commerce/contracts';
import { ProductCard } from '../../components/ProductCard';
import { PriceTag } from '../../components/PriceTag';
import { renderSuggestionPrice } from '../../components/SearchAutocomplete';
import { tForLocale } from '../../lib/i18n/messages';
import { moduleActionPresence } from '../../lib/module-action-presence';

/** Every action module present: what these cases render is not about presence (issue #672). */
const ALL_PRESENT = moduleActionPresence({ isPresent: () => true });

/**
 * Issue #491 — display mode `none` withholds every amount on the server, so the
 * storefront receives no figure at all: `price` `null`, `resolvedPrice` with
 * `basePrice` and `salePrice` `null` and `displayMode: 'none'` (vector W1 of
 * `specs/pricing/worked-examples.md` §10.19). Every surface still renders
 * "price on request" from the display mode — the listing card (catalogue and
 * search listings, which render it without `resolved`), the home-page card,
 * the product page and the typeahead — and renders no number.
 */

const en = tForLocale('en-US');

/** A product as the backend answers it under `none`. */
const WITHHELD: ProductSummary = {
  id: '00000000-0000-4000-8000-00000000f001',
  sku: 'VIEWER-PRICED-0001',
  type: 'simple',
  name: 'Viewer priced probe',
  slug: 'viewer-priced-0001',
  categorySlugs: [],
  primaryAssetUrl: null,
  price: null,
  stockIndicator: null,
  stockLevel: null,
  resolvedPrice: { basePrice: null, salePrice: null, displayMode: 'none' },
};

const SUGGESTION: SearchSuggestItem = (() => {
  const { resolvedPrice: _resolved, ...rest } = WITHHELD;
  return { ...rest, basePrice: null, salePrice: null, priceDisplayMode: 'none' };
})();

/** The visible text of server-rendered markup, whitespace collapsed. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;| | /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A money figure in either locale's spelling. */
const AMOUNT = /\d+[.,]\d{2}/;

describe('a withheld price renders "price on request" and no figure (#491)', () => {
  it('the listing card, rendered without `resolved`', () => {
    const out = text(renderToString(<ProductCard presence={ALL_PRESENT} product={WITHHELD} locale="en-US" salesChannelCode={undefined} />));
    expect(out).toContain(en('product.requestQuote'));
    expect(out).not.toMatch(AMOUNT);
  });

  it('the home-page card, rendered from `resolvedPrice`', () => {
    const html = renderToString(
      <ProductCard presence={ALL_PRESENT} product={WITHHELD} resolved={WITHHELD.resolvedPrice ?? null} locale="en-US" salesChannelCode={undefined} />,
    );
    expect(text(html)).not.toMatch(AMOUNT);
    expect(html).not.toContain('data-display-mode');
  });

  it('the product page price renders nothing for its caller to replace with the quote CTA', () => {
    const html = renderToString(
      <PriceTag quoteRequests price={WITHHELD.price} resolved={WITHHELD.resolvedPrice ?? null} locale="en-US" variant="pdp" />,
    );
    expect(text(html)).not.toMatch(AMOUNT);
  });

  it('the typeahead', () => {
    const out = text(
      renderToString(
        <>
          {renderSuggestionPrice(SUGGESTION, 'en-US', {
            requestQuote: en('product.requestQuote'),
            listPrice: en('product.listPrice'),
            yourPrice: en('product.yourPrice'),
          })}
        </>,
      ),
    );
    expect(out).not.toMatch(AMOUNT);
  });
});
