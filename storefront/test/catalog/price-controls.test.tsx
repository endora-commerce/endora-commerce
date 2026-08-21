import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { FilterDefinition } from '@b2b/contracts';
import {
  parseCatalogPriceQuery,
  parsePriceBound,
  parseSortParam,
  priceControlsActive,
} from '../../lib/catalog-price-query';

// The toolbar is a client component that pushes the chosen ordering into the
// URL; SSR mounts no app router, so the two hooks it reads are stubbed. What is
// asserted below is the markup, which is where "the control is absent" lives.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/catalog',
}));

const { CatalogToolbar } = await import('../../components/CatalogToolbar');
const { FilterPanel } = await import('../../components/FilterPanel');

/**
 * Feature 086 / FR-023, FR-024, FR-025 — the storefront's half.
 *
 * SSR-only, per this suite's convention: what is asserted is what the markup
 * says, because the whole claim is that the controls are **absent** where the
 * API refuses them, and absence is render-derived. The `select`'s change
 * handler and the form submission are device-verified.
 */

const filters: FilterDefinition[] = [
  {
    attributeKey: 'material',
    label: 'Material',
    type: 'select',
    options: [{ value: 'brass', label: 'Brass', count: 3 }],
  } as unknown as FilterDefinition,
];

function toolbar(props: { priceOrdering: boolean; priceControlsActive: boolean }): string {
  return renderToString(
    <CatalogToolbar
      shown={12}
      sort="relevance"
      limit={24}
      view="grid"
      baseQuery={{}}
      locale="en-US"
      priceOrdering={props.priceOrdering}
      priceControlsActive={props.priceControlsActive}
    />,
  );
}

describe('the catalogue toolbar offers the two price orderings only where the server allows them', () => {
  it('renders both options when the page may show prices', () => {
    const html = toolbar({ priceOrdering: true, priceControlsActive: false });
    expect(html).toContain('value="price"');
    expect(html).toContain('value="-price"');
    expect(html).toContain('Price: lowest first');
    expect(html).toContain('Price: highest first');
  });

  it('renders neither when the server says the page may not', () => {
    // FR-016/FR-023 — a control that offers an ordering the API refuses is a
    // worse defect than no control.
    const html = toolbar({ priceOrdering: false, priceControlsActive: false });
    expect(html).not.toContain('value="price"');
    expect(html).not.toContain('value="-price"');
    // …and the orderings that always worked are untouched.
    expect(html).toContain('value="name"');
    expect(html).toContain('value="-createdAt"');
  });

  it('states the divergence from the cart only while a price control is in use', () => {
    // FR-024 — one line under the toolbar, where the buyer is looking at the
    // ordering rather than in a help page.
    const active = toolbar({ priceOrdering: true, priceControlsActive: true });
    expect(active).toContain('Prices shown are your unit prices.');
    expect(active).toContain('applied in the cart');
    const inactive = toolbar({ priceOrdering: true, priceControlsActive: false });
    expect(inactive).not.toContain('Prices shown are your unit prices.');
  });

  it('renders the note in Polish for a Polish buyer', () => {
    // FR-025 — everything a buyer reads ships in both languages.
    const html = renderToString(
      <CatalogToolbar
        shown={1}
        sort="price"
        limit={24}
        view="grid"
        baseQuery={{}}
        locale="pl-PL"
        priceOrdering
        priceControlsActive
      />,
    );
    expect(html).toContain('Cena: od najniższej');
    expect(html).toContain('Cena: od najwyższej');
    expect(html).toContain('ceny jednostkowe');
  });
});

describe('the filter panel offers a price range only where the server allows it', () => {
  it('renders two numeric bounds, round-tripping the applied values', () => {
    const html = renderToString(
      <FilterPanel
        filters={filters}
        selected={{}}
        baseQuery={{}}
        basePath="/catalog"
        locale="en-US"
        priceRange
        selectedPriceRange={{ min: 10, max: 250 }}
      />,
    );
    expect(html).toContain('name="minPrice"');
    expect(html).toContain('name="maxPrice"');
    expect(html).toContain('value="10"');
    expect(html).toContain('value="250"');
    // A GET form, so the control works with no JavaScript (Principle VII).
    expect(html).toContain('method="GET"');
  });

  it('renders no range control when the server says the page may not show prices', () => {
    const html = renderToString(
      <FilterPanel
        filters={filters}
        selected={{}}
        baseQuery={{}}
        basePath="/catalog"
        locale="en-US"
      />,
    );
    expect(html).not.toContain('name="minPrice"');
    expect(html).not.toContain('name="maxPrice"');
  });

  it('does not replay the bounds as hidden inputs beside their own fields', () => {
    // Two inputs of the same name submit twice, and the stale one wins.
    const html = renderToString(
      <FilterPanel
        filters={filters}
        selected={{}}
        baseQuery={{ minPrice: '5', sort: 'price' }}
        basePath="/catalog"
        locale="en-US"
        priceRange
        selectedPriceRange={{ min: 5 }}
      />,
    );
    expect(html.match(/name="minPrice"/g)).toHaveLength(1);
    expect(html).toContain('name="sort"');
  });
});

describe('the listing chrome parses the two price parameters the way the API does', () => {
  it('keeps a valid sort and drops an unknown one', () => {
    expect(parseSortParam('price')).toBe('price');
    expect(parseSortParam('-price')).toBe('-price');
    expect(parseSortParam('cheapest')).toBeUndefined();
    expect(parseSortParam(undefined)).toBeUndefined();
  });

  it('drops a malformed or negative bound, and keeps zero', () => {
    expect(parsePriceBound('10.5')).toBe(10.5);
    expect(parsePriceBound('0')).toBe(0);
    expect(parsePriceBound('')).toBeUndefined();
    expect(parsePriceBound('-1')).toBeUndefined();
    expect(parsePriceBound('cheap')).toBeUndefined();
  });

  it('forwards a contradictory range instead of hiding it', () => {
    // FR-008 — the API answers `PRICE_RANGE_INVALID` and the buyer is told;
    // silently dropping one bound would show them a page they did not ask for.
    expect(parseCatalogPriceQuery({ minPrice: '100', maxPrice: '10' })).toEqual({
      minPrice: 100,
      maxPrice: 10,
    });
  });

  it('knows when a price control is in use', () => {
    expect(priceControlsActive({ sort: 'price' })).toBe(true);
    expect(priceControlsActive({ sort: '-price' })).toBe(true);
    expect(priceControlsActive({ minPrice: 1 })).toBe(true);
    expect(priceControlsActive({ maxPrice: 1 })).toBe(true);
    expect(priceControlsActive({ sort: 'name' })).toBe(false);
    expect(priceControlsActive({})).toBe(false);
  });
});
