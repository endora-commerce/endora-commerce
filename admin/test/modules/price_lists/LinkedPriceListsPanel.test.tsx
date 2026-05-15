import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { TranslationProvider } from '../../../src/i18n/TranslationProvider';
import {
  LinkedPriceListsList,
  toInternalPath,
  type LinkedPriceListRow,
} from '../../../src/modules/price_lists/LinkedPriceListsPanel';

// `LinkedPriceListsList` calls `useTranslation('core')` for the inline
// labels (System, Open, status chips). Wrap each renderToString call
// in a `<TranslationProvider>` with an inline bundle so the tree can
// resolve those keys without hitting the network.
const CORE_BUNDLE = {
  core: {
    'priceLists.linked.system': 'System',
    'priceLists.linked.open': 'Open',
    'priceLists.linked.openEditor': 'Open editor',
    'priceLists.linked.noBracketsYet': 'No bracket prices yet for this list.',
    'priceLists.linked.helpText': '',
    'priceLists.type.base': 'Base',
    'priceLists.type.sale': 'Sale',
    'priceLists.status.active': 'Active',
    'priceLists.status.draft': 'Draft',
    'priceLists.status.scheduled': 'Scheduled',
    'priceLists.status.expired': 'Expired',
  },
} as const;

/**
 * T093 — admin LinkedPriceListsPanel render tests (US8).
 *
 * Targets the pure `LinkedPriceListsList` render component split out
 * of the data-fetching shell so we can drive renderToString without
 * jsdom or @testing-library/react. The data-fetch shell is exercised
 * end-to-end via the existing backend contract test
 * (`product-pricing-panel.test.ts`); this suite locks the visual
 * + routing contract for the panel's UI behaviour.
 */

const baseRow = (over: Partial<LinkedPriceListRow['list']>): LinkedPriceListRow => ({
  list: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Default',
    type: 'base',
    status: 'active',
    modifiedAt: '2026-04-01T10:00:00.000Z',
    ...over,
  },
  summary: [{ currencyCode: 'PLN', summary: '199.00 across 1 bracket' }],
  deepLinkPath: '/admin/price-lists/00000000-0000-4000-8000-000000000001/products?focus=p1',
});

describe('toInternalPath', () => {
  it('strips the /admin prefix and the /products suffix', () => {
    expect(
      toInternalPath('/admin/price-lists/abc/products?focus=p1'),
    ).toBe('/price-lists/abc?focus=p1');
  });

  it('leaves an internal path untouched when /admin is absent', () => {
    expect(toInternalPath('/price-lists/abc?focus=p1')).toBe('/price-lists/abc?focus=p1');
  });

  it('handles links with no query string', () => {
    expect(toInternalPath('/admin/price-lists/abc')).toBe('/price-lists/abc');
  });
});

describe('LinkedPriceListsList', () => {
  it('renders one row per linked list with name, type, status, and currency summary', () => {
    const rows: LinkedPriceListRow[] = [
      baseRow({ name: 'Default' }),
      {
        list: {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'Spring promo 2026',
          type: 'sale',
          status: 'scheduled',
          modifiedAt: '2026-03-01T10:00:00.000Z',
        },
        summary: [
          { currencyCode: 'PLN', summary: '80.00 – 100.00 across 3 brackets' },
          { currencyCode: 'EUR', summary: '20.00 across 1 bracket' },
        ],
        deepLinkPath: '/admin/price-lists/00000000-0000-4000-8000-000000000002/products?focus=p1',
      },
    ];

    const html = renderToString(
      <TranslationProvider language="en" initialBundle={CORE_BUNDLE}>
      <MemoryRouter>
        <LinkedPriceListsList rows={rows} />
      </MemoryRouter>
      </TranslationProvider>,
    );

    // One row per list, marked via data-testid for ergonomic counting.
    expect((html.match(/data-testid="linked-price-list-row"/g) ?? []).length).toBe(2);

    // Names + type chips + status chips are present.
    expect(html).toContain('Default');
    expect(html).toContain('Spring promo 2026');
    expect(html).toContain('Base');
    expect(html).toContain('Sale');
    expect(html).toContain('Active');
    expect(html).toContain('Scheduled');

    // Per-currency summary blocks are present.
    expect(html).toContain('PLN');
    expect(html).toContain('80.00 – 100.00 across 3 brackets');
    expect(html).toContain('EUR');
    expect(html).toContain('20.00 across 1 bracket');

    // The Default row carries the System badge; the Sale row does not.
    expect(html).toContain('System');
  });

  it('routes each row to the deep-link path with the /admin prefix stripped', () => {
    const rows: LinkedPriceListRow[] = [
      {
        list: {
          id: 'list-A',
          name: 'Promo A',
          type: 'sale',
          status: 'active',
          modifiedAt: '2026-03-01T10:00:00.000Z',
        },
        summary: [],
        deepLinkPath: '/admin/price-lists/list-A/products?focus=p99',
      },
    ];

    const html = renderToString(
      <TranslationProvider language="en" initialBundle={CORE_BUNDLE}>
      <MemoryRouter>
        <LinkedPriceListsList rows={rows} />
      </MemoryRouter>
      </TranslationProvider>,
    );

    // Both the title link and the Open button point at the internal route.
    expect(html).toContain('href="/price-lists/list-A?focus=p99"');
    // No occurrence of the raw /admin prefix.
    expect(html).not.toContain('/admin/price-lists/list-A');
    // "Open" affordance is present.
    expect(html).toContain('Open');
  });

  it('renders only the Default row when the product is on no other lists', () => {
    const rows: LinkedPriceListRow[] = [baseRow({})];

    const html = renderToString(
      <TranslationProvider language="en" initialBundle={CORE_BUNDLE}>
      <MemoryRouter>
        <LinkedPriceListsList rows={rows} />
      </MemoryRouter>
      </TranslationProvider>,
    );

    expect((html.match(/data-testid="linked-price-list-row"/g) ?? []).length).toBe(1);
    expect(html).toContain('Default');
    // Default carries the System badge.
    expect(html).toContain('System');
    // No other status chips beyond Active appear.
    expect(html).not.toContain('Scheduled');
    expect(html).not.toContain('Draft');
    expect(html).not.toContain('Expired');
  });

  it('shows the empty-summary fallback when a row has no brackets yet', () => {
    const rows: LinkedPriceListRow[] = [
      {
        list: {
          id: 'list-X',
          name: 'Empty list',
          type: 'base',
          status: 'draft',
          modifiedAt: '2026-04-01T10:00:00.000Z',
        },
        summary: [],
        deepLinkPath: '/admin/price-lists/list-X/products?focus=p1',
      },
    ];

    const html = renderToString(
      <TranslationProvider language="en" initialBundle={CORE_BUNDLE}>
      <MemoryRouter>
        <LinkedPriceListsList rows={rows} />
      </MemoryRouter>
      </TranslationProvider>,
    );

    expect(html).toContain('No bracket prices yet for this list.');
    expect(html).toContain('Draft');
  });
});
