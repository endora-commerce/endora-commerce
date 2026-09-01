import { describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import type { DictionaryCurrency } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #239 — the dictionary tabs search a **joined** haystack
 * (`[code, label, symbol].join(' ').toLowerCase()`), which is the same bug in
 * a different shape: folding the join is still the one-liner that leaves `ł`
 * standing.
 *
 * The currency labels are the sharpest case in the admin, because the shipped
 * Polish label for the platform's own currency carries one: `Polski złoty`,
 * from `backend/src/modules/dictionaries/seed/translations.pl-PL.ts`. So does
 * its symbol, `zł`, from `seed/currencies.ts`. An operator typing `zloty` —
 * or `zl` — got nothing.
 *
 * The subject moved with feature 091's Phase 4 batch 10: the tab and the
 * client it mocks are `@endora-commerce/mod-dictionaries`' own admin layer
 * now. The paths below name the package's `src/`, which is batch 8's
 * convention for a screen test — the package publishes only its barrels, so
 * there is no subpath a test could name a single component through.
 */

const listCurrencies = vi.fn();
const listLanguages = vi.fn();
const listTranslations = vi.fn();

vi.mock('../../../../packages/modules/dictionaries/src/admin/api/client', () => ({
  dictionaryClient: {
    listCurrencies: (...args: unknown[]) => listCurrencies(...args),
    listLanguages: (...args: unknown[]) => listLanguages(...args),
    listTranslations: (...args: unknown[]) => listTranslations(...args),
  },
}));

const { CurrenciesTab } = await import(
  '../../../../packages/modules/dictionaries/src/admin/tabs/CurrenciesTab'
);

const bundle = passthroughBundle('dictionaries', [
  'currencies.title',
  'currencies.searchPlaceholder',
  'currencies.addCurrency',
  'currencies.decimalPlaces',
  'action.moveUp',
  'action.moveDown',
]);

function currency(overrides: Pick<DictionaryCurrency, 'code' | 'label' | 'symbol'>): DictionaryCurrency {
  return {
    symbolPosition: 'suffix',
    decimalPlaces: 2,
    isDefault: false,
    isActive: true,
    sortOrder: 100,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

/** Shipped Polish currency labels — the seed's own, verbatim. */
const ROWS: DictionaryCurrency[] = [
  currency({ code: 'PLN', label: 'Polski złoty', symbol: 'zł' }),
  currency({ code: 'CHF', label: 'Frank szwajcarski', symbol: 'CHF' }),
  currency({ code: 'DKK', label: 'Korona duńska', symbol: 'kr' }),
];

function searchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="currencies.searchPlaceholder"]',
  );
  if (!input) throw new Error('currency search input not found');
  return input;
}

/** The currency codes currently rendered as table rows. */
function visibleCodes(): string[] {
  return [...document.querySelectorAll('tbody tr')].map((row) =>
    (row.querySelector('td')?.textContent ?? '').trim(),
  );
}

async function renderTab(): Promise<void> {
  listCurrencies.mockResolvedValue({ data: ROWS });
  listLanguages.mockResolvedValue({ data: [] });
  listTranslations.mockResolvedValue({ data: [] });
  renderWithI18n(<CurrenciesTab />, bundle);
  await waitFor(() => expect(visibleCodes()).toEqual(['PLN', 'CHF', 'DKK']));
}

async function search(query: string): Promise<void> {
  fireEvent.change(searchInput(), { target: { value: query } });
  await waitFor(() => expect(searchInput().value).toBe(query));
}

describe('CurrenciesTab — diacritic-insensitive filter (issue #239)', () => {
  it('finds a label carrying a stroked ł, typed without it', async () => {
    await renderTab();
    await search('zloty');
    expect(visibleCodes()).toEqual(['PLN']);
  });

  it('folds the symbol column too, so `zl` finds `zł`', async () => {
    await renderTab();
    await search('zl');
    expect(visibleCodes()).toEqual(['PLN']);
  });

  it('folds ordinary combining diacritics', async () => {
    await renderTab();
    await search('dunska');
    expect(visibleCodes()).toEqual(['DKK']);
  });

  it('still matches the ISO code, which carries no diacritics', async () => {
    await renderTab();
    await search('chf');
    expect(visibleCodes()).toEqual(['CHF']);
  });

  it('narrows to nothing for a query that matches nothing', async () => {
    await renderTab();
    await search('zamowienia');
    expect(visibleCodes()).toEqual([]);
  });
});
