import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';
import {
  EditableGrid,
  type EditableGridCellChange,
  type EditableGridChangeReason,
  type EditableGridHandle,
  type EditableGridRenderContext,
} from '@endora-commerce/admin-kit/components';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * The editable grid primitive (feature 161, T039; FR-011, FR-031, FR-036;
 * `research.md` R4) — an ARIA data grid that knows nothing about prices.
 *
 * The harness below owns the cell texts, the way the price-book editor owns its
 * edit state: the grid reports changes as `{ rowKey, columnKey, text }` groups
 * and renders whatever the caller hands back. Every keyboard path is driven
 * through `user-event` — FR-011 is "without a pointing device", so a test that
 * clicked its way to a state would not test the requirement.
 *
 * The copy is the kit's **shipped** `core` bundle (`_i18n`), read off disk, so a
 * key missing in either language fails here rather than rendering `core.…`.
 */

const REPO_ROOT = resolve(process.cwd(), '..');

function coreBundle(language: 'en' | 'pl'): Bundle {
  const raw = readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`), 'utf8');
  return { core: JSON.parse(raw) as Record<string, string> };
}

const COLUMNS = [
  { key: 'q1', label: 'From 1' },
  { key: 'q10', label: 'From 10' },
  { key: 'q100', label: 'From 100' },
] as const;

const ROWS = [
  { key: 'alpha', label: 'Alpha' },
  { key: 'bravo', label: 'Bravo' },
  { key: 'charlie', label: 'Charlie' },
  { key: 'delta', label: 'Delta' },
  { key: 'echo', label: 'Echo', readOnly: true },
] as const;

const cellKey = (rowKey: string, columnKey: string): string => `${rowKey}|${columnKey}`;

interface HarnessProps {
  readonly initial?: Record<string, string>;
  readonly errors?: Record<string, string>;
  readonly readOnly?: boolean;
  readonly onChange?: (changes: readonly EditableGridCellChange[], reason: EditableGridChangeReason) => void;
  readonly renderSpy?: (key: string) => void;
  readonly handleRef?: { current: EditableGridHandle | null };
  readonly tokens?: Record<string, string>;
}

function Harness(props: HarnessProps): ReactNode {
  const [texts, setTexts] = useState<Record<string, string>>(props.initial ?? {});
  const spy = props.renderSpy;
  const renderCell = useCallback(
    (ctx: EditableGridRenderContext): ReactNode => {
      spy?.(cellKey(ctx.rowKey, ctx.columnKey));
      return <span data-testid={`v-${cellKey(ctx.rowKey, ctx.columnKey)}`}>{ctx.text}</span>;
    },
    [spy],
  );
  const localRef = useRef<EditableGridHandle | null>(null);
  return (
    <>
      <button type="button">before</button>
      <EditableGrid
        ref={props.handleRef ?? localRef}
        label="Prices"
        rowHeaderLabel="Line"
        columns={COLUMNS}
        rows={ROWS}
        totalRowCount={42}
        rowIndexOffset={10}
        pageStep={2}
        readOnly={props.readOnly ?? false}
        getText={(rowKey, columnKey) => texts[cellKey(rowKey, columnKey)] ?? ''}
        getError={(rowKey, columnKey) => props.errors?.[cellKey(rowKey, columnKey)]}
        {...(props.tokens ? { getCellToken: (rowKey: string, columnKey: string) => props.tokens![cellKey(rowKey, columnKey)] ?? '' } : {})}
        renderCell={renderCell}
        onChange={(changes, reason) => {
          props.onChange?.(changes, reason);
          setTexts((current) => {
            const next = { ...current };
            for (const change of changes) next[cellKey(change.rowKey, change.columnKey)] = change.text;
            return next;
          });
        }}
      />
      <button type="button">after</button>
    </>
  );
}

function mount(props: HarnessProps = {}, language: 'en' | 'pl' = 'en'): ReturnType<typeof render> {
  const bundle = coreBundle(language);
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={bundle}>
      <>{children}</>
    </TranslationProvider>
  );
  return render(<Harness {...props} />, { wrapper });
}

const grid = (): HTMLElement => screen.getByRole('grid', { name: 'Prices' });

/** The data cell at a 0-based row and column of the rendered page. */
function cell(row: number, column: number): HTMLElement {
  const rows = within(grid()).getAllByRole('row').slice(1);
  return within(rows[row]!).getAllByRole('gridcell')[column]!;
}

const focused = (): Element | null => document.activeElement;
const status = (): HTMLElement => screen.getByRole('status');

async function focusGrid(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  screen.getByRole('button', { name: 'before' }).focus();
  await user.tab();
}

describe('EditableGrid — structure', () => {
  it('is an ARIA grid with column headers, row headers, counts and paging indexes', () => {
    mount();
    const g = grid();
    expect(g).toHaveAttribute('aria-rowcount', '43'); // 42 lines + the header row
    expect(g).toHaveAttribute('aria-colcount', '4'); // the row header + 3 columns
    expect(g).toHaveAttribute('aria-multiselectable', 'true');
    expect(within(g).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Line',
      'From 1',
      'From 10',
      'From 100',
    ]);
    expect(within(g).getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
    ]);
    const rows = within(g).getAllByRole('row');
    expect(rows[0]).toHaveAttribute('aria-rowindex', '1');
    // The page starts at line 11: `rowIndexOffset` 10, plus the header row.
    expect(rows[1]).toHaveAttribute('aria-rowindex', '12');
    expect(rows[5]).toHaveAttribute('aria-rowindex', '16');
    expect(within(g).getAllByRole('gridcell')).toHaveLength(15);
  });

  it('has exactly one tab stop and keeps it on the active cell', async () => {
    const user = userEvent.setup();
    mount();
    const tabbable = within(grid())
      .getAllByRole('gridcell')
      .filter((c) => c.tabIndex === 0);
    expect(tabbable).toEqual([cell(0, 0)]);
    await focusGrid(user);
    expect(focused()).toBe(cell(0, 0));
    await user.keyboard('{ArrowRight}');
    // Tab leaves the grid from wherever the focus is; Shift+Tab comes back to it.
    await user.tab();
    expect(focused()).toBe(screen.getByRole('button', { name: 'after' }));
    await user.tab({ shift: true });
    expect(focused()).toBe(cell(0, 1));
    expect(within(grid()).getAllByRole('gridcell').filter((c) => c.tabIndex === 0)).toEqual([cell(0, 1)]);
  });

  it('mounts its live region empty, before it has anything to say', () => {
    mount();
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(status().textContent).toBe('');
  });
});

describe('EditableGrid — moving', () => {
  it('moves with the arrows, Home/End, Ctrl+Home/End and PageUp/PageDown, stopping at the edges', async () => {
    const user = userEvent.setup();
    mount();
    await focusGrid(user);
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(focused()).toBe(cell(0, 0));
    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(focused()).toBe(cell(1, 1));
    await user.keyboard('{End}');
    expect(focused()).toBe(cell(1, 2));
    await user.keyboard('{Home}');
    expect(focused()).toBe(cell(1, 0));
    await user.keyboard('{PageDown}');
    expect(focused()).toBe(cell(3, 0)); // pageStep 2
    await user.keyboard('{PageDown}');
    expect(focused()).toBe(cell(4, 0)); // clamped to the last line
    await user.keyboard('{PageUp}');
    expect(focused()).toBe(cell(2, 0));
    await user.keyboard('{Control>}{End}{/Control}');
    expect(focused()).toBe(cell(4, 2));
    await user.keyboard('{Control>}{Home}{/Control}');
    expect(focused()).toBe(cell(0, 0));
  });

  it('selects a rectangle with Shift and the arrows', async () => {
    const user = userEvent.setup();
    mount();
    await focusGrid(user);
    await user.keyboard('{ArrowRight}{Shift>}{ArrowDown}{ArrowDown}{ArrowRight}{/Shift}');
    const selected = within(grid())
      .getAllByRole('gridcell')
      .filter((c) => c.getAttribute('aria-selected') === 'true');
    expect(selected).toEqual([cell(0, 1), cell(0, 2), cell(1, 1), cell(1, 2), cell(2, 1), cell(2, 2)]);
    expect(focused()).toBe(cell(2, 2));
    // A plain move collapses the selection to the active cell.
    await user.keyboard('{ArrowLeft}');
    expect(
      within(grid())
        .getAllByRole('gridcell')
        .filter((c) => c.getAttribute('aria-selected') === 'true'),
    ).toEqual([cell(2, 1)]);
  });
});

describe('EditableGrid — editing', () => {
  it('edits with Enter, commits with Enter and moves down', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ initial: { 'alpha|q1': '5' }, onChange });
    await focusGrid(user);
    await user.keyboard('{Enter}');
    const editor = within(cell(0, 0)).getByRole('textbox', { name: 'Alpha, From 1' });
    expect(focused()).toBe(editor);
    expect(editor).toHaveValue('5');
    await user.keyboard('0{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([{ rowKey: 'alpha', columnKey: 'q1', text: '50' }], 'edit');
    expect(screen.getByTestId('v-alpha|q1')).toHaveTextContent('50');
    expect(focused()).toBe(cell(1, 0));
  });

  it('edits with F2, and Escape cancels without a change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ initial: { 'alpha|q1': '5' }, onChange });
    await focusGrid(user);
    await user.keyboard('{F2}9{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(focused()).toBe(cell(0, 0));
    expect(screen.getByTestId('v-alpha|q1')).toHaveTextContent('5');
  });

  it('starts an edit with the typed character, replacing the text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ initial: { 'alpha|q1': '5' }, onChange });
    await focusGrid(user);
    await user.keyboard('7');
    expect(within(cell(0, 0)).getByRole('textbox')).toHaveValue('7');
    await user.keyboard('{Tab}');
    // Tab commits and moves right inside the grid while editing.
    expect(onChange).toHaveBeenCalledWith([{ rowKey: 'alpha', columnKey: 'q1', text: '7' }], 'edit');
    expect(focused()).toBe(cell(0, 1));
    await user.keyboard('3{Shift>}{Tab}{/Shift}');
    expect(onChange).toHaveBeenLastCalledWith([{ rowKey: 'alpha', columnKey: 'q10', text: '3' }], 'edit');
    expect(focused()).toBe(cell(0, 0));
  });

  it('reports nothing for an edit that changes nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ initial: { 'alpha|q1': '5' }, onChange });
    await focusGrid(user);
    await user.keyboard('{Enter}{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses to edit a read-only line, and says so', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ onChange });
    await focusGrid(user);
    await user.keyboard('{Control>}{End}{/Control}{Home}{Enter}8');
    expect(within(cell(4, 0)).queryByRole('textbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent('This cell cannot be changed.');
  });

  it('a read-only grid navigates and copies but never edits', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ readOnly: true, onChange, initial: { 'alpha|q1': '1' } });
    await focusGrid(user);
    await user.keyboard('{Enter}5{Delete}');
    await user.paste('9');
    expect(onChange).not.toHaveBeenCalled();
    expect(within(grid()).queryByRole('textbox')).toBeNull();
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe(cell(0, 1));
  });
});

describe('EditableGrid — clipboard, fill, clear and history', () => {
  it('copies the selection as tab-separated text', async () => {
    const user = userEvent.setup();
    mount({ initial: { 'alpha|q1': '1', 'alpha|q10': '2', 'bravo|q1': '3', 'bravo|q10': '' } });
    await focusGrid(user);
    await user.keyboard('{Shift>}{ArrowRight}{ArrowDown}{/Shift}');
    // A browser fires `copy` on Ctrl/⌘+C with no text selected; `user-event`
    // dispatches it only over a text selection, so the event is fired here.
    const setData = vi.fn();
    const event = createEvent.copy(focused()!, { clipboardData: { setData, getData: () => '' } });
    fireEvent(focused()!, event);
    expect(setData).toHaveBeenCalledWith('text/plain', '1\t2\r\n3\t');
    expect(event.defaultPrevented).toBe(true);
  });

  it('pastes a block from the active cell as one change group, and announces it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ onChange });
    await focusGrid(user);
    await user.keyboard('{ArrowRight}');
    await user.paste('1\t2\r\n3\t4\r\n');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      [
        { rowKey: 'alpha', columnKey: 'q10', text: '1' },
        { rowKey: 'alpha', columnKey: 'q100', text: '2' },
        { rowKey: 'bravo', columnKey: 'q10', text: '3' },
        { rowKey: 'bravo', columnKey: 'q100', text: '4' },
      ],
      'paste',
    );
    expect(status()).toHaveTextContent('Cells pasted: 4.');
    // The pasted block is selected, so it can be copied or cleared at once.
    expect(cell(1, 2)).toHaveAttribute('aria-selected', 'true');
  });

  it('reads a semicolon-separated block and quoted spreadsheet cells', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ onChange });
    await focusGrid(user);
    await user.paste('1,5;2');
    expect(onChange).toHaveBeenLastCalledWith(
      [
        { rowKey: 'alpha', columnKey: 'q1', text: '1,5' },
        { rowKey: 'alpha', columnKey: 'q10', text: '2' },
      ],
      'paste',
    );
    await user.paste('"a\tb"\tc');
    expect(onChange).toHaveBeenLastCalledWith(
      [
        { rowKey: 'alpha', columnKey: 'q1', text: 'a\tb' },
        { rowKey: 'alpha', columnKey: 'q10', text: 'c' },
      ],
      'paste',
    );
  });

  it('clips a block at the grid’s edge and skips read-only cells, saying how many', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ onChange });
    await focusGrid(user);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{End}');
    await user.paste('1\t2\n3\t4');
    // delta|q100 lands; delta's second column and all of echo do not.
    expect(onChange).toHaveBeenCalledWith([{ rowKey: 'delta', columnKey: 'q100', text: '1' }], 'paste');
    expect(status()).toHaveTextContent('Cells pasted: 1. Not pasted: 3, outside the grid or read-only.');
  });

  it('fills one value into a larger selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ onChange });
    await focusGrid(user);
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await user.paste('7');
    expect(onChange).toHaveBeenCalledWith(
      [
        { rowKey: 'alpha', columnKey: 'q1', text: '7' },
        { rowKey: 'bravo', columnKey: 'q1', text: '7' },
      ],
      'paste',
    );
  });

  it('fills down with Ctrl+D and with ⌘+D', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ onChange, initial: { 'alpha|q1': '1', 'alpha|q10': '2' } });
    await focusGrid(user);
    await user.keyboard('{Shift>}{ArrowRight}{ArrowDown}{ArrowDown}{/Shift}{Control>}d{/Control}');
    expect(onChange).toHaveBeenCalledWith(
      [
        { rowKey: 'bravo', columnKey: 'q1', text: '1' },
        { rowKey: 'bravo', columnKey: 'q10', text: '2' },
        { rowKey: 'charlie', columnKey: 'q1', text: '1' },
        { rowKey: 'charlie', columnKey: 'q10', text: '2' },
      ],
      'fill',
    );
    expect(status()).toHaveTextContent('Cells filled down: 4.');
    // ⌘ is Ctrl's twin on a Mac, for undo as for fill.
    await user.keyboard('{Meta>}z{/Meta}');
    expect(onChange).toHaveBeenLastCalledWith(expect.any(Array), 'undo');
    await user.keyboard('{Control>}{Home}{/Control}{Shift>}{ArrowDown}{/Shift}{Meta>}d{/Meta}');
    expect(onChange).toHaveBeenLastCalledWith([{ rowKey: 'bravo', columnKey: 'q1', text: '1' }], 'fill');
  });

  it('clears the selection with Delete', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ onChange, initial: { 'alpha|q1': '1', 'bravo|q1': '2' } });
    await focusGrid(user);
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}{Delete}');
    // Only cells holding text change; an empty cell is already clear.
    expect(onChange).toHaveBeenCalledWith(
      [
        { rowKey: 'alpha', columnKey: 'q1', text: '' },
        { rowKey: 'bravo', columnKey: 'q1', text: '' },
      ],
      'clear',
    );
    expect(status()).toHaveTextContent('Cells cleared: 2.');
  });

  it('undoes and redoes whole groups with Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount({ onChange, initial: { 'alpha|q1': 'old' } });
    await focusGrid(user);
    await user.paste('1\t2');
    expect(screen.getByTestId('v-alpha|q1')).toHaveTextContent('1');
    await user.keyboard('{Control>}z{/Control}');
    expect(onChange).toHaveBeenLastCalledWith(
      [
        { rowKey: 'alpha', columnKey: 'q1', text: 'old' },
        { rowKey: 'alpha', columnKey: 'q10', text: '' },
      ],
      'undo',
    );
    expect(screen.getByTestId('v-alpha|q1')).toHaveTextContent('old');
    expect(status()).toHaveTextContent('Undone. Cells changed: 2.');
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(onChange).toHaveBeenLastCalledWith(
      [
        { rowKey: 'alpha', columnKey: 'q1', text: '1' },
        { rowKey: 'alpha', columnKey: 'q10', text: '2' },
      ],
      'redo',
    );
    expect(status()).toHaveTextContent('Redone. Cells changed: 2.');
    await user.keyboard('{Control>}z{/Control}{Control>}y{/Control}');
    expect(screen.getByTestId('v-alpha|q10')).toHaveTextContent('2');
    // Nothing left to redo: said, not silently ignored.
    await user.keyboard('{Control>}y{/Control}');
    expect(status()).toHaveTextContent('Nothing to redo.');
  });

  it('records a change the caller applies as one undoable group', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const handleRef: { current: EditableGridHandle | null } = { current: null };
    mount({ onChange, handleRef, initial: { 'alpha|q1': '1' } });
    act(() => {
      handleRef.current!.apply(
        [
          { rowKey: 'alpha', columnKey: 'q1', text: '-5%' },
          { rowKey: 'bravo', columnKey: 'q1', text: '-5%' },
        ],
        'edit',
      );
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.any(Array), 'edit');
    await focusGrid(user);
    await user.keyboard('{Control>}z{/Control}');
    expect(onChange).toHaveBeenLastCalledWith(
      [
        { rowKey: 'alpha', columnKey: 'q1', text: '1' },
        { rowKey: 'bravo', columnKey: 'q1', text: '' },
      ],
      'undo',
    );
  });
});

describe('EditableGrid — errors and accessibility', () => {
  it('marks an invalid cell and links it to its reason', () => {
    mount({ errors: { 'bravo|q10': 'Write +20% or −20%.' }, initial: { 'bravo|q10': '20%' } });
    const invalid = cell(1, 1);
    expect(invalid).toHaveAttribute('aria-invalid', 'true');
    const describedBy = invalid.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Write +20% or −20%.');
    expect(cell(0, 0)).not.toHaveAttribute('aria-invalid');
  });

  it('has no axe violations, with a selection, an error and an open editor', async () => {
    const user = userEvent.setup();
    const { container } = mount({ errors: { 'bravo|q10': 'Not a number.' }, initial: { 'bravo|q10': 'x' } });
    await focusGrid(user);
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await expectNoAxeViolations(container);
    await user.keyboard('{Enter}');
    await expectNoAxeViolations(container);
  });

  it('speaks Polish from the same bundle', async () => {
    const user = userEvent.setup();
    mount({}, 'pl');
    await focusGrid(user);
    await user.paste('1\t2');
    expect(status()).toHaveTextContent('Wklejono komórki: 2.');
  });
});

describe('EditableGrid — render budget (SC-004 proxy, R4)', () => {
  it('re-renders only the edited cell while typing, and only two cells on a move', async () => {
    const user = userEvent.setup();
    const renders = new Map<string, number>();
    const renderSpy = (key: string): void => {
      renders.set(key, (renders.get(key) ?? 0) + 1);
    };
    mount({ renderSpy, initial: { 'alpha|q1': '1', 'charlie|q100': '9' } });
    await focusGrid(user);

    renders.clear();
    await user.keyboard('{ArrowDown}');
    // The cell focus left and the cell it reached; nothing else.
    expect([...renders.keys()].sort()).toEqual(['alpha|q1', 'bravo|q1']);

    await user.keyboard('{Enter}');
    renders.clear();
    await user.keyboard('12345');
    // Typing lives in the editor's own state: no other cell renders at all.
    expect([...renders.keys()]).toEqual([]);
    expect(within(cell(1, 0)).getByRole('textbox')).toHaveValue('12345');

    renders.clear();
    await user.keyboard('{Enter}');
    // Committing renders the edited cell (its new text) and the cell focus
    // reaches; the caller's state change re-renders no unchanged cell.
    expect([...renders.keys()].sort()).toEqual(['bravo|q1', 'charlie|q1']);
  });
});

describe('EditableGrid — caller tokens (161 Phase 5)', () => {
  it('re-renders a cell whose token changed, and no other, when its text did not change', () => {
    // A caller whose cell shows more than its text — the price grid shows what
    // an empty cell inherits from its neighbour — says so with a token, so the
    // memoised cell renders again exactly when that changes.
    const renders = new Map<string, number>();
    const renderSpy = (key: string): void => {
      renders.set(key, (renders.get(key) ?? 0) + 1);
    };
    const bundle = coreBundle('en');
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <TranslationProvider language="en" initialBundle={bundle}>
        <>{children}</>
      </TranslationProvider>
    );
    const { rerender } = render(<Harness renderSpy={renderSpy} tokens={{ 'alpha|q10': 'a' }} />, { wrapper });
    renders.clear();
    rerender(<Harness renderSpy={renderSpy} tokens={{ 'alpha|q10': 'b' }} />);
    expect([...renders.keys()]).toEqual(['alpha|q10']);
  });
});
