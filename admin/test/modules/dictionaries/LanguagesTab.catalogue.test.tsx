import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import type { Country, DictionaryLanguage } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * The Languages tab once the dictionary holds the whole ISO 639-1 catalogue.
 *
 * It was written against two rows, and three things about it only show at 185:
 * the Countries column printed a bare count, the list had no way to narrow to
 * what is switched on, and it asked for the translations of every row on every
 * load — one request per language, to draw a badge that means nothing for a
 * language nobody serves.
 *
 * The paths name the package's `src/`, batch 8's convention for a screen test:
 * the package publishes only its barrels, so there is no subpath a test could
 * name a single component through.
 */

const listLanguages = vi.fn();
const listCountries = vi.fn();
const listTranslations = vi.fn();

vi.mock('../../../../packages/modules/dictionaries/src/admin/api/client', () => ({
  dictionaryClient: {
    listLanguages: (...args: unknown[]) => listLanguages(...args),
    listCountries: (...args: unknown[]) => listCountries(...args),
    listTranslations: (...args: unknown[]) => listTranslations(...args),
  },
}));

const { LanguagesTab } = await import(
  '../../../../packages/modules/dictionaries/src/admin/tabs/LanguagesTab'
);

const passthrough = passthroughBundle('dictionaries', [
  'languages.title',
  'languages.searchPlaceholder',
  'languages.addLanguage',
  'languages.filter.status',
  'languages.filter.all',
  'languages.filter.active',
  'languages.filter.inactive',
  'languages.column.countries',
  'languages.countries.none',
  'languages.empty',
  'badge.active',
  'badge.inactive',
  'badge.translationsComplete',
  'badge.translationsPartial',
  'badge.translationsPending',
]);
// One real template among the passthrough keys: the fold's count has to be
// interpolated for the assertion on it to mean anything.
const bundle = {
  dictionaries: { ...passthrough['dictionaries'], 'languages.countries.more': '+{count}' },
};

function language(
  overrides: Pick<DictionaryLanguage, 'code' | 'label' | 'nativeLabel'> &
    Partial<DictionaryLanguage>,
): DictionaryLanguage {
  return {
    isRtl: false,
    fallbackCode: null,
    isDefault: false,
    isActive: false,
    sortOrder: 1000,
    countries: [],
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
    ...overrides,
  };
}

function country(code: string, label: string): Country {
  return {
    code,
    alpha3Code: `${code}X`,
    numericCode: '000',
    label,
    region: 'Europe',
    subregion: null,
    dialCode: null,
    isEuMember: false,
    defaultCurrencyCode: null,
    isActive: true,
    isDefault: false,
    sortOrder: 100,
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
  };
}

const COUNTRIES: Country[] = [
  country('AT', 'Austria'),
  country('BE', 'Belgium'),
  country('CH', 'Switzerland'),
  country('DE', 'Germany'),
  country('IT', 'Italy'),
  country('LU', 'Luxembourg'),
  country('PL', 'Poland'),
  country('US', 'United States'),
];

const ROWS: DictionaryLanguage[] = [
  language({
    code: 'en-US',
    label: 'English (US)',
    nativeLabel: 'English (US)',
    isActive: true,
    isDefault: true,
    sortOrder: 0,
    countries: ['US'],
  }),
  language({
    code: 'pl-PL',
    label: 'Polski',
    nativeLabel: 'Polski',
    isActive: true,
    sortOrder: 1,
    countries: ['PL'],
  }),
  language({
    code: 'de',
    label: 'German',
    nativeLabel: 'Deutsch',
    sortOrder: 1010,
    countries: ['AT', 'BE', 'CH', 'DE', 'IT', 'LU'],
  }),
  language({ code: 'eo', label: 'Esperanto', nativeLabel: 'Esperanto', sortOrder: 1020 }),
  language({
    code: 'rm',
    label: 'Romansh',
    nativeLabel: 'Rumantsch',
    sortOrder: 1030,
    countries: ['CH'],
  }),
];

function rowFor(code: string): HTMLTableRowElement {
  const row = [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')].find(
    (candidate) => (candidate.querySelector('td')?.textContent ?? '').trim() === code,
  );
  if (!row) throw new Error(`no row for ${code}`);
  return row;
}

function visibleCodes(): string[] {
  return [...document.querySelectorAll('tbody tr')]
    .map((row) => (row.querySelector('td')?.textContent ?? '').trim())
    .filter((code) => code !== 'languages.empty');
}

/** The Countries cell is the fourth column. */
function countriesCell(code: string): HTMLElement {
  const cell = rowFor(code).querySelectorAll<HTMLElement>('td')[3];
  if (!cell) throw new Error(`no countries cell for ${code}`);
  return cell;
}

async function renderTab(rows: DictionaryLanguage[] = ROWS): Promise<void> {
  listLanguages.mockResolvedValue({ data: rows });
  listCountries.mockResolvedValue({ data: COUNTRIES });
  listTranslations.mockResolvedValue({ data: [] });
  renderWithI18n(<LanguagesTab />, bundle);
  await waitFor(() => expect(visibleCodes().length).toBeGreaterThan(0));
}

function searchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="languages.searchPlaceholder"]',
  );
  if (!input) throw new Error('language search input not found');
  return input;
}

function statusFilter(): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>(
    'select[aria-label="languages.filter.status"]',
  );
  if (!select) throw new Error('language status filter not found');
  return select;
}

describe('LanguagesTab — the ISO 639-1 catalogue', () => {
  beforeEach(() => {
    listLanguages.mockReset();
    listCountries.mockReset();
    listTranslations.mockReset();
  });

  it('shows the countries a language is used in as chips, and folds the rest into a count', async () => {
    await renderTab();

    const german = countriesCell('de');
    // Four chips, then how many more — never a bare number, never thirty chips.
    expect(within(german).getByText('AT')).toBeTruthy();
    expect(within(german).getByText('BE')).toBeTruthy();
    expect(within(german).getByText('CH')).toBeTruthy();
    expect(within(german).getByText('DE')).toBeTruthy();
    expect(within(german).queryByText('IT')).toBeNull();
    const more = within(german).getByText('+2');
    // The fold names what it hides, for a pointer and for a screen reader.
    expect(more.getAttribute('title')).toBe('IT — Italy, LU — Luxembourg');

    // A chip carries the country's name, not only its code.
    expect(within(german).getByText('CH').getAttribute('title')).toBe('Switzerland');
    expect(countriesCell('rm').textContent).toBe('CH');
  });

  it('says so when no country uses a language', async () => {
    await renderTab();
    expect(countriesCell('eo').textContent).toBe('languages.countries.none');
  });

  it('finds a language by a country that uses it, by code or by name', async () => {
    await renderTab();

    fireEvent.change(searchInput(), { target: { value: 'switzerland' } });
    await waitFor(() => expect(visibleCodes()).toEqual(['de', 'rm']));

    fireEvent.change(searchInput(), { target: { value: 'deutsch' } });
    await waitFor(() => expect(visibleCodes()).toEqual(['de']));

    fireEvent.change(searchInput(), { target: { value: 'no such language' } });
    await waitFor(() => expect(visibleCodes()).toEqual([]));
    expect(document.querySelector('tbody')?.textContent).toContain('languages.empty');
  });

  it('narrows the list to the languages that are switched on, or off', async () => {
    await renderTab();
    expect(visibleCodes()).toEqual(['en-US', 'pl-PL', 'de', 'eo', 'rm']);

    fireEvent.change(statusFilter(), { target: { value: 'active' } });
    await waitFor(() => expect(visibleCodes()).toEqual(['en-US', 'pl-PL']));

    fireEvent.change(statusFilter(), { target: { value: 'inactive' } });
    await waitFor(() => expect(visibleCodes()).toEqual(['de', 'eo', 'rm']));
  });

  it('asks for translations of the active languages only, and draws no translation badge for the rest', async () => {
    await renderTab();
    await waitFor(() => expect(listTranslations).toHaveBeenCalledTimes(2));
    expect(listTranslations.mock.calls.map((call) => call[1]).sort()).toEqual(['en-US', 'pl-PL']);

    expect(rowFor('de').textContent).toContain('badge.inactive');
    expect(rowFor('de').textContent).not.toContain('badge.translations');
    await waitFor(() =>
      expect(rowFor('pl-PL').textContent).toContain('badge.translationsPartial'),
    );
  });

  it('pages a catalogue-sized list instead of rendering every row', async () => {
    const many = Array.from({ length: 120 }, (_, index) =>
      language({
        code: `x${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
        label: `Language ${index}`,
        nativeLabel: `Language ${index}`,
        sortOrder: 1000 + index,
      }),
    );
    await renderTab(many);

    expect(visibleCodes()).toHaveLength(50);
    expect(visibleCodes()[0]).toBe('xaa');

    const next = [...document.querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').includes('common.pagination.next'),
    );
    if (!next) throw new Error('next-page button not found');
    fireEvent.click(next);
    await waitFor(() => expect(visibleCodes()[0]).toBe('xby'));
    expect(visibleCodes()).toHaveLength(50);

    // A search starts from the first page of its own results.
    fireEvent.change(searchInput(), { target: { value: 'Language 119' } });
    await waitFor(() => expect(visibleCodes()).toEqual(['xep']));
  });
});
