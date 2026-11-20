import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Country, DictionaryCurrency, DictionaryLanguage } from '@endora-commerce/contracts';
import type { ReactElement } from 'react';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #1448 (UX audit 2026-11-17, DS-15) — the three dictionary tabs.
 *
 * Countries and Currencies drew an empty table when the search matched
 * nothing; Languages said "No languages match the current filters." in a
 * table cell, filtered or not. Each tab now shows the kit `EmptyState`:
 * `no-data` when the dictionary holds nothing, `no-results` with *Clear
 * filters* — which empties the search (and the language status filter) and
 * returns focus to the search box — when the filters hide every row.
 */

const listLanguages = vi.fn();
const listCountries = vi.fn();
const listCurrencies = vi.fn();
const listTranslations = vi.fn();

vi.mock('../../../../packages/modules/dictionaries/src/admin/api/client', () => ({
  dictionaryClient: {
    listLanguages: (...args: unknown[]) => listLanguages(...args),
    listCountries: (...args: unknown[]) => listCountries(...args),
    listCurrencies: (...args: unknown[]) => listCurrencies(...args),
    listTranslations: (...args: unknown[]) => listTranslations(...args),
  },
}));

const { LanguagesTab } = await import('../../../../packages/modules/dictionaries/src/admin/tabs/LanguagesTab');
const { CountriesTab } = await import('../../../../packages/modules/dictionaries/src/admin/tabs/CountriesTab');
const { CurrenciesTab } = await import('../../../../packages/modules/dictionaries/src/admin/tabs/CurrenciesTab');

const STAMP = { createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' };

const LANGUAGE: DictionaryLanguage = {
  code: 'pl-PL',
  label: 'Polski',
  nativeLabel: 'Polski',
  isRtl: false,
  fallbackCode: null,
  isDefault: true,
  isActive: true,
  sortOrder: 0,
  countries: [],
  ...STAMP,
};

const COUNTRY: Country = {
  code: 'PL',
  alpha3Code: 'POL',
  numericCode: '616',
  label: 'Poland',
  region: 'Europe',
  subregion: null,
  dialCode: null,
  isEuMember: true,
  defaultCurrencyCode: null,
  isActive: true,
  isDefault: true,
  sortOrder: 0,
  ...STAMP,
};

const CURRENCY: DictionaryCurrency = {
  code: 'PLN',
  label: 'Polski złoty',
  symbol: 'zł',
  symbolPosition: 'suffix',
  decimalPlaces: 2,
  isDefault: true,
  isActive: true,
  sortOrder: 0,
  ...STAMP,
};

interface Case {
  name: string;
  scope: 'languages' | 'countries' | 'currencies';
  render: () => ReactElement;
  answer: (rows: 'none' | 'one') => void;
}

const CASES: Case[] = [
  {
    name: 'Languages',
    scope: 'languages',
    render: () => <LanguagesTab />,
    answer: (rows) => {
      listLanguages.mockResolvedValue({ data: rows === 'one' ? [LANGUAGE] : [] });
      listCountries.mockResolvedValue({ data: [] });
    },
  },
  {
    name: 'Countries',
    scope: 'countries',
    render: () => <CountriesTab />,
    answer: (rows) => {
      listCountries.mockResolvedValue({ data: rows === 'one' ? [COUNTRY] : [] });
      listCurrencies.mockResolvedValue({ data: [] });
      listLanguages.mockResolvedValue({ data: [] });
    },
  },
  {
    name: 'Currencies',
    scope: 'currencies',
    render: () => <CurrenciesTab />,
    answer: (rows) => {
      listCurrencies.mockResolvedValue({ data: rows === 'one' ? [CURRENCY] : [] });
      listLanguages.mockResolvedValue({ data: [] });
    },
  },
];

const bundle = (scope: string) => ({
  ...passthroughBundle('dictionaries', [
    `${scope}.searchLabel`,
    `${scope}.searchPlaceholder`,
    `${scope}.empty`,
    `${scope}.emptyState.title`,
    `${scope}.emptyState.body`,
  ]),
  ...passthroughBundle('core', ['common.emptyState.clearFilters']),
});

const block = (): Element | null => document.querySelector('[data-empty-state]');

describe.each(CASES)('$name tab — empty states (#1448)', ({ scope, render, answer }) => {
  beforeEach(() => {
    for (const mock of [listLanguages, listCountries, listCurrencies, listTranslations]) mock.mockReset();
    listTranslations.mockResolvedValue({ data: [] });
  });

  it('says the dictionary holds nothing yet, with no Clear filters', async () => {
    answer('none');
    renderWithI18n(render(), bundle(scope));
    expect(await screen.findByText(`${scope}.emptyState.title`)).toBeTruthy();
    expect(screen.getByText(`${scope}.emptyState.body`)).toBeTruthy();
    expect(block()!.getAttribute('data-empty-state')).toBe('no-data');
    expect(screen.queryByRole('button', { name: 'common.emptyState.clearFilters' })).toBeNull();
  });

  it('tells a search that matches nothing apart, and clears it from there', async () => {
    answer('one');
    renderWithI18n(render(), bundle(scope));
    const search = (await screen.findByPlaceholderText(`${scope}.searchPlaceholder`)) as HTMLInputElement;
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(1));
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(await screen.findByText(`${scope}.empty`)).toBeTruthy();
    expect(block()!.getAttribute('data-empty-state')).toBe('no-results');
    expect(screen.queryByText(`${scope}.emptyState.title`)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'common.emptyState.clearFilters' }));
    expect(search.value).toBe('');
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(1));
    await waitFor(() => expect(document.activeElement).toBe(search));
  });
});

describe('Languages tab — the status filter counts as a filter (#1448)', () => {
  it('offers Clear filters when only the status filter hides every row, and resets it', async () => {
    for (const mock of [listLanguages, listCountries, listTranslations]) mock.mockReset();
    listTranslations.mockResolvedValue({ data: [] });
    CASES[0]!.answer('one');
    renderWithI18n(<LanguagesTab />, {
      ...bundle('languages'),
      dictionaries: { ...bundle('languages').dictionaries, 'languages.filter.status': 'languages.filter.status' },
    });
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(1));
    const status = screen.getByLabelText('languages.filter.status') as HTMLSelectElement;
    fireEvent.change(status, { target: { value: 'inactive' } });
    expect(await screen.findByText('languages.empty')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'common.emptyState.clearFilters' }));
    expect(status.value).toBe('all');
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(1));
  });
});
