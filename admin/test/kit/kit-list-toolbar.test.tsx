import { describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '@endora-commerce/admin-kit/ui';
import { FilterChip, ListToolbar, ListToolbarSearch } from '@endora-commerce/admin-kit/components';
import type { AppliedFilter } from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1440 (UX audit 2026-11-17, DS-06) — the kit's list toolbar: a labelled
 * search, the three or four filters an operator uses most, the rest behind
 * *More filters (n)*, removable chips for what is applied, and a `FilterChip`
 * whose state is `aria-pressed` rather than a colour.
 */

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');

function Chip(props: { initial?: boolean; onPressedChange?: (next: boolean) => void; disabled?: boolean }): ReactElement {
  const [pressed, setPressed] = useState(props.initial ?? false);
  return (
    <FilterChip
      pressed={pressed}
      onPressedChange={(next) => {
        setPressed(next);
        props.onPressedChange?.(next);
      }}
      icon={<svg data-testid="chip-icon" />}
      {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
    >
      Low stock
    </FilterChip>
  );
}

describe('FilterChip', () => {
  it('is a button whose pressed state is aria-pressed, never colour alone', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Chip onPressedChange={onChange} />, EN);
    const chip = screen.getByRole('button', { name: 'Low stock' });
    expect(chip.getAttribute('type')).toBe('button');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(chip);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(chip);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles from the keyboard', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Chip onPressedChange={onChange} />, EN);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Low stock' }));
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(true);
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps its icon out of the accessible name and carries a focus ring and a coarse-pointer hit area', () => {
    renderWithI18n(<Chip />, EN);
    const chip = screen.getByRole('button', { name: 'Low stock' });
    expect(screen.getByTestId('chip-icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(chip.className).toContain('b2b-filterchip');
    expect(chip.className).toContain('focus-visible:ring-2');
    expect(chip.className).toContain('pointer-coarse:before:-inset-y-2');
  });

  it('pressed renders the theme’s on state; disabled ignores presses', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Chip initial disabled onPressedChange={onChange} />, EN);
    const chip = screen.getByRole('button', { name: 'Low stock' });
    expect(chip.className).toContain('is-on');
    await userEvent.click(chip);
    expect(onChange).not.toHaveBeenCalled();
  });
});

function Toolbar(props: {
  hiddenActive?: number;
  applied?: AppliedFilter[];
  onClear?: () => void;
  withMore?: boolean;
  onMoreOpenChange?: (open: boolean) => void;
}): ReactElement {
  const [q, setQ] = useState('');
  return (
    <ListToolbar
      label="Filter products"
      search={<ListToolbarSearch label="Search products" placeholder="Name or SKU" value={q} onValueChange={setQ} />}
      filters={
        <Select aria-label="Type" defaultValue="">
          <option value="">All types</option>
          <option value="simple">Simple</option>
        </Select>
      }
      actions={<button type="button">Saved views</button>}
      {...(props.withMore === false
        ? {}
        : {
            moreFilters: (
              <Select aria-label="Visibility" defaultValue="">
                <option value="">Any visibility</option>
              </Select>
            ),
          })}
      {...(props.hiddenActive !== undefined ? { moreFiltersActiveCount: props.hiddenActive } : {})}
      {...(props.onMoreOpenChange ? { onMoreFiltersOpenChange: props.onMoreOpenChange } : {})}
      {...(props.applied ? { appliedFilters: props.applied } : {})}
      {...(props.onClear ? { onClearFilters: props.onClear } : {})}
    />
  );
}

describe('ListToolbar — the region and its search', () => {
  it('is a search landmark named by its label, and the search box has an accessible name', async () => {
    renderWithI18n(<Toolbar />, EN);
    expect(screen.getByRole('search', { name: 'Filter products' })).toBeInTheDocument();
    const box = screen.getByRole('searchbox', { name: 'Search products' });
    expect(box.getAttribute('placeholder')).toBe('Name or SKU');
    await userEvent.type(box, 'bolt');
    expect((box as HTMLInputElement).value).toBe('bolt');
  });

  it('places the primary filters before the actions in reading order', () => {
    renderWithI18n(<Toolbar />, EN);
    const type = screen.getByRole('combobox', { name: 'Type' });
    const views = screen.getByRole('button', { name: 'Saved views' });
    expect(type.compareDocumentPosition(views) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no disclosure when there is nothing to fold away', () => {
    renderWithI18n(<Toolbar withMore={false} />, EN);
    expect(screen.queryByRole('button', { name: /more filters/i })).toBeNull();
  });
});

describe('ListToolbar — More filters (n)', () => {
  it('folds the rest away: collapsed, the controlled panel is mounted and hidden, its controls are not rendered', () => {
    renderWithI18n(<Toolbar />, EN);
    const toggle = screen.getByRole('button', { name: 'More filters' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel?.hidden).toBe(true);
    expect(screen.queryByRole('combobox', { name: 'Visibility' })).toBeNull();
  });

  it('opens and closes, saying which it will do', async () => {
    const onOpen = vi.fn();
    renderWithI18n(<Toolbar onMoreOpenChange={onOpen} />, EN);
    await userEvent.click(screen.getByRole('button', { name: 'More filters' }));
    const toggle = screen.getByRole('button', { name: 'Fewer filters' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(onOpen).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('combobox', { name: 'Visibility' })).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'More filters' })).toBeInTheDocument();
    expect(onOpen).toHaveBeenLastCalledWith(false);
  });

  it('counts the hidden filters in use while collapsed, so a folded bar still says the list is narrowed', () => {
    renderWithI18n(<Toolbar hiddenActive={2} />, EN);
    expect(screen.getByRole('button', { name: 'More filters (2)' })).toBeInTheDocument();
  });

  it('speaks Polish', async () => {
    renderWithI18n(<Toolbar hiddenActive={3} />, PL);
    expect(screen.getByRole('button', { name: 'Więcej filtrów (3)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Więcej filtrów (3)' }));
    expect(screen.getByRole('button', { name: 'Mniej filtrów' })).toBeInTheDocument();
  });
});

describe('ListToolbar — applied filters', () => {
  it('lists each applied filter as a removable chip named by what it removes, with one Clear all', async () => {
    const removeStatus = vi.fn();
    const removeCustom = vi.fn();
    const clear = vi.fn();
    renderWithI18n(
      <Toolbar
        applied={[
          { key: 'status:paid', label: 'Status: Paid', onRemove: removeStatus },
          { key: 'cf.color', label: 'Colour: red', onRemove: removeCustom, removeLabel: 'Remove the Colour filter' },
        ]}
        onClear={clear}
      />,
      EN,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Status: Paid' }));
    expect(removeStatus).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Remove the Colour filter' }));
    expect(removeCustom).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('renders no chip row and no Clear all when nothing is applied', () => {
    renderWithI18n(<Toolbar applied={[]} onClear={vi.fn()} />, EN);
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).toBeNull();
  });
});

describe('ListToolbar — axe', () => {
  it.each([
    ['collapsed', <Toolbar key="collapsed" />],
    ['with hidden filters in use', <Toolbar key="count" hiddenActive={2} />],
    [
      'with applied filters',
      <Toolbar
        key="applied"
        applied={[{ key: 'a', label: 'Status: Paid', onRemove: (): void => undefined }]}
        onClear={(): void => undefined}
      />,
    ],
    ['a pressed chip', <Chip key="chip" initial />],
  ] as const)('%s has no WCAG 2.2 AA violation axe can see', async (_kind, ui) => {
    const { container } = renderWithI18n(ui, EN);
    await expectNoAxeViolations(container);
  });

  it('expanded has no WCAG 2.2 AA violation axe can see', async () => {
    const { container } = renderWithI18n(<Toolbar />, EN);
    await userEvent.click(screen.getByRole('button', { name: 'More filters' }));
    await expectNoAxeViolations(container);
  });
});
