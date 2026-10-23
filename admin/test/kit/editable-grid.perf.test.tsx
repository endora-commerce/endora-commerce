import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import { EditableGrid, type EditableGridRenderContext } from '@endora-commerce/admin-kit/components';

/**
 * The editable grid at the price grid's largest page (feature 161, T099;
 * FR-036, SC-004): 200 lines × 6 tier columns, 1 200 cells. The render
 * budget of T039 holds at that size — typing re-renders no cell at all, a
 * focus move re-renders the two cells it touches, a commit the edited cell
 * and the one focus reaches — so the cost of a keystroke does not grow with
 * the page. These are counts, not timings: deterministic on any machine. The
 * wall-clock of a 5 000-row save is `quickstart.md` §3's manual measurement.
 */

const REPO_ROOT = resolve(process.cwd(), '..');
const bundle = { core: JSON.parse(readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n/en.json'), 'utf8')) as Record<string, string> };

const COLUMNS = [1, 10, 25, 50, 100, 250].map((start) => ({ key: `q${start}`, label: `From ${start}` }));
const ROWS = Array.from({ length: 200 }, (_, i) => ({ key: `line${i}`, label: `Line ${i}` }));

function Harness(props: { readonly onRender: (key: string) => void }): ReactNode {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const { onRender } = props;
  const renderCell = useCallback(
    (ctx: EditableGridRenderContext): ReactNode => {
      onRender(`${ctx.rowKey}|${ctx.columnKey}`);
      return <span>{ctx.text}</span>;
    },
    [onRender],
  );
  return (
    <>
      <button type="button">before</button>
      <EditableGrid
        label="Prices"
        rowHeaderLabel="Line"
        columns={COLUMNS}
        rows={ROWS}
        getText={(rowKey, columnKey) => texts[`${rowKey}|${columnKey}`] ?? ''}
        renderCell={renderCell}
        onChange={(changes) =>
          setTexts((current) => {
            const next = { ...current };
            for (const change of changes) next[`${change.rowKey}|${change.columnKey}`] = change.text;
            return next;
          })
        }
      />
    </>
  );
}

describe('EditableGrid — render budget at 200 lines × 6 columns (161 T099)', () => {
  it('renders every cell once on mount, then a bounded set per interaction', async () => {
    const user = userEvent.setup();
    const renders = new Map<string, number>();
    const onRender = (key: string): void => {
      renders.set(key, (renders.get(key) ?? 0) + 1);
    };
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <TranslationProvider language="en" initialBundle={bundle}>
        <>{children}</>
      </TranslationProvider>
    );
    render(<Harness onRender={onRender} />, { wrapper });
    expect(renders.size).toBe(1200);
    expect(Math.max(...renders.values())).toBe(1);

    screen.getByRole('button', { name: 'before' }).focus();
    await user.tab();
    renders.clear();
    await user.keyboard('{ArrowRight}');
    expect([...renders.keys()].sort()).toEqual(['line0|q1', 'line0|q10']);

    renders.clear();
    await user.keyboard('{PageDown}');
    // A page step moves focus across many rows and re-renders the two ends only.
    expect(renders.size).toBe(2);

    await user.keyboard('{Enter}');
    renders.clear();
    await user.keyboard('1234,5');
    expect(renders.size).toBe(0);
    const textbox = within(screen.getByRole('grid')).getByRole('textbox');
    expect(textbox).toHaveValue('1234,5');

    renders.clear();
    await user.keyboard('{Enter}');
    expect(renders.size).toBe(2);
  });
});
