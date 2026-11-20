import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from 'lucide-react';
import { LINE_GROUP_LIMITS } from '@endora-commerce/contracts';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.js';
import { cn } from '../../lib/utils.js';
import { COARSE_POINTER_ICON_HIT_AREA, RowActionMenu, RowActionMenuItem } from '../RowActionMenu.js';
import { ReorderAnnouncer } from '../reorder/ReorderAnnouncer.js';
import { useGroupedReorder, type GroupedReorderLabels } from '../reorder/useGroupedReorder.js';

/**
 * Named, ordered groups of a document's lines — the editor (feature 159,
 * research R-21, `specs/159-quote-request-item-groups/contracts/ui.md` §1.2).
 *
 * Domain-free: it knows no quote and no order. Lines arrive in display order
 * with a `key` and a `groupKey` (`null` = ungrouped); every visible string and
 * every announcement is a prop; each line's cells (`renderLine`) and each
 * section's summary (`renderSummary`) are the caller's, so every surface keeps
 * its own totals rule (research R-15).
 *
 * With no group the editor renders the bare line list — the screen looks as it
 * did before the feature (D1, FR-033). Lines move by pointer drag, by keyboard
 * on their handle, and through a *Move to group* menu (the WCAG 2.5.7
 * single-pointer alternative); groups move by their handle and by *Move up /
 * Move down*. Deleting a group asks nothing: no line is lost — they move to
 * *Ungrouped* — and the live region says so (forgiveness over confirmation).
 */

export interface LineGroupsEditorGroup {
  /** Stable for the editing session; the caller maps it to a stored id. */
  key: string;
  name: string;
}

export interface LineGroupsEditorLine {
  key: string;
  /** `null` = ungrouped. A key naming no group reads as ungrouped. */
  groupKey: string | null;
}

export interface LineGroupsEditorSection {
  kind: 'group' | 'ungrouped';
  /** The group's key; `null` for the ungrouped section. */
  key: string | null;
  /** The group's name; `null` for the ungrouped section. */
  name: string | null;
}

export interface LineGroupsEditorLabels {
  addGroup: string;
  groupName: string;
  groupNamePlaceholder: string;
  nameRequired: string;
  deleteGroup: (context: { name: string }) => string;
  deletedAnnouncement: (context: { name: string }) => string;
  ungrouped: string;
  emptyGroup: string;
  /** The *Move to group* menu trigger's accessible name for one line. */
  moveToGroup: (context: { name: string }) => string;
  moveGroupUp: (context: { name: string }) => string;
  moveGroupDown: (context: { name: string }) => string;
  limitReached: (context: { max: number }) => string;
  /** Keyboard instructions every handle points at. */
  instructions?: string;
  reorder: GroupedReorderLabels;
}

export interface LineGroupsEditorLineSlots {
  /** The line's drag handle; `null` when the line cannot move (read-only, no group). */
  handle: ReactNode;
  /** The line's *Move to group* menu; `null` when there is nowhere to move it. */
  moveMenu: ReactNode;
}

export interface LineGroupsEditorProps<TLine extends LineGroupsEditorLine> {
  /** In display order; the ungrouped section is implicit and always last. */
  groups: readonly LineGroupsEditorGroup[];
  /** In display order. */
  lines: readonly TLine[];
  /** The whole next state; `lines` in the new display order. */
  onChange: (next: { groups: LineGroupsEditorGroup[]; lines: TLine[] }) => void;
  getLineLabel: (line: TLine) => string;
  renderLine: (line: TLine, slots: LineGroupsEditorLineSlots) => ReactNode;
  /** A section's summary, from its own lines. Not called for the bare list. */
  renderSummary?: (lines: readonly TLine[], section: LineGroupsEditorSection) => ReactNode;
  /** Below a section's lines while editing — e.g. a per-group *Add product*. */
  renderSectionFooter?: (section: LineGroupsEditorSection) => ReactNode;
  /** Headings and summaries only: no handle, menu, input or button; empty groups hidden. */
  readOnly?: boolean;
  /** Every control off, e.g. while saving. */
  disabled?: boolean;
  maxGroups?: number;
  /**
   * `list` (default): each section a region of line blocks. `table`: one table
   * — the caller's header, a row group per section headed by its controls, and
   * `renderLine` returns the line's **cells**, wrapped here in a row.
   */
  layout?: 'list' | 'table';
  /** Table layout: the header row (`<tr>` with its `<th>`s). */
  tableHeader?: ReactNode;
  /** Table layout: the number of cells `renderLine` returns, for the spanning rows. */
  columnCount?: number;
  /** A fresh key for a new group. Defaults to a counter. */
  createGroupKey?: () => string;
  labels: LineGroupsEditorLabels;
  className?: string;
}

const UNGROUPED = '__ungrouped__';

interface Section<TLine> extends LineGroupsEditorSection {
  /** The reorder model's key. */
  modelKey: string;
  lines: TLine[];
}

function sectionsOf<TLine extends LineGroupsEditorLine>(
  groups: readonly LineGroupsEditorGroup[],
  lines: readonly TLine[],
): Section<TLine>[] {
  const known = new Set(groups.map((group) => group.key));
  const grouped: Section<TLine>[] = groups.map((group) => ({
    kind: 'group',
    key: group.key,
    name: group.name,
    modelKey: group.key,
    lines: lines.filter((line) => line.groupKey === group.key),
  }));
  const ungrouped: Section<TLine> = {
    kind: 'ungrouped',
    key: null,
    name: null,
    modelKey: UNGROUPED,
    lines: lines.filter((line) => line.groupKey === null || !known.has(line.groupKey)),
  };
  return [...grouped, ungrouped];
}

/** Flatten sections back to the display order, each line carrying its section's key. */
function flatten<TLine extends LineGroupsEditorLine>(sections: readonly Section<TLine>[]): TLine[] {
  return sections.flatMap((section) =>
    section.lines.map((line) => (line.groupKey === section.key ? line : { ...line, groupKey: section.key })),
  );
}

export function LineGroupsEditor<TLine extends LineGroupsEditorLine>(
  props: LineGroupsEditorProps<TLine>,
): ReactNode {
  const {
    groups,
    lines,
    onChange,
    getLineLabel,
    renderLine,
    renderSummary,
    renderSectionFooter,
    readOnly = false,
    disabled = false,
    maxGroups = LINE_GROUP_LIMITS.maxGroups,
    labels,
    className,
  } = props;
  const baseId = useId();
  const instructionsId = `${baseId}-instructions`;
  const limitId = `${baseId}-limit`;
  const counter = useRef(0);
  const createGroupKey = props.createGroupKey ?? ((): string => `group-${(counter.current += 1)}`);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const nameRefs = useRef(new Map<string, HTMLInputElement | null>());

  const sections = useMemo(() => sectionsOf(groups, lines), [groups, lines]);
  const lineByKey = useMemo(() => new Map(lines.map((line) => [line.key, line])), [lines]);
  const grouped = groups.length > 0;

  const commit = (next: Section<TLine>[]): void => {
    onChange({
      groups: next.filter((section) => section.kind === 'group').map((section) => ({ key: section.key!, name: section.name! })),
      lines: flatten(next),
    });
  };

  const reorder = useGroupedReorder({
    model: {
      sections: sections.map((section) => ({
        key: section.modelKey,
        fixed: section.kind === 'ungrouped',
        itemIds: section.lines.map((line) => line.key),
      })),
    },
    getItemLabel: (key) => {
      const line = lineByKey.get(key);
      return line ? getLineLabel(line) : key;
    },
    getSectionLabel: (key) =>
      key === UNGROUPED ? labels.ungrouped : (sections.find((section) => section.modelKey === key)?.name ?? '') || labels.groupName,
    onMoveItem: (id, toSectionKey, toIndex) => {
      const line = lineByKey.get(id);
      if (!line) return;
      const next = sections.map((section) => ({ ...section, lines: section.lines.filter((l) => l.key !== id) }));
      const target = next.find((section) => section.modelKey === toSectionKey);
      if (!target) return;
      target.lines.splice(toIndex, 0, line);
      commit(next);
    },
    onMoveSection: (key, toIndex) => {
      const groupSections = sections.filter((section) => section.kind === 'group');
      const from = groupSections.findIndex((section) => section.modelKey === key);
      if (from < 0) return;
      const [moved] = groupSections.splice(from, 1);
      groupSections.splice(toIndex, 0, moved!);
      commit([...groupSections, sections[sections.length - 1]!]);
    },
    labels: labels.reorder,
    disabled: disabled || readOnly,
    instructionsId,
  });

  // Focus a group's name field once it exists (after *Add group*).
  useEffect(() => {
    if (focusKey === null) return;
    const input = nameRefs.current.get(focusKey);
    if (input) {
      input.focus();
      setFocusKey(null);
    }
  }, [focusKey, groups]);

  const addGroup = (): void => {
    const key = createGroupKey();
    onChange({ groups: [...groups.map((group) => ({ ...group })), { key, name: '' }], lines: [...lines] });
    setFocusKey(key);
  };

  const renameGroup = (key: string, name: string): void => {
    onChange({
      groups: groups.map((group) => (group.key === key ? { ...group, name } : { ...group })),
      lines: [...lines],
    });
  };

  const deleteGroup = (key: string): void => {
    const deleted = sections.find((section) => section.key === key);
    if (!deleted) return;
    const rest = sections.filter((section) => section.key !== key);
    const ungrouped = rest[rest.length - 1]!;
    // Nothing is lost: the lines join the ungrouped section, in their order.
    rest[rest.length - 1] = { ...ungrouped, lines: [...ungrouped.lines, ...deleted.lines] };
    commit(rest);
    reorder.announce(labels.deletedAnnouncement({ name: deleted.name || labels.groupName }));
  };

  const tableLayout = props.layout === 'table';
  const columnCount = props.columnCount ?? 1;
  const addGroupButton = readOnly ? null : (
    <AddGroupButton
      label={labels.addGroup}
      onClick={addGroup}
      disabled={disabled || groups.length >= maxGroups}
      limitId={limitId}
      limitText={groups.length >= maxGroups ? labels.limitReached({ max: maxGroups }) : null}
    />
  );

  if (!grouped) {
    const bare = lines.map((line) =>
      tableLayout ? (
        <TableRow key={line.key}>{renderLine(line, { handle: null, moveMenu: null })}</TableRow>
      ) : (
        <div key={line.key}>{renderLine(line, { handle: null, moveMenu: null })}</div>
      ),
    );
    return (
      <div className={cn('space-y-2', className)}>
        <ReorderAnnouncer message={reorder.announcement} />
        {tableLayout ? (
          <Table>
            {props.tableHeader ? <TableHeader>{props.tableHeader}</TableHeader> : null}
            <TableBody>{bare}</TableBody>
          </Table>
        ) : (
          bare
        )}
        {addGroupButton}
      </div>
    );
  }

  const visible = readOnly
    ? sections.filter((section) => section.lines.length > 0)
    : sections;
  const groupCount = sections.length - 1;

  /** A section's heading: the group's controls while editing, its name otherwise. */
  const sectionHeading = (section: Section<TLine>): ReactNode => {
    const groupIndex = sections.indexOf(section);
    const displayName = section.kind === 'group' ? section.name || labels.groupName : labels.ungrouped;
    if (section.kind !== 'group' || readOnly) {
      return tableLayout ? displayName : <h3 className="text-sm font-semibold">{displayName}</h3>;
    }
    const nameInvalid = section.name!.trim() === '' && touched.has(section.key!);
    const errorId = `${baseId}-error-${section.modelKey}`;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          {...reorder.getSectionHandleProps(section.modelKey)}
          className="inline-flex h-8 w-6 cursor-grab items-center justify-center rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
        <div className="min-w-48 flex-1 space-y-1">
          <Input
            ref={(element): void => {
              nameRefs.current.set(section.key!, element);
            }}
            aria-label={labels.groupName}
            placeholder={labels.groupNamePlaceholder}
            required
            maxLength={LINE_GROUP_LIMITS.maxNameLength}
            value={section.name!}
            disabled={disabled}
            aria-invalid={nameInvalid ? true : undefined}
            aria-describedby={nameInvalid ? errorId : undefined}
            onChange={(event): void => renameGroup(section.key!, event.target.value)}
            onBlur={(): void => setTouched((current) => new Set([...current, section.key!]))}
            className="font-medium"
          />
          {nameInvalid ? (
            <p id={errorId} className="text-xs font-normal text-destructive">
              {labels.nameRequired}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', COARSE_POINTER_ICON_HIT_AREA)}
          aria-label={labels.moveGroupUp({ name: displayName })}
          disabled={disabled || groupIndex === 0}
          onClick={(): void => reorder.moveSectionBy(section.modelKey, -1)}
        >
          <ChevronUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', COARSE_POINTER_ICON_HIT_AREA)}
          aria-label={labels.moveGroupDown({ name: displayName })}
          disabled={disabled || groupIndex === groupCount - 1}
          onClick={(): void => reorder.moveSectionBy(section.modelKey, 1)}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 text-destructive', COARSE_POINTER_ICON_HIT_AREA)}
          aria-label={labels.deleteGroup({ name: displayName })}
          disabled={disabled}
          onClick={(): void => deleteGroup(section.key!)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    );
  };

  /** A line's handle and *Move to group* menu, while editing. */
  const lineSlots = (section: Section<TLine>, line: TLine): LineGroupsEditorLineSlots => {
    if (readOnly) return { handle: null, moveMenu: null };
    const name = getLineLabel(line);
    const targets = sections.filter((candidate) => candidate !== section);
    return {
      handle: (
        <button
          {...reorder.getItemHandleProps(line.key)}
          className="inline-flex h-8 w-6 cursor-grab items-center justify-center rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      ),
      moveMenu: (
        <RowActionMenu label={labels.moveToGroup({ name })} disabled={disabled}>
          {targets.map((target) => (
            <RowActionMenuItem key={target.modelKey} onSelect={(): void => reorder.moveItemTo(line.key, target.modelKey)}>
              {target.kind === 'group' ? target.name || labels.groupName : labels.ungrouped}
            </RowActionMenuItem>
          ))}
        </RowActionMenu>
      ),
    };
  };

  /** Whether a pointer drag is over this section's drop area. */
  const isSectionTarget = (section: Section<TLine>): boolean => reorder.dropTarget === `section:${section.modelKey}`;

  const displayNameOf = (section: Section<TLine>): string =>
    section.kind === 'group' ? section.name || labels.groupName : labels.ungrouped;

  if (tableLayout) {
    return (
      <div className={cn('space-y-2', className)}>
        <ReorderAnnouncer
          message={reorder.announcement}
          {...(labels.instructions !== undefined && !readOnly ? { instructions: labels.instructions, instructionsId } : {})}
        />
        <Table>
          {props.tableHeader ? <TableHeader>{props.tableHeader}</TableHeader> : null}
          {visible.map((section) => (
            <TableBody
              key={section.modelKey}
              aria-label={displayNameOf(section)}
              className={cn(isSectionTarget(section) && 'outline outline-2 outline-ring')}
              {...(readOnly ? {} : reorder.getSectionProps(section.modelKey))}
            >
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead colSpan={columnCount} scope="colgroup" className="h-auto py-2 text-foreground">
                  {sectionHeading(section)}
                </TableHead>
              </TableRow>
              {section.lines.length === 0 ? (
                readOnly ? null : (
                  <TableRow>
                    <TableCell colSpan={columnCount} className="text-center text-xs text-muted-foreground">
                      {labels.emptyGroup}
                    </TableCell>
                  </TableRow>
                )
              ) : (
                section.lines.map((line) => (
                  <TableRow
                    key={line.key}
                    {...(readOnly ? {} : reorder.getItemProps(line.key))}
                    className={cn(reorder.dropTarget === line.key && 'border-t-2 border-t-ring')}
                  >
                    {renderLine(line, lineSlots(section, line))}
                  </TableRow>
                ))
              )}
              {renderSummary ? (
                <TableRow>
                  <TableCell colSpan={columnCount}>{renderSummary(section.lines, toPublic(section))}</TableCell>
                </TableRow>
              ) : null}
              {!readOnly && renderSectionFooter ? (
                <TableRow>
                  <TableCell colSpan={columnCount}>{renderSectionFooter(toPublic(section))}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          ))}
        </Table>
        {addGroupButton}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <ReorderAnnouncer
        message={reorder.announcement}
        {...(labels.instructions !== undefined && !readOnly ? { instructions: labels.instructions, instructionsId } : {})}
      />
      {visible.map((section) => (
        <section
          key={section.modelKey}
          aria-label={displayNameOf(section)}
          className={cn(
            'rounded-md border p-3',
            section.kind === 'ungrouped' && 'border-dashed',
            isSectionTarget(section) && 'ring-2 ring-ring',
          )}
          {...(readOnly ? {} : reorder.getSectionProps(section.modelKey))}
        >
          <div className="mb-2">{sectionHeading(section)}</div>
          {section.lines.length === 0 ? (
            readOnly ? null : (
              <p className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
                {labels.emptyGroup}
              </p>
            )
          ) : (
            <div className="space-y-2">
              {section.lines.map((line) => (
                <div
                  key={line.key}
                  {...(readOnly ? {} : reorder.getItemProps(line.key))}
                  className={cn(reorder.dropTarget === line.key && 'border-t-2 border-ring')}
                >
                  {renderLine(line, lineSlots(section, line))}
                </div>
              ))}
            </div>
          )}
          {renderSummary ? <div className="mt-2">{renderSummary(section.lines, toPublic(section))}</div> : null}
          {!readOnly && renderSectionFooter ? <div className="mt-2">{renderSectionFooter(toPublic(section))}</div> : null}
        </section>
      ))}
      {addGroupButton}
    </div>
  );
}

function toPublic(section: LineGroupsEditorSection): LineGroupsEditorSection {
  return { kind: section.kind, key: section.key, name: section.name };
}

function AddGroupButton(props: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  limitId: string;
  limitText: string | null;
}): ReactNode {
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-describedby={props.limitText !== null ? props.limitId : undefined}
      >
        {props.label}
      </Button>
      {props.limitText !== null ? (
        <p id={props.limitId} className="text-xs text-muted-foreground">
          {props.limitText}
        </p>
      ) : null}
    </div>
  );
}
