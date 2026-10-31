import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { FilterDefinition, ProductSummary } from '@endora-commerce/contracts';

/**
 * Issue #85 — the commerce area's components render the page's language. Each
 * is rendered server-side in `en-US` and `pl-PL` and the strings a buyer sees
 * are asserted; the English render must carry no Polish diacritic.
 *
 * `next/navigation` is stubbed for the toolbar, which reads the router.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/catalog',
}));

const { CatalogToolbar } = await import('../../components/CatalogToolbar');
const { FilterPanel } = await import('../../components/FilterPanel');
const { ProductCard } = await import('../../components/ProductCard');
const { ProductRow } = await import('../../components/ProductRow');
const { QuoteRequestCta } = await import('../../components/pricing/QuoteRequestCta');
const { PdpPriceToggle } = await import('../../components/pricing/PdpPriceToggle');
const { Pagination } = await import('../../components/Pagination');
const { PaymentMethods } = await import('../../components/checkout/PaymentMethods');
const { PdpStickyBuyBar } = await import('../../components/mobile/PdpStickyBuyBar');
const { FileDropzone } = await import('../../components/FileDropzone');
const { CompareModeSwitcher } = await import('../../components/CompareModeSwitcher');
const { ComparisonTable, localisedValue } = await import('../../components/ComparisonTable');
const { SharedComparisonTable } = await import('../../components/SharedComparisonTable');
const { DraftLine, LockedPricingNote, strings } = await import('../../components/rfq/RfqDraftView');
const { blockTitle } = await import('../../lib/checkout/place-order-gate');
const { tForLocale } = await import('../../lib/i18n/messages');

const POLISH = /[ąćęłńóśźż]/i;

function html(node: React.ReactNode): string {
  return renderToString(<>{node}</>).replaceAll('<!-- -->', '');
}

function expectAll(out: string, texts: readonly string[], locale: string): void {
  for (const text of texts) expect(out).toContain(text);
  if (locale === 'en-US') expect(out).not.toMatch(POLISH);
}

function summary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    sku: 'SKU-1',
    type: 'simple',
    name: 'Widget',
    slug: 'widget',
    categorySlugs: [],
    primaryAssetUrl: null,
    price: { amount: 80, currency: 'USD' },
    stockIndicator: null,
    stockLevel: null,
    ...overrides,
  };
}

describe('catalog toolbar and filters', () => {
  it.each([
    ['en-US', 22, ['Showing', 'results', 'aria-label="Sort"', 'Sort: relevance', 'Newest', 'Name A–Z', '24 / page', 'aria-label="View mode"', 'aria-label="Grid"']],
    ['pl-PL', 22, ['Pokazuję', 'wyniki', 'aria-label="Sortuj"', 'Sortuj: trafność', 'Najnowsze', 'Nazwa A–Z', '24 / strona', 'aria-label="Tryb widoku"', 'aria-label="Siatka"']],
    ['pl-PL', 25, ['wyników']],
    ['en-US', 1, ['>result<']],
  ] as const)('toolbar in %s for %i shown', (locale, shown, texts) => {
    const out = html(
      <CatalogToolbar
        shown={shown}
        sort="relevance"
        limit={24}
        view="grid"
        baseQuery={{}}
        locale={locale}
        priceOrdering={false}
        priceControlsActive={false}
      />,
    );
    expectAll(out, texts, locale);
  });

  const filters: FilterDefinition[] = [
    { attributeKey: 'color', label: 'Colour', type: 'select', options: [{ value: 'red', label: 'Red', count: 3 }] } as unknown as FilterDefinition,
  ];
  it.each([
    ['en-US', ['Clear', 'Active (1)', 'aria-label="Remove filter: ', 'title="Remove filter"']],
    ['pl-PL', ['Wyczyść', 'Aktywne (1)', 'aria-label="Usuń filtr: ', 'title="Usuń filtr"']],
  ])('filter panel in %s', (locale, texts) => {
    const out = html(
      <FilterPanel filters={filters} selected={{ color: ['red'] }} baseQuery={{}} basePath="/catalog" locale={locale} />,
    );
    for (const text of texts) expect(out).toContain(text);
  });

  it.each([
    ['en-US', 'aria-label="Pagination"'],
    ['pl-PL', 'aria-label="Stronicowanie"'],
  ])('pagination in %s', (locale, label) => {
    const out = html(<Pagination basePath="/catalog" baseQuery={{}} nextCursor="c" hasMore locale={locale} />);
    expect(out).toContain(label);
  });
});

describe('product card and row', () => {
  it.each([
    ['en-US', ['from / pc.', 'gross ', 'Low: 5']],
    ['pl-PL', ['od / szt.', 'brutto ', 'Mało: 5']],
  ])('card in %s', (locale, texts) => {
    const out = html(<ProductCard product={summary({ stockLevel: 5 })} locale={locale} salesChannelCode={undefined} />);
    for (const text of texts) expect(out).toContain(text);
  });

  it.each([
    ['en-US', summary({ stockLevel: 1200 }), '1,200 pcs'],
    ['pl-PL', summary({ stockLevel: 1200 }), '1200 szt.'],
    ['en-US', summary({ stockIndicator: 'to_order' }), 'Available to order'],
    ['pl-PL', summary({ stockIndicator: 'to_order' }), 'Na zamówienie'],
  ])('row stock in %s', (locale, product, text) => {
    const out = html(<ProductRow product={product} locale={locale} />);
    expect(out.replace(/ /g, '')).toContain(text);
  });

  it('labels a sale on the card in each language', () => {
    const resolved = {
      displayMode: 'net_only' as const,
      basePrice: { amount: '100.00', currency: 'USD' },
      salePrice: { amount: '80.00', currency: 'USD' },
    };
    const en = html(<ProductCard product={summary()} resolved={resolved as never} locale="en-US" salesChannelCode={undefined} />);
    const pl = html(<ProductCard product={summary()} resolved={resolved as never} locale="pl-PL" salesChannelCode={undefined} />);
    expect(en).toContain('>Sale<');
    expect(en).toContain('Special price');
    expect(pl).toContain('>Promocja<');
    expect(pl).toContain('Cena promocyjna');
  });
});

describe('price surfaces', () => {
  it.each([
    ['en-US', ['Price on request'], ['The price of this product is available in response to a quote request.']],
    ['pl-PL', ['Cena na zapytanie'], ['Cena tego produktu jest dostępna w odpowiedzi na zapytanie ofertowe.']],
  ])('quote CTA in %s', (locale, card, pdp) => {
    expectAll(html(<QuoteRequestCta productId="p" productSlug="p" variant="card" locale={locale} />), card, locale);
    for (const text of pdp) {
      expect(html(<QuoteRequestCta productId="p" productSlug="p" variant="pdp" locale={locale} />)).toContain(text);
    }
  });

  it.each([
    ['en-US', ['aria-label="Net / gross"', '>NET<', '>GROSS<']],
    ['pl-PL', ['aria-label="Netto / brutto"', '>NETTO<', '>BRUTTO<']],
  ])('PDP net/gross switch in %s', (locale, texts) => {
    const out = html(<PdpPriceToggle basePrice={{ amount: '10.00', currency: 'USD' }} locale={locale} />);
    for (const text of texts) expect(out).toContain(text);
  });
});

describe('checkout pieces', () => {
  it.each([
    ['en-US', 'Payment method'],
    ['pl-PL', 'Metoda płatności'],
  ])('payment legend in %s', (locale, legend) => {
    expect(html(<PaymentMethods methods={[]} locale={locale} />)).toContain(`<legend class="font-semibold">${legend}</legend>`);
  });

  it.each([
    ['en-US', 'Ordering is currently unavailable.'],
    ['pl-PL', 'Składanie zamówień jest obecnie niedostępne.'],
  ])('moderation fallback title in %s', (locale, sentence) => {
    expect(blockTitle('moderation', tForLocale(locale), null)).toBe(sentence);
  });
});

describe('PDP mobile bar and the quick-order dropzone', () => {
  it.each([
    ['en-US', ['aria-label="Quantity"', 'aria-label="Datasheet"']],
    ['pl-PL', ['aria-label="Ilość"', 'aria-label="Karta katalogowa"']],
  ])('sticky buy bar in %s', (locale, texts) => {
    const out = html(
      <PdpStickyBuyBar
        productId="p"
        addToCartAction={async () => ({ status: 'idle' }) as never}
        addToCartLabel="x"
        datasheetHref="/d.pdf"
        locale={locale}
      />,
    );
    expectAll(out, texts, locale);
  });

  it.each([
    ['en-US', 'Drag a CSV or Excel file here, or click to choose'],
    ['pl-PL', 'Przeciągnij tutaj plik CSV lub Excel albo kliknij, aby go wybrać'],
  ])('dropzone prompt in %s', (locale, prompt) => {
    const out = html(<FileDropzone filenameField="f" contentField="c" locale={locale} />);
    expect(out).toContain(prompt);
  });
});

describe('compare', () => {
  it.each([
    ['en-US', ['aria-label="Display mode"', 'All attributes', 'Common attributes only', 'Differences only']],
    ['pl-PL', ['aria-label="Tryb wyświetlania"', 'Wszystkie atrybuty', 'Tylko wspólne atrybuty', 'Tylko różnice']],
  ])('mode switcher in %s', (locale, texts) => {
    expectAll(html(<CompareModeSwitcher value="all" onChange={() => undefined} locale={locale} />), texts, locale);
  });

  it.each([
    ['en-US', 'Loading…'],
    ['pl-PL', 'Wczytywanie…'],
  ])('tables say they are loading in %s', (locale, text) => {
    expect(html(<ComparisonTable locale={locale} salesChannelCode={undefined} />)).toContain(text);
    expect(html(<SharedComparisonTable token="t" locale={locale} salesChannelCode={undefined} />)).toContain(text);
  });

  it('names a product in the page language, not always Polish', () => {
    const name = { 'pl-PL': 'Śruba', 'en-US': 'Bolt' };
    expect(localisedValue(name, 'en-US')).toBe('Bolt');
    expect(localisedValue(name, 'pl-PL')).toBe('Śruba');
    expect(localisedValue({ pl: 'Śruba' }, 'pl-PL')).toBe('Śruba');
    expect(localisedValue({ 'de-DE': 'Schraube' }, 'en-US')).toBe('Schraube');
  });

  it.each([
    ['en-US', 'Add to comparison', 'Remove from comparison', 'Could not update the comparison.'],
    ['pl-PL', 'Dodaj do porównania', 'Usuń z porównania', 'Nie udało się zaktualizować porównania.'],
  ])(
    // The toggle renders nothing until it has read the comparison in the browser, so its
    // copy is asserted at the catalogue it reads rather than through a server render.
    'toggle copy in %s',
    (locale, add, remove, failed) => {
      const t = tForLocale(locale);
      expect(t('commerce.compare.toggle.add')).toBe(add);
      expect(t('commerce.compare.remove')).toBe(remove);
      expect(t('commerce.compare.toggle.failed')).toBe(failed);
    },
  );
});

describe('quote-request draft', () => {
  const line = { productId: 'p1', slug: 'bolt', name: 'Bolt', quantity: 2, unitPrice: { amount: 10, currency: 'USD' } };

  it.each([
    ['en-US', 1, '1 product in your request.', '1 item'],
    ['en-US', 3, '3 products in your request.', '3 items'],
    ['pl-PL', 1, '1 produkt w zapytaniu.', '1 pozycja'],
    ['pl-PL', 3, '3 produkty w zapytaniu.', '3 pozycje'],
    ['pl-PL', 5, '5 produktów w zapytaniu.', '5 pozycji'],
    ['pl-PL', 13, '13 produktów w zapytaniu.', '13 pozycji'],
    ['pl-PL', 24, '24 produkty w zapytaniu.', '24 pozycje'],
  ] as const)('counts in %s: %i', (locale, n, subheading, items) => {
    const s = strings(locale);
    expect(s.subheading(n)).toBe(subheading);
    expect(s.itemCount(n)).toBe(items);
  });

  it.each([
    ['en-US', ['Quote request', 'Submit quote request', 'Notes for sales (optional)', 'Price on request', 'Clear all']],
    ['pl-PL', ['Zapytanie ofertowe', 'Złóż zapytanie ofertowe', 'Uwagi do zapytania (opcjonalnie)', 'Cena na zapytanie', 'Wyczyść wszystko']],
  ])('labels in %s', (locale, texts) => {
    const s = strings(locale);
    expect([s.heading, s.submit, s.noteLabel, s.onRequest, s.clearAll]).toEqual(texts);
  });

  it.each([
    ['en-US', ['Proposed price', 'aria-label="Quantity"', 'aria-label="Remove"', '/ pc.']],
    ['pl-PL', ['Proponowana cena', 'aria-label="Ilość"', 'aria-label="Usuń"', '/ szt.']],
  ])('a draft line in %s', (locale, texts) => {
    const out = html(
      <DraftLine
        line={line as never}
        t={strings(locale)}
        locale={locale}
        proposalsAllowed
        onQty={() => undefined}
        onProposedPrice={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expectAll(out, texts, locale);
  });

  it.each([
    ['en-US', 'Our sales team will set the prices for this request.'],
    ['pl-PL', 'Ceny w tym zapytaniu ustali dział sprzedaży.'],
  ])('the locked-pricing note in %s', (locale, sentence) => {
    expect(html(<LockedPricingNote t={strings(locale)} />)).toContain(sentence);
  });
});
