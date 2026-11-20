import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Country, DictionaryCurrency, DictionaryLanguage } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1456 (UX audit 2026-11-17, CAT-03) — `/dictionaries` speaks the
 * operator's language, its tab switcher is the kit's `Tabs` (#1445) rather than
 * three ghost buttons, every search box has a label and not only a placeholder,
 * and a row offers one reorder affordance per breakpoint instead of drag plus
 * buttons.
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

const { DictionaryPage, normalizeDictionaryTab } = await import(
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

describe('DictionaryPage — tabs and copy (issue #1456)', () => {
  it('normalises the tab in the URL', () => {
    expect(normalizeDictionaryTab('currencies')).toBe('currencies');
    expect(normalizeDictionaryTab('languages')).toBe('languages');
    expect(normalizeDictionaryTab('nonsense')).toBe('countries');
    expect(normalizeDictionaryTab(null)).toBe('countries');
  });

  it('renders the title and a real tablist in Polish', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: DICT_PL['page.title']! })).toBeInTheDocument();
    const list = screen.getByRole('tablist', { name: DICT_PL['tabs.label']! });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      DICT_PL['tab.countries'],
      DICT_PL['tab.currencies'],
      DICT_PL['tab.languages'],
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[0]!.id);
    await screen.findByText('Polska');
  });

  it('switches tabs with the arrow keys and keeps the tab in the URL', async () => {
    renderPage();
    await screen.findByText('Polska');
    const user = userEvent.setup();
    screen.getByRole('tab', { name: DICT_PL['tab.countries']! }).focus();
    await user.keyboard('{ArrowRight}');
    const currencies = screen.getByRole('tab', { name: DICT_PL['tab.currencies']! });
    expect(currencies).toHaveFocus();
    expect(currencies).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location').textContent).toBe('?tab=currencies');
    await screen.findByText('Polski złoty');
    await user.keyboard('{End}');
    expect(screen.getByTestId('location').textContent).toBe('?tab=languages');
  });

  it('labels the countries table, its search box and its region in Polish, with no draggable rows', async () => {
    const { container } = renderPage();
    await screen.findByText('Polska');
    expect(screen.getByRole('searchbox', { name: DICT_PL['countries.searchLabel']! })).toBeInTheDocument();
    for (const key of ['column.code', 'column.label', 'column.region', 'column.currency', 'column.sort', 'column.actions']) {
      expect(screen.getByRole('columnheader', { name: DICT_PL[key]! })).toBeInTheDocument();
    }
    expect(screen.getAllByText(DICT_PL['region.Europe']!).length).toBeGreaterThan(0);
    expect(container.querySelector('[draggable="true"]')).toBeNull();
    // One reorder pair per breakpoint — the touch pair and the desktop pair, which CSS shows one
    // of (jsdom applies none, so both are here) — under one name, the kit's.
    const firstRow = screen.getByText('Polska').closest('tr')!;
    const CORE_PL = shippedCoreBundle('pl').core!;
    expect(within(firstRow).getAllByRole('button', { name: CORE_PL['reorder.moveDown']! })).toHaveLength(2);
    // Edit, set default and delete are one menu named after the row (issue #1562).
    expect(within(firstRow).getByRole('button', { name: DICT_PL['action.rowMenu']!.replace('{code}', 'PL') })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('shows the currency editor in Polish, symbol positions included', async () => {
    renderPage('/dictionaries?tab=currencies');
    await screen.findByText('Polski złoty');
    expect(screen.getByRole('searchbox', { name: DICT_PL['currencies.searchLabel']! })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: DICT_PL['action.rowMenu']!.replace('{code}', 'PLN') }));
    await user.click(await screen.findByRole('menuitem', { name: DICT_PL['action.edit']! }));
    const position = screen.getByLabelText(DICT_PL['field.symbolPosition']!);
    expect(within(position).getAllByRole('option').map((option) => option.textContent)).toEqual([
      DICT_PL['symbolPosition.prefix'],
      DICT_PL['symbolPosition.suffix'],
    ]);
    expect(screen.getByRole('button', { name: DICT_PL['action.save']! })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: DICT_PL['action.cancel']! })).toBeInTheDocument();
  });

  it('says why loading failed in Polish', async () => {
    listCountries.mockRejectedValue(new Error('network'));
    renderPage();
    await waitFor(() => expect(screen.getByText(DICT_PL['countries.error.load']!)).toBeInTheDocument());
  });
});
