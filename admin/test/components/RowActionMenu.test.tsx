import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResponsiveTable, type ResponsiveColumn } from '../../../packages/admin-shell/src/components/ResponsiveTable';
import {
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
} from '../../../packages/admin-shell/src/components/RowActionMenu';

/**
 * The defect this pins: a row menu positioned with `absolute` lives inside the
 * table, and `.b2b-table-scroll` sets `overflow-x: auto`. An overflow container
 * clips its absolutely-positioned descendants, so the menu was drawn inside the
 * table and cut off — exactly what the feeds list did.
 *
 * The fix is structural, not cosmetic: the menu content has to leave the
 * scrolling subtree entirely. Asserting *where in the DOM the panel lands* is
 * what makes the test survive a restyle — a snapshot of classes would not.
 */

interface Row {
  id: string;
  name: string;
}

const columns: ResponsiveColumn<Row>[] = [
  { id: 'name', header: 'Name', primary: true, render: (row) => row.name },
];

const rows: Row[] = [{ id: '1', name: 'Alpha' }];

function TableWithMenu(): React.ReactNode {
  return (
    <ResponsiveTable
      columns={columns}
      data={rows}
      keyExtractor={(r) => r.id}
      renderActions={() => (
        <RowActionMenu label="Row actions">
          <RowActionMenuItem onSelect={() => undefined}>Open</RowActionMenuItem>
          <RowActionMenuSeparator />
          <RowActionMenuItem destructive onSelect={() => undefined}>
            Delete
          </RowActionMenuItem>
        </RowActionMenu>
      )}
    />
  );
}

describe('RowActionMenu', () => {
  it('renders its panel outside the table’s overflow container', async () => {
    const user = userEvent.setup();
    const { container } = render(<TableWithMenu />);

    await user.click(screen.getByRole('button', { name: 'Row actions' }));

    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();

    // The panel must not be a descendant of the scrolling wrapper, or the
    // browser clips it however it is styled.
    const scroller = container.querySelector('.b2b-table-scroll');
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(menu)).toBe(false);

    // Nor of the table itself — a cell is a formatting context of its own.
    const table = container.querySelector('table');
    expect(table?.contains(menu) ?? false).toBe(false);
  });

  it('opens and closes from the keyboard, and marks the trigger’s state', async () => {
    const user = userEvent.setup();
    render(<TableWithMenu />);

    const trigger = screen.getByRole('button', { name: 'Row actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Escape returns focus to the trigger — the operator never loses their place.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('runs the item that was chosen, and only that one', async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    render(
      <RowActionMenu label="Row actions">
        <RowActionMenuItem onSelect={() => opened.push('open')}>Open</RowActionMenuItem>
        <RowActionMenuItem onSelect={() => opened.push('delete')} destructive>
          Delete
        </RowActionMenuItem>
      </RowActionMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    expect(opened).toEqual(['delete']);
  });

  it('never fires a disabled item', async () => {
    const user = userEvent.setup();
    let fired = false;
    render(
      <RowActionMenu label="Row actions">
        <RowActionMenuItem disabled onSelect={() => (fired = true)}>
          Delete
        </RowActionMenuItem>
      </RowActionMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    const item = await screen.findByRole('menuitem', { name: 'Delete' });
    await user.click(item);

    expect(fired).toBe(false);
  });
});
