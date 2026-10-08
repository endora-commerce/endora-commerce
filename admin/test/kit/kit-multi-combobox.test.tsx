import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { useState, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Combobox, MultiCombobox } from '@endora-commerce/admin-kit/ui';
import type { ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';

/**
 * `MultiCombobox` — the searchable multi-select of `@endora-commerce/admin-kit/ui`.
 *
 * It is the multi-value sibling of `Combobox`: one text input carrying the
 * WAI-ARIA combobox role, a `listbox` popup filtered as the operator types, and
 * the current selection rendered as removable chips beside the input. It exists
 * because `MultiSelect` is a different control — a button that summarises the
 * selection over a panel of checkboxes — and cannot show which of two hundred
 * entries are selected without opening it.
 *
 * The bundle is `_i18n`'s **shipped** one, read off disk, for the reason
 * `kit-core-namespace.test.tsx` gives: a missing key renders as `core.<key>`
 * and a passthrough bundle would hide exactly that.
 */

const REPO_ROOT = resolve(process.cwd(), '..');

function coreBundle(language: 'en' | 'pl'): Bundle {
  const raw = readFileSync(
    join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`),
    'utf8',
  );
  return { core: JSON.parse(raw) as Record<string, string> };
}

function renderInCore(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReturnType<typeof render> {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={coreBundle(language)}>
      <>{children}</>
    </TranslationProvider>
  );
  return render(ui, { wrapper });
}

const OPTIONS: ComboboxOption[] = [
  { value: 'en-US', label: 'en-US — English', description: 'English' },
  { value: 'pl-PL', label: 'pl-PL — Polish', description: 'Polski' },
  { value: 'de-DE', label: 'de-DE — German', description: 'Deutsch' },
  { value: 'cs-CZ', label: 'cs-CZ — Czech', description: 'Čeština' },
];

/** A controlled host, so a test drives the control the way a form does. */
function Host({
  initial = [],
  options = OPTIONS,
  onChangeSpy,
  ...rest
}: {
  initial?: string[];
  options?: ComboboxOption[];
  onChangeSpy?: (next: string[]) => void;
} & Partial<React.ComponentProps<typeof MultiCombobox<string>>>): ReactElement {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <>
      <label htmlFor="langs">Languages</label>
      <MultiCombobox
        id="langs"
        options={options}
        value={value}
        onChange={(next) => {
          onChangeSpy?.(next);
          setValue(next);
        }}
        {...rest}
      />
      <button type="button">after</button>
    </>
  );
}

function input(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Languages' }) as HTMLInputElement;
}

function optionLabels(): string[] {
  return screen.queryAllByRole('option').map((el) => el.getAttribute('data-value') ?? '');
}

function chipValues(): string[] {
  return Array.from(document.querySelectorAll('[data-chip-value]')).map(
    (el) => el.getAttribute('data-chip-value') ?? '',
  );
}

describe('MultiCombobox — the combobox pattern', () => {
  it('is a labelled combobox that is closed until it is used', () => {
    renderInCore(<Host />);
    const el = input();
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(el.getAttribute('aria-autocomplete')).toBe('list');
    expect(el.getAttribute('aria-haspopup')).toBe('listbox');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens a multi-selectable listbox that the input controls', () => {
    renderInCore(<Host />);
    fireEvent.focus(input());
    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('aria-controls')).toBe(listbox.id);
    expect(optionLabels()).toEqual(['en-US', 'pl-PL', 'de-DE', 'cs-CZ']);
  });

  it('marks the selected options, not only the chips', () => {
    renderInCore(<Host initial={['pl-PL']} />);
    fireEvent.focus(input());
    const selected = screen
      .getAllByRole('option')
      .filter((el) => el.getAttribute('aria-selected') === 'true')
      .map((el) => el.getAttribute('data-value'));
    expect(selected).toEqual(['pl-PL']);
  });

  it('points aria-activedescendant at the highlighted option and moves it with the arrows', () => {
    renderInCore(<Host />);
    const el = input();
    fireEvent.keyDown(el, { key: 'ArrowDown' }); // opens
    const first = el.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();
    expect(document.getElementById(first!)?.getAttribute('data-value')).toBe('en-US');
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(
      document.getElementById(el.getAttribute('aria-activedescendant')!)?.getAttribute('data-value'),
    ).toBe('pl-PL');
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    fireEvent.keyDown(el, { key: 'ArrowUp' }); // wraps to the last
    expect(
      document.getElementById(el.getAttribute('aria-activedescendant')!)?.getAttribute('data-value'),
    ).toBe('cs-CZ');
    fireEvent.keyDown(el, { key: 'Home' });
    expect(
      document.getElementById(el.getAttribute('aria-activedescendant')!)?.getAttribute('data-value'),
    ).toBe('en-US');
    fireEvent.keyDown(el, { key: 'End' });
    expect(
      document.getElementById(el.getAttribute('aria-activedescendant')!)?.getAttribute('data-value'),
    ).toBe('cs-CZ');
  });

  it('closes on Escape and keeps the selection', () => {
    renderInCore(<Host initial={['pl-PL']} />);
    const el = input();
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: 'ger' } });
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(el.value).toBe('');
    expect(chipValues()).toEqual(['pl-PL']);
  });

  it('closes when focus leaves the control', () => {
    renderInCore(<Host />);
    const el = input();
    fireEvent.focus(el);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.blur(el, { relatedTarget: screen.getByRole('button', { name: 'after' }) });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('MultiCombobox — type-ahead', () => {
  it('filters by the label, which carries the code', () => {
    renderInCore(<Host />);
    fireEvent.change(input(), { target: { value: 'de-' } });
    expect(optionLabels()).toEqual(['de-DE']);
  });

  it('filters by the description, which carries the other name', () => {
    renderInCore(<Host />);
    fireEvent.change(input(), { target: { value: 'polski' } });
    expect(optionLabels()).toEqual(['pl-PL']);
  });

  it('is diacritic- and whitespace-insensitive', () => {
    renderInCore(<Host />);
    fireEvent.change(input(), { target: { value: '  cestina ' } });
    expect(optionLabels()).toEqual(['cs-CZ']);
  });

  it('says so when nothing matches, in the listbox and without an option', () => {
    renderInCore(<Host emptyMessage="No language matches." />);
    fireEvent.change(input(), { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toEqual([]);
    expect(within(screen.getByRole('listbox')).getByText('No language matches.')).toBeTruthy();
  });

  it('falls back to a translated "no matches" line when the caller gives none', () => {
    renderInCore(<Host />, 'pl');
    fireEvent.change(input(), { target: { value: 'zzz' } });
    expect(within(screen.getByRole('listbox')).getByText('Brak pasujących pozycji')).toBeTruthy();
  });

  it('stays usable with a couple of hundred options', () => {
    const many: ComboboxOption[] = Array.from({ length: 240 }, (_, i) => ({
      value: `l${i}`,
      label: `l${i} — Language ${i}`,
    }));
    renderInCore(<Host options={many} />);
    fireEvent.focus(input());
    expect(screen.getAllByRole('option')).toHaveLength(240);
    fireEvent.change(input(), { target: { value: 'language 239' } });
    expect(optionLabels()).toEqual(['l239']);
  });
});

describe('MultiCombobox — selecting and removing', () => {
  it('adds the highlighted option on Enter, keeps the list open and clears the query', () => {
    const spy = vi.fn();
    renderInCore(<Host initial={['en-US']} onChangeSpy={spy} />);
    const el = input();
    fireEvent.change(el, { target: { value: 'pol' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(spy).toHaveBeenLastCalledWith(['en-US', 'pl-PL']);
    expect(chipValues()).toEqual(['en-US', 'pl-PL']);
    expect(el.value).toBe('');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('adds an option on click', () => {
    const spy = vi.fn();
    renderInCore(<Host onChangeSpy={spy} />);
    fireEvent.focus(input());
    fireEvent.click(screen.getAllByRole('option')[2]!);
    expect(spy).toHaveBeenLastCalledWith(['de-DE']);
  });

  it('removes an option that is already selected when it is chosen again', () => {
    const spy = vi.fn();
    renderInCore(<Host initial={['en-US', 'pl-PL']} onChangeSpy={spy} />);
    const el = input();
    fireEvent.change(el, { target: { value: 'pol' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(spy).toHaveBeenLastCalledWith(['en-US']);
  });

  it('removes the last chip on Backspace in an empty input', () => {
    const spy = vi.fn();
    renderInCore(<Host initial={['en-US', 'pl-PL']} onChangeSpy={spy} />);
    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(spy).toHaveBeenLastCalledWith(['en-US']);
    expect(chipValues()).toEqual(['en-US']);
  });

  it('leaves the chips alone on Backspace while there is a query to edit', () => {
    const spy = vi.fn();
    renderInCore(<Host initial={['en-US', 'pl-PL']} onChangeSpy={spy} />);
    const el = input();
    fireEvent.change(el, { target: { value: 'p' } });
    fireEvent.keyDown(el, { key: 'Backspace' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('gives every chip a named remove button that removes that chip', () => {
    const spy = vi.fn();
    renderInCore(<Host initial={['en-US', 'pl-PL']} onChangeSpy={spy} />);
    const remove = screen.getByRole('button', { name: 'Remove en-US — English' });
    expect(remove.getAttribute('type')).toBe('button');
    fireEvent.click(remove);
    expect(spy).toHaveBeenLastCalledWith(['pl-PL']);
  });

  it('names the remove button in Polish too', () => {
    renderInCore(<Host initial={['pl-PL']} />, 'pl');
    expect(screen.getByRole('button', { name: 'Usuń: pl-PL — Polish' })).toBeTruthy();
  });

  it('announces what was added and removed in a live region mounted before it has text', () => {
    renderInCore(<Host />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    const el = input();
    fireEvent.change(el, { target: { value: 'pol' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(status.textContent).toBe('pl-PL — Polish added');
    fireEvent.keyDown(el, { key: 'Backspace' });
    expect(status.textContent).toBe('pl-PL — Polish removed');
  });

  it('still shows a chip for a stored value the options no longer carry', () => {
    renderInCore(<Host initial={['xx-XX']} />);
    expect(chipValues()).toEqual(['xx-XX']);
    expect(screen.getByRole('button', { name: 'Remove xx-XX' })).toBeTruthy();
  });
});

describe('MultiCombobox — states', () => {
  it('reports loading as a busy combobox and a line in the listbox', () => {
    renderInCore(<Host options={[]} loading loadingMessage="Loading languages…" />);
    const el = input();
    expect(el.getAttribute('aria-busy')).toBe('true');
    fireEvent.focus(el);
    expect(within(screen.getByRole('listbox')).getByText('Loading languages…')).toBeTruthy();
  });

  it('carries an error to assistive technology', () => {
    renderInCore(<Host invalid ariaDescribedBy="langs-error" />);
    const el = input();
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.getAttribute('aria-describedby')).toBe('langs-error');
  });

  it('is not invalid unless it is told so', () => {
    renderInCore(<Host />);
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('does nothing while disabled', () => {
    const spy = vi.fn();
    renderInCore(<Host initial={['en-US']} disabled onChangeSpy={spy} />);
    const el = input();
    expect(el.disabled).toBe(true);
    fireEvent.keyDown(el, { key: 'Backspace' });
    expect(spy).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Remove en-US — English' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('renders no raw translation key', () => {
    const { container } = renderInCore(<Host initial={['en-US']} />);
    fireEvent.change(input(), { target: { value: 'zzz' } });
    expect(container.innerHTML).not.toMatch(/\bcore\.[a-zA-Z]/);
  });
});

/**
 * Two additions to the single-value `Combobox`, both needed the moment it is
 * used as a required form field rather than as a filter.
 */
describe('Combobox — as a validated form field', () => {
  const options: ComboboxOption[] = [
    { value: 'en-US', label: 'en-US — English' },
    { value: 'pl-PL', label: 'pl-PL — Polish' },
  ];

  it('carries an error to assistive technology', () => {
    renderInCore(
      <Combobox
        options={options}
        value={null}
        onChange={() => undefined}
        ariaLabel="Default language"
        invalid
        ariaDescribedBy="default-error"
      />,
    );
    const el = screen.getByRole('combobox', { name: 'Default language' });
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.getAttribute('aria-describedby')).toBe('default-error');
  });

  it('is not invalid unless it is told so', () => {
    renderInCore(
      <Combobox options={options} value={null} onChange={() => undefined} ariaLabel="Default language" />,
    );
    const el = screen.getByRole('combobox', { name: 'Default language' });
    expect(el.hasAttribute('aria-invalid')).toBe(false);
    expect(el.hasAttribute('aria-describedby')).toBe(false);
  });

  it('closes its listbox when focus moves on, so a form tabbed through leaves none open', () => {
    renderInCore(
      <>
        <Combobox options={options} value={null} onChange={() => undefined} ariaLabel="Default language" />
        <button type="button">after</button>
      </>,
    );
    const el = screen.getByRole('combobox', { name: 'Default language' });
    fireEvent.focus(el);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.blur(el, { relatedTarget: screen.getByRole('button', { name: 'after' }) });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
