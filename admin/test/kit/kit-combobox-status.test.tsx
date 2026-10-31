import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';

/**
 * Issue #563 — `<Combobox>` says what state its list is in to assistive
 * technology as well as to the eye (WCAG 2.2 SC 4.1.3 Status Messages).
 *
 * The loading, empty and error rows live inside the open listbox, which a
 * screen reader does not announce when its text changes. So the combobox keeps
 * a polite live region mounted from the first render — **empty** until there is
 * something to say, because a region that arrives already carrying its message
 * is not reliably announced — and writes the same status into it.
 *
 * Every picker in the kit renders through this component, so this is the one
 * place the obligation is met; the picker tests assert their own copy.
 */

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');

const OPTIONS: ComboboxOption<string>[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
];

function status(): HTMLElement {
  return screen.getByRole('status');
}

async function open(): Promise<void> {
  await userEvent.setup().click(screen.getByRole('combobox', { name: 'Pick one' }));
}

describe('Combobox status live region', () => {
  it('is mounted and empty before the list is opened', () => {
    renderWithI18n(
      <Combobox options={OPTIONS} value={null} onChange={vi.fn()} ariaLabel="Pick one" />,
      EN,
    );
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().textContent).toBe('');
  });

  it('announces a load in flight, then what it found', async () => {
    const { rerender } = renderWithI18n(
      <Combobox options={[]} value={null} onChange={vi.fn()} ariaLabel="Pick one" loading />,
      EN,
    );
    await open();
    expect(status().textContent).toBe('Loading…');

    rerender(<Combobox options={OPTIONS} value={null} onChange={vi.fn()} ariaLabel="Pick one" />);
    await waitFor(() => expect(status().textContent).toBe('Results: 2'));
  });

  it('announces an empty list, and the caller’s message when it gives one', async () => {
    const { rerender } = renderWithI18n(
      <Combobox options={[]} value={null} onChange={vi.fn()} ariaLabel="Pick one" />,
      EN,
    );
    await open();
    expect(status().textContent).toBe('No results.');

    // A picker hands its failure in as the empty message; that is what is read out.
    rerender(
      <Combobox
        options={[]}
        value={null}
        onChange={vi.fn()}
        ariaLabel="Pick one"
        emptyMessage="Search failed."
      />,
    );
    await waitFor(() => expect(status().textContent).toBe('Search failed.'));
  });

  it('announces how many options the typed filter leaves', async () => {
    renderWithI18n(
      <Combobox options={OPTIONS} value={null} onChange={vi.fn()} ariaLabel="Pick one" />,
      EN,
    );
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Pick one' }), 'brav');
    await waitFor(() => expect(status().textContent).toBe('Results: 1'));
  });

  it('falls silent again when the list closes', async () => {
    renderWithI18n(
      <Combobox options={[]} value={null} onChange={vi.fn()} ariaLabel="Pick one" />,
      EN,
    );
    await open();
    expect(status().textContent).toBe('No results.');
    await userEvent.setup().keyboard('{Escape}');
    expect(status().textContent).toBe('');
  });

  it('says its default loading and empty messages in Polish', async () => {
    const { rerender } = renderWithI18n(
      <Combobox options={[]} value={null} onChange={vi.fn()} ariaLabel="Pick one" loading />,
      PL,
      { language: 'pl' },
    );
    await open();
    expect(screen.getByRole('listbox').textContent).toBe('Wczytywanie…');
    expect(status().textContent).toBe('Wczytywanie…');

    rerender(<Combobox options={[]} value={null} onChange={vi.fn()} ariaLabel="Pick one" />);
    await waitFor(() => expect(screen.getByRole('listbox').textContent).toBe('Brak wyników.'));
    expect(status().textContent).toBe('Brak wyników.');
  });
});
