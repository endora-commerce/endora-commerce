import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { Combobox } from '../../../packages/admin-shell/src/components/ui/combobox';
import { MultiSelect } from '../../../packages/admin-shell/src/components/ui/multi-select';

/**
 * Issue #236 — the same folding rule, written a third and a fourth time.
 *
 * `combobox.tsx` and `multi-select.tsx` each carried a private `normalize`
 * with the same shape the page-builder drawer had: NFD, strip combining
 * marks, lowercase. `ł` survives all three steps, so every picker in the
 * admin — sales channels, warehouses, categories, column filters — refused
 * the unaccented spelling of any Polish option whose label carries one.
 *
 * `Metody płatności` and `Wpłata` below are shipped admin copy, not fixtures
 * invented to fold nicely.
 */

/** The combobox resolves its clear-button label unconditionally. */
const BUNDLE = passthroughBundle('core', ['common.combobox.clearSelection']);

const OPTIONS = [
  { value: 'payments', label: 'Metody płatności' },
  { value: 'deposit', label: 'Wpłata' },
  { value: 'orders', label: 'Zamówienia' },
];

describe('Combobox — diacritic-insensitive option search (issue #236)', () => {
  function renderCombobox(): HTMLInputElement {
    renderWithI18n(
      <Combobox
        options={OPTIONS}
        value={null}
        onChange={vi.fn()}
        ariaLabel="Pick one"
        placeholder="Pick one"
      />,
      BUNDLE,
    );
    return screen.getByRole('combobox') as HTMLInputElement;
  }

  function visibleOptions(): string[] {
    return screen.queryAllByRole('option').map((el) => (el.textContent ?? '').trim());
  }

  it('finds an option whose label carries a stroked ł, typed without it', () => {
    const input = renderCombobox();
    fireEvent.change(input, { target: { value: 'platnosci' } });
    expect(visibleOptions()).toEqual(['Metody płatności']);
  });

  it('folds ordinary combining diacritics too', () => {
    const input = renderCombobox();
    fireEvent.change(input, { target: { value: 'zamowienia' } });
    expect(visibleOptions()).toEqual(['Zamówienia']);
  });

  it('ignores whitespace around the query', () => {
    const input = renderCombobox();
    fireEvent.change(input, { target: { value: ' wplata ' } });
    expect(visibleOptions()).toEqual(['Wpłata']);
  });
});

describe('MultiSelect — diacritic-insensitive option search (issue #236)', () => {
  function openPanel(): HTMLElement {
    renderWithI18n(
      <MultiSelect
        options={OPTIONS}
        selected={[]}
        onChange={vi.fn()}
        placeholder="Pick some"
        ariaLabel="Pick some"
        searchable
        searchPlaceholder="Search options"
      />,
      BUNDLE,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick some' }));
    return screen.getByRole('listbox');
  }

  function typeSearch(panel: HTMLElement, query: string): void {
    fireEvent.change(within(panel).getByLabelText('Search options'), {
      target: { value: query },
    });
  }

  function visibleLabels(panel: HTMLElement): string[] {
    return [...panel.querySelectorAll('label')].map((el) => (el.textContent ?? '').trim());
  }

  it('finds an option whose label carries a stroked ł, typed without it', () => {
    const panel = openPanel();
    typeSearch(panel, 'platnosci');
    expect(visibleLabels(panel)).toEqual(['Metody płatności']);
  });

  it('ignores whitespace around the query', () => {
    const panel = openPanel();
    typeSearch(panel, ' zamowienia ');
    expect(visibleLabels(panel)).toEqual(['Zamówienia']);
  });
});
