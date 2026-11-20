import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { Country, DictionaryCurrency, DictionaryLanguage } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — the dictionary
 * tabs said "Made default", "Saved" and "Deleted" in a success banner
 * conditionally mounted above the table. It is now an always-mounted polite
 * region in the list's toolbar, beside the button that opens the editor, and
 * an error empties it so "Saved" is never said beside a refusal.
 *
 * The paths name the package's `src/`, batch 8's convention for a screen test.
 */

const client = {
  listLanguages: vi.fn(),
  listCountries: vi.fn(),
  listCurrencies: vi.fn(),
  listTranslations: vi.fn(),
  setDefaultLanguage: vi.fn(),
  setDefaultCountry: vi.fn(),
  setDefaultCurrency: vi.fn(),
};

vi.mock('../../../../packages/modules/dictionaries/src/admin/api/client', () => ({
  dictionaryClient: new Proxy(
    {},
    { get: (_target, key: string) => (...args: unknown[]) => (client as Record<string, (...a: unknown[]) => unknown>)[key]?.(...args) },
  ),
}));

const { LanguagesTab } = await import('../../../../packages/modules/dictionaries/src/admin/tabs/LanguagesTab');
const { CurrenciesTab } = await import('../../../../packages/modules/dictionaries/src/admin/tabs/CurrenciesTab');
const { CountriesTab } = await import('../../../../packages/modules/dictionaries/src/admin/tabs/CountriesTab');

const bundle = passthroughBundle('dictionaries', [
  'action.setDefault',
  'language.madeDefault',
  'currency.madeDefault',
  'country.madeDefault',
  'error.setDefault',
]);

const STAMP = { createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' };

const language: DictionaryLanguage = {
  code: 'de',
  label: 'German',
  nativeLabel: 'Deutsch',
  isRtl: false,
  fallbackCode: null,
  isDefault: false,
  isActive: true,
  sortOrder: 10,
  countries: [],
  ...STAMP,
};

const currency: DictionaryCurrency = {
  code: 'EUR',
  label: 'Euro',
  symbol: '€',
  symbolPosition: 'suffix',
  decimalPlaces: 2,
  isDefault: false,
  isActive: true,
  sortOrder: 10,
  ...STAMP,
};

const country: Country = {
  code: 'DE',
  alpha3Code: 'DEU',
  numericCode: '276',
  label: 'Germany',
  region: 'Europe',
  subregion: null,
  dialCode: null,
  isEuMember: true,
  defaultCurrencyCode: null,
  isActive: true,
  isDefault: false,
  sortOrder: 10,
  ...STAMP,
};

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.listLanguages.mockResolvedValue({ data: [language] });
  client.listCountries.mockResolvedValue({ data: [country] });
  client.listCurrencies.mockResolvedValue({ data: [currency] });
  client.listTranslations.mockResolvedValue({ data: [] });
});

const successBanners = (): Element[] =>
  Array.from(document.querySelectorAll('[data-slot="alert"][data-variant="success"]'));

const CASES: Array<{ name: string; ui: () => ReactElement; setDefault: keyof typeof client; done: string }> = [
  { name: 'Languages', ui: () => <LanguagesTab />, setDefault: 'setDefaultLanguage', done: 'language.madeDefault' },
  { name: 'Currencies', ui: () => <CurrenciesTab />, setDefault: 'setDefaultCurrency', done: 'currency.madeDefault' },
  { name: 'Countries', ui: () => <CountriesTab />, setDefault: 'setDefaultCountry', done: 'country.madeDefault' },
];

describe.each(CASES)('$name tab — action results beside the toolbar (SALES-17)', ({ ui, setDefault, done }) => {
  async function renderTab(): Promise<HTMLElement> {
    renderWithI18n(ui(), bundle);
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(1));
    const region = screen.getByRole('status');
    return region;
  }

  it('mounts the result region empty in the list toolbar, before anything happened', async () => {
    const region = await renderTab();
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    // Same toolbar as the button that opens the editor (Proximity).
    expect(region.parentElement?.querySelector('button')).not.toBeNull();
  });

  it('says "made default" in that region and puts no success banner above the table', async () => {
    client[setDefault].mockResolvedValue(undefined);
    const region = await renderTab();
    fireEvent.click(within(document.querySelector('tbody')!).getByRole('button', { name: 'action.setDefault' }));
    await waitFor(() => expect(region).toHaveTextContent(done));
    expect(region).toHaveAttribute('data-tone', 'success');
    expect(successBanners()).toEqual([]);
  });

  it('empties the region when the next action is refused, so the error stands alone', async () => {
    client[setDefault].mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('nope'));
    const region = await renderTab();
    const star = (): HTMLElement =>
      within(document.querySelector('tbody')!).getByRole('button', { name: 'action.setDefault' });
    fireEvent.click(star());
    await waitFor(() => expect(region).toHaveTextContent(done));
    fireEvent.click(star());
    await waitFor(() => expect(document.querySelector('[data-slot="alert"][data-variant="destructive"]')).not.toBeNull());
    expect(region.textContent).toBe('');
  });
});
