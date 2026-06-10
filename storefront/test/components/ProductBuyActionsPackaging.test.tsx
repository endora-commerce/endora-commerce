import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ProductBuyActions } from '../../components/ProductBuyActions';

/**
 * Feature 043 — the PDP buy panel exposes a packaging-unit selector and, when
 * a unit is the default, posts its `packagingUnitId` on the cart form.
 */
const noop = (): void => undefined;

const UNITS = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Karton', baseQuantity: 24, isDefault: false },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Paleta', baseQuantity: 480, isDefault: true },
];

describe('ProductBuyActions — packaging units', () => {
  it('renders the unit selector and pre-selects the default unit on the cart form', () => {
    const html = renderToString(
      <ProductBuyActions
        productId="p1"
        productSlug="p-slug"
        showCart
        showQuote={false}
        packagingUnits={UNITS}
        singlePieceLabel="Single piece"
        piecesLabel="pcs"
        addToCartAction={noop}
        addToQuoteAction={noop}
        addToCartLabel="Add to cart"
      />,
    );
    // Selector lists both units and the single-piece option.
    expect(html).toContain('Single piece');
    expect(html).toContain('Paleta');
    expect(html).toContain('Karton');
    // The default unit's id is posted as a hidden field on the cart form.
    expect(html).toContain('name="packagingUnitId"');
    expect(html).toContain('value="00000000-0000-4000-8000-000000000002"');
  });

  it('renders no selector when the product has no packaging units', () => {
    const html = renderToString(
      <ProductBuyActions
        productId="p1"
        productSlug="p-slug"
        showCart
        showQuote={false}
        addToCartAction={noop}
        addToQuoteAction={noop}
        addToCartLabel="Add to cart"
      />,
    );
    expect(html).not.toContain('name="packagingUnitId"');
  });
});
