import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Country, DictionaryCurrency, DictionaryLanguage } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';

/**
 * Issue #1562 (UX audit 2026-11-17, WORK-13) — a dictionary screen has one
 * place for its Add: the page header's one filled button, naming what the
 * active tab holds, as on every ListPage. The card header no longer repeats the
 * tab's label above the table, nor carries a second Add. While a dictionary is
 * empty, the empty state carries the one Add and the header has none. A row's
 * edit, default and delete are one row menu, named after the row, as on the
 * Projects dictionaries.
 */

const listCountries = vi.fn();
const listCurrencies = vi.fn();
const listLanguages = vi.fn();
const listTranslations = vi.fn();

vi.mock('../../../../packages/modules/dictionaries/src/admin/api/client', () => ({
  dictionaryClient: {
    listCountries: (...args: unknown[]) => listCountries(...args),
    listCurrencies: (...args: unknown[]) => listCurrencies(...args),
    listLanguages: (...args: unknown[]) => listLanguages(...args),
    listTranslations: (...args: unknown[]) => listTranslations(...args),
  },
}));

const { DictionaryPage } = await import(
  '../../../../packages/modules/dictionaries/src/admin/pages/DictionaryPage'
);

const STAMP = { createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z' };

const COUNTRIES: Country[] = [
  {
    code: 'PL',
    alpha3Code: 'POL',
    numericCode: '616',
    label: 'Polska',
    region: 'Europe',
    subregion: null,
    dialCode: '+48',
    isEuMember: true,
    defaultCurrencyCode: 'PLN',
    isDefault: true,
    isActive: true,
    sortOrder: 10,
    ...STAMP,
  } as unknown as Country,
  {
    code: 'DE',
    alpha3Code: 'DEU',
    numericCode: '276',
    label: 'Niemcy',
    region: 'Europe',
    subregion: null,
    dialCode: '+49',
    isEuMember: true,
    defaultCurrencyCode: 'EUR',
    isDefault: false,
    isActive: true,
    sortOrder: 20,
    ...STAMP,
  } as unknown as Country,
];

const CURRENCIES: DictionaryCurrency[] = [
  {
    code: 'PLN',
    label: 'Polski złoty',
    symbol: 'zł',
    symbolPosition: 'suffix',
    decimalPlaces: 2,
    isDefault: true,
    isActive: true,
    sortOrder: 10,
    ...STAMP,
  },
];

const LANGUAGES: DictionaryLanguage[] = [];

const PL = { ...shippedCoreBundle('pl'), ...shippedModuleBundle('dictionaries', 'pl') };
const DICT_PL = shippedModuleBundle('dictionaries', 'pl').dictionaries!;

function Location(): ReactElement {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPage(url = '/dictionaries'): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    <MemoryRouter initialEntries={[url]}>
      <DictionaryPage />
      <Location />
    </MemoryRouter>,
    PL,
    { language: 'pl' },
  );
}

beforeEach(() => {
  listCountries.mockReset().mockResolvedValue({ data: COUNTRIES });
  listCurrencies.mockReset().mockResolvedValue({ data: CURRENCIES });
  listLanguages.mockReset().mockResolvedValue({ data: LANGUAGES });
  listTranslations.mockReset().mockResolvedValue({ data: [] });
});

const isFilled = (element: HTMLElement): boolean => element.className.split(/\s+/).includes('bg-primary');

describe('DictionaryPage — one place for Add (issue #1562)', () => {
  it('puts the active tab’s Add in the page header, filled, and nowhere else', async () => {
    renderPage();
    await screen.findByText('Polska');
    const add = screen.getAllByRole('button', { name: DICT_PL['countries.addCountry']! });
    expect(add).toHaveLength(1);
    expect(add[0]!.closest('header')).not.toBeNull();
    expect(isFilled(add[0]!)).toBe(true);
    // The tab already says "Countries"; the card does not say it again.
    expect(screen.queryByRole('heading', { name: DICT_PL['countries.title']! })).toBeNull();
    // The table is named instead.
    expect(screen.getByRole('table', { name: DICT_PL['countries.title']! })).toBeInTheDocument();
  });

  it('names what the active tab adds', async () => {
    renderPage('/dictionaries?tab=currencies');
    await screen.findByText('Polski złoty');
    expect(screen.getByRole('button', { name: DICT_PL['currencies.addCurrency']! }).closest('header')).not.toBeNull();
    expect(screen.queryByRole('button', { name: DICT_PL['countries.addCountry']! })).toBeNull();
  });

  it('opens the editor from the header and moves focus to its first field', async () => {
    renderPage();
    await screen.findByText('Polska');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: DICT_PL['countries.addCountry']! }));
    expect(screen.getByRole('heading', { name: DICT_PL['countries.editor.newCountry']! })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(DICT_PL['field.code']!)).toHaveFocus());
  });

  it('lets the empty state carry the one Add while the dictionary is empty', async () => {
    listCountries.mockResolvedValue({ data: [] });
    renderPage();
    const empty = await screen.findByText(DICT_PL['countries.emptyState.title']!);
    const block = empty.closest('[data-empty-state="no-data"]') as HTMLElement;
    expect(block).not.toBeNull();
    const add = screen.getAllByRole('button', { name: DICT_PL['countries.addCountry']! });
    expect(add).toHaveLength(1);
    expect(block.contains(add[0]!)).toBe(true);
    const user = userEvent.setup();
    await user.click(add[0]!);
    expect(screen.getByRole('heading', { name: DICT_PL['countries.editor.newCountry']! })).toBeInTheDocument();
  });
});

describe('DictionaryPage — row actions (issue #1562)', () => {
  it('gathers edit, set default and delete into one menu named after the row', async () => {
    renderPage();
    await screen.findByText('Polska');
    const row = screen.getByText('Niemcy').closest('tr')!;
    // No filled or red button in a row.
    for (const button of within(row).getAllByRole('button')) {
      expect(isFilled(button)).toBe(false);
      expect(button.className.split(/\s+/)).not.toContain('bg-destructive');
    }
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: DICT_PL['action.rowMenu']!.replace('{code}', 'DE') }));
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(items).toEqual([DICT_PL['action.edit'], DICT_PL['action.setDefault'], DICT_PL['action.delete']]);
  });

  it('disables delete and set default on the default row, and says why delete is off', async () => {
    renderPage();
    await screen.findByText('Polska');
    const row = screen.getByText('Polska').closest('tr')!;
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: DICT_PL['action.rowMenu']!.replace('{code}', 'PL') }));
    const remove = await screen.findByRole('menuitem', { name: DICT_PL['action.delete']! });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).toHaveAttribute('title', DICT_PL['action.deleteDefault']!);
    expect(screen.getByRole('menuitem', { name: DICT_PL['action.setDefault']! })).toHaveAttribute('aria-disabled', 'true');
  });

  it('opens the editor from the row menu', async () => {
    renderPage();
    await screen.findByText('Polska');
    const row = screen.getByText('Niemcy').closest('tr')!;
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: DICT_PL['action.rowMenu']!.replace('{code}', 'DE') }));
    await user.click(await screen.findByRole('menuitem', { name: DICT_PL['action.edit']! }));
    expect(screen.getByRole('heading', { name: DICT_PL['countries.editor.editTitle']!.replace('{code}', 'DE') })).toBeInTheDocument();
  });
});
