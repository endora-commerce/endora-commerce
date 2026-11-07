import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';

/**
 * Issue #846 — what `<Combobox>` lets you clear follows the value the field
 * shows, not the options it has loaded.
 *
 * A server-side picker loads one page of one query at a time, so the committed
 * value is often not among its options: somebody beyond the first page, or a
 * record the lookup no longer returns (a deactivated admin). The field still
 * shows that value through `selectedLabel`, and a value that is shown must be
 * clearable — by the Clear button and by Backspace on an empty input alike.
 */

const EN = shippedCoreBundle('en');
const CLEAR = 'Clear selection';

const LOADED: ComboboxOption<string>[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
];

function field(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Pick one' });
}

describe('Combobox clearing a value that is not among the loaded options', () => {
  it('shows it through selectedLabel and offers Clear, which clears it', async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <Combobox
        options={LOADED}
        value="z"
        selectedLabel="Zulu"
        onChange={onChange}
        ariaLabel="Pick one"
        manualFilter
      />,
      EN,
    );
    expect(field()).toHaveValue('Zulu');

    await userEvent.setup().click(screen.getByRole('button', { name: CLEAR }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('clears it with Backspace on the empty input', async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <Combobox
        options={LOADED}
        value="z"
        selectedLabel="Zulu"
        onChange={onChange}
        ariaLabel="Pick one"
        manualFilter
      />,
      EN,
    );
    const user = userEvent.setup();
    await user.click(field());
    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('offers Clear while the options are still empty, before any page has loaded', () => {
    renderWithI18n(
      <Combobox
        options={[]}
        value="z"
        selectedLabel="Zulu"
        onChange={vi.fn()}
        ariaLabel="Pick one"
        loading
        manualFilter
      />,
      EN,
    );
    expect(screen.getByRole('button', { name: CLEAR })).toBeInTheDocument();
  });

  it('still offers nothing to clear when the field shows nothing', () => {
    renderWithI18n(
      <Combobox options={LOADED} value={null} onChange={vi.fn()} ariaLabel="Pick one" />,
      EN,
    );
    expect(screen.queryByRole('button', { name: CLEAR })).toBeNull();
  });

  it('keeps clearable={false} and disabled meaning no Clear', () => {
    const { rerender } = renderWithI18n(
      <Combobox
        options={LOADED}
        value="z"
        selectedLabel="Zulu"
        onChange={vi.fn()}
        ariaLabel="Pick one"
        clearable={false}
      />,
      EN,
    );
    expect(screen.queryByRole('button', { name: CLEAR })).toBeNull();

    rerender(
      <Combobox
        options={LOADED}
        value="z"
        selectedLabel="Zulu"
        onChange={vi.fn()}
        ariaLabel="Pick one"
        disabled
      />,
    );
    expect(screen.queryByRole('button', { name: CLEAR })).toBeNull();
  });

  it('does not clear with Backspace when clearable={false}', async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <Combobox
        options={LOADED}
        value="z"
        selectedLabel="Zulu"
        onChange={onChange}
        ariaLabel="Pick one"
        clearable={false}
      />,
      EN,
    );
    const user = userEvent.setup();
    await user.click(field());
    await user.keyboard('{Backspace}');
    expect(onChange).not.toHaveBeenCalled();
  });
});
