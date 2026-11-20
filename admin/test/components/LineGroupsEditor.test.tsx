import { StrictMode, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LineGroupsEditor,
  type GroupedReorderLabels,
  type LineGroupsEditorGroup,
  type LineGroupsEditorLabels,
} from '@endora-commerce/admin-kit/components';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Feature 159, T019 — the domain-free grouping editor
 * (`specs/159-quote-request-item-groups/contracts/ui.md` §1.2). It knows no
 * quote and no order: lines arrive with a `key` and a `groupKey`, every string
 * is a prop, and each line's cells and each section's summary are the
 * caller's.
 */

interface Line {
  key: string;
  groupKey: string | null;
  name: string;
}

const REORDER: GroupedReorderLabels = {
  itemGrabbed: (c) => `Grabbed ${c.name}`,
  itemMoved: (c) => `${c.name} moved to ${c.section}, ${c.index} of ${c.total}`,
  itemDropped: (c) => `${c.name} dropped`,
  itemCancelled: (c) => `${c.name} back`,
  groupGrabbed: (c) => `Grabbed group ${c.name}`,
  groupMoved: (c) => `Group ${c.name} moved to ${c.index} of ${c.total}`,
  groupDropped: (c) => `Group ${c.name} dropped`,
  groupCancelled: (c) => `Group ${c.name} back`,
  atStart: (c) => `${c.name} is first`,
  atEnd: (c) => `${c.name} is last`,
  itemHandle: (c) => `Drag ${c.name}`,
  groupHandle: (c) => `Drag group ${c.name}`,
};

const LABELS: LineGroupsEditorLabels = {
  addGroup: 'Add group',
  groupName: 'Group name',
  groupNamePlaceholder: 'e.g. Ground floor',
  nameRequired: 'Enter a group name.',
  deleteGroup: (c) => `Delete group ${c.name}`,
  deletedAnnouncement: (c) => `Group ${c.name} deleted. Its lines moved to Ungrouped.`,
  ungrouped: 'Ungrouped',
  emptyGroup: 'Drag lines here or use Move to group.',
  moveToGroup: (c) => `Move ${c.name} to group`,
  moveGroupUp: (c) => `Move group ${c.name} up`,
  moveGroupDown: (c) => `Move group ${c.name} down`,
  limitReached: (c) => `A document can have at most ${c.max} groups.`,
  instructions: 'Press Space to lift a line, the arrow keys to move it, Space to drop it.',
  reorder: REORDER,
};

const LINES: Line[] = [
  { key: 'l1', groupKey: 'g1', name: 'Bolt' },
  { key: 'l2', groupKey: 'g1', name: 'Nut' },
  { key: 'l3', groupKey: null, name: 'Washer' },
];
const GROUPS: LineGroupsEditorGroup[] = [
  { key: 'g1', name: 'Ground floor' },
  { key: 'g2', name: 'Options' },
];

interface HarnessProps {
  groups?: LineGroupsEditorGroup[];
  lines?: Line[];
  readOnly?: boolean;
  maxGroups?: number;
  onChange?: (next: { groups: LineGroupsEditorGroup[]; lines: Line[] }) => void;
  renderSummary?: (lines: readonly Line[], section: { kind: 'group' | 'ungrouped'; name: string | null }) => ReactElement;
  dark?: boolean;
}

let nextKey = 0;

function Harness(props: HarnessProps): ReactElement {
  const [groups, setGroups] = useState(props.groups ?? GROUPS);
  const [lines, setLines] = useState(props.lines ?? LINES);
  return (
    <div className={props.dark ? 'dark' : undefined}>
      <LineGroupsEditor<Line>
        groups={groups}
        lines={lines}
        onChange={(next) => {
          props.onChange?.(next);
          setGroups(next.groups);
          setLines(next.lines);
        }}
        getLineLabel={(line) => line.name}
        createGroupKey={() => `new-${(nextKey += 1)}`}
        renderLine={(line, slots) => (
          <div data-testid={`line-${line.key}`}>
            {slots.handle}
            <span>{line.name}</span>
            {slots.moveMenu}
          </div>
        )}
        {...(props.renderSummary ? { renderSummary: props.renderSummary } : {})}
        {...(props.readOnly ? { readOnly: true } : {})}
        {...(props.maxGroups !== undefined ? { maxGroups: props.maxGroups } : {})}
        labels={LABELS}
      />
    </div>
  );
}

function renderEditor(props: HarnessProps = {}) {
  return render(
    <StrictMode>
      <Harness {...props} />
    </StrictMode>,
  );
}

const lineOrder = (): string[] =>
  screen.getAllByTestId(/^line-/).map((element) => element.getAttribute('data-testid')!.slice(5));

describe('LineGroupsEditor', () => {
  it('with no group renders the bare line list: no headings, no summaries', () => {
    const summary = vi.fn(() => <p>summary</p>);
    renderEditor({ groups: [], lines: LINES.map((line) => ({ ...line, groupKey: null })), renderSummary: summary });
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(lineOrder()).toEqual(['l1', 'l2', 'l3']);
    expect(summary).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add group' })).toBeEnabled();
  });

  it('renders groups in order, then Ungrouped last with no controls', () => {
    renderEditor();
    const sections = screen.getAllByRole('region');
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual(['Ground floor', 'Options', 'Ungrouped']);
    const ungrouped = sections[2]!;
    expect(within(ungrouped).getByRole('heading', { name: 'Ungrouped' })).toBeInTheDocument();
    expect(within(ungrouped).queryByRole('textbox')).toBeNull();
    expect(within(ungrouped).queryByRole('button', { name: /^(Delete group|Move group|Drag group)/ })).toBeNull();
    expect(lineOrder()).toEqual(['l1', 'l2', 'l3']);
  });

  it('Add group appends a group and focuses its name field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ onChange });
    await user.click(screen.getByRole('button', { name: 'Add group' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ groups: [...GROUPS, { key: expect.stringMatching(/^new-/), name: '' }] }),
    );
    const fields = screen.getAllByRole('textbox', { name: 'Group name' });
    expect(fields).toHaveLength(3);
    expect(document.activeElement).toBe(fields[2]);
  });

  it('renames a group and shows the error for an empty name once the field is left', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ onChange });
    const field = screen.getAllByRole('textbox', { name: 'Group name' })[1]!;
    await user.clear(field);
    await user.tab();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a group name.')).toBeInTheDocument();
    await user.type(field, 'Extras');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ groups: [GROUPS[0], { key: 'g2', name: 'Extras' }] }),
    );
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('deleting a group moves its lines to Ungrouped, in order, and says so', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ onChange });
    await user.click(screen.getByRole('button', { name: 'Delete group Ground floor' }));
    const last = onChange.mock.lastCall![0] as { groups: LineGroupsEditorGroup[]; lines: Line[] };
    expect(last.groups).toEqual([GROUPS[1]]);
    expect(last.lines.map((line) => [line.key, line.groupKey])).toEqual([
      ['l3', null],
      ['l1', null],
      ['l2', null],
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Group Ground floor deleted. Its lines moved to Ungrouped.');
  });

  it('an empty group shows the drop hint', () => {
    renderEditor();
    const options = screen.getByRole('region', { name: 'Options' });
    expect(within(options).getByText('Drag lines here or use Move to group.')).toBeInTheDocument();
  });

  it('Move to group lists every other section and moves the line to the end of the one chosen', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Move Washer to group' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Ground floor', 'Options']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Ground floor' }));
    expect(lineOrder()).toEqual(['l1', 'l2', 'l3']);
    const ground = screen.getByRole('region', { name: 'Ground floor' });
    expect(within(ground).getByTestId('line-l3')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Washer moved to Ground floor, 3 of 3');
  });

  it('moves groups with Move up / Move down; the first cannot go up, the last cannot go down', async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(screen.getByRole('button', { name: 'Move group Ground floor up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move group Options down' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move group Options up' }));
    expect(screen.getAllByRole('region').map((section) => section.getAttribute('aria-label'))).toEqual([
      'Options',
      'Ground floor',
      'Ungrouped',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Group Options moved to 1 of 2');
  });

  it('grows every 32 px icon control of a group heading to a 44 × 44 hit area on a coarse pointer (#1567)', () => {
    // jsdom lays nothing out: the rule is pinned by its classes (ux-laws §Fitts).
    renderEditor();
    for (const name of [
      'Move group Options up',
      'Move group Options down',
      'Delete group Options',
      'Move Washer to group',
    ]) {
      const cls = screen.getAllByRole('button', { name })[0]!.className;
      expect(cls, name).toContain('h-8');
      expect(cls, name).toContain('relative');
      expect(cls, name).toContain("pointer-coarse:before:content-['']");
      expect(cls, name).toContain('pointer-coarse:before:-inset-1.5');
    }
  });

  it('disables Add group at the limit and says why', () => {
    renderEditor({ maxGroups: 2 });
    const add = screen.getByRole('button', { name: 'Add group' });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription('A document can have at most 2 groups.');
  });

  it('read-only renders headings and summaries and no control at all', () => {
    renderEditor({ readOnly: true, renderSummary: (lines) => <p>{`${lines.length} items`}</p> });
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Ground floor', 'Ungrouped']);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.getByText('2 items')).toBeInTheDocument();
    expect(screen.getByText('1 items')).toBeInTheDocument();
  });

  it('hands renderSummary each section’s lines, empty groups included while editing', () => {
    const summary = vi.fn((_lines: readonly Line[], _section: { kind: 'group' | 'ungrouped'; name: string | null }) => <p>s</p>);
    renderEditor({ renderSummary: summary });
    const calls = summary.mock.calls.slice(-3);
    expect(calls.map(([lines, section]) => [section.name, lines.map((line) => line.key)])).toEqual([
      ['Ground floor', ['l1', 'l2']],
      ['Options', []],
      [null, ['l3']],
    ]);
  });

  it.each([false, true])('has no automated accessibility violation (dark: %s)', async (dark) => {
    const { container } = renderEditor({ dark });
    await expectNoAxeViolations(container);
  });

  it('has no automated accessibility violation read-only', async () => {
    const { container } = renderEditor({ readOnly: true });
    await expectNoAxeViolations(container);
  });

  describe('table layout (a screen whose lines are table rows)', () => {
    function TableHarness(props: { groups?: LineGroupsEditorGroup[]; lines?: Line[]; readOnly?: boolean }): ReactElement {
      const [groups, setGroups] = useState(props.groups ?? GROUPS);
      const [lines, setLines] = useState(props.lines ?? LINES);
      return (
        <LineGroupsEditor<Line>
          layout="table"
          columnCount={2}
          tableHeader={
            <tr>
              <th>Product</th>
              <th>Actions</th>
            </tr>
          }
          groups={groups}
          lines={lines}
          onChange={(next) => {
            setGroups(next.groups);
            setLines(next.lines);
          }}
          getLineLabel={(line) => line.name}
          renderLine={(line, slots) => (
            <>
              <td data-line-name>{line.name}</td>
              <td>
                {slots.handle}
                {slots.moveMenu}
              </td>
            </>
          )}
          renderSummary={(sectionLines) => <span>{`${sectionLines.length} lines`}</span>}
          {...(props.readOnly ? { readOnly: true } : {})}
          labels={LABELS}
        />
      );
    }

    it('renders one table: the caller’s header, a row group per section headed by its controls, lines as rows', async () => {
      const user = userEvent.setup();
      render(
        <StrictMode>
          <TableHarness />
        </StrictMode>,
      );
      const table = screen.getByRole('table');
      expect(within(table).getAllByRole('rowgroup').map((group) => group.getAttribute('aria-label'))).toEqual([
        null,
        'Ground floor',
        'Options',
        'Ungrouped',
      ]);
      expect(screen.getByText('Bolt', { selector: '[data-line-name]' }).closest('tr')).not.toBeNull();
      const ground = within(table).getByRole('rowgroup', { name: 'Ground floor' });
      expect(within(ground).getByRole('textbox', { name: 'Group name' })).toHaveValue('Ground floor');
      expect(within(ground).getByText('2 lines')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Move Washer to group' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Options' }));
      expect(within(within(table).getByRole('rowgroup', { name: 'Options' })).getByText('Washer')).toBeInTheDocument();
      await expectNoAxeViolations(document.body);
    });

    it('with no group it is the plain table: no section rows, no summary', () => {
      render(<TableHarness groups={[]} lines={LINES.map((line) => ({ ...line, groupKey: null }))} />);
      const table = screen.getByRole('table');
      expect(within(table).getAllByRole('row')).toHaveLength(4);
      expect(within(table).queryByText(/lines$/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Add group' })).toBeInTheDocument();
    });

    it('read-only: group names as headers, no control', () => {
      render(<TableHarness readOnly />);
      expect(screen.queryAllByRole('button')).toEqual([]);
      expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
        'Product',
        'Actions',
        'Ground floor',
        'Ungrouped',
      ]);
    });
  });
});
