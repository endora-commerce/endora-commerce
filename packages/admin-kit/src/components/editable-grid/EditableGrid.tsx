import {
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation.js';
import { cn } from '../../lib/utils.js';
import { ReorderAnnouncer } from '../reorder/ReorderAnnouncer.js';
import {
  inRect,
  moveFrom,
  clamp,
  parseClipboardBlock,
  rectOf,
  serializeClipboardBlock,
  type GridMove,
  type GridPosition,
  type GridRect,
} from './grid-model.js';

/**
 * An editable data grid — the admin kit's one spreadsheet-like primitive
 * (feature 161, `specs/161-price-book-editor/research.md` R4; FR-011, FR-031,
 * FR-036).
 *
 * **It knows nothing about what its cells hold.** Every cell is text: the
 * caller hands the grid each cell's text (`getText`), renders it
 * (`renderCell`), says which cells are wrong (`getError`) and receives every
 * change as a group of `{ rowKey, columnKey, text }` (`onChange`). Parsing and
 * meaning stay with the caller — the price-book editor parses prices — so the
 * grid can serve any tabular editor.
 *
 * **What it owns** is the interaction, built to the WAI-ARIA Authoring
 * Practices data-grid pattern: one tab stop with a roving `tabindex`; arrows,
 * Home/End, Ctrl+Home/End, PageUp/PageDown; Enter or F2 to edit, a printable
 * key to start an edit over the text, Enter/Tab/Shift+Tab to commit and move,
 * Escape to cancel; a rectangular selection with Shift; copy and paste of
 * tab-separated blocks (a spreadsheet's clipboard, or a semicolon line); fill
 * down (Ctrl/⌘+D); clear (Delete); an undo history of change groups
 * (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl/⌘+Y); per-cell `aria-invalid` linked to its
 * reason; and a polite live region, mounted empty, that says what a paste, a
 * fill, a clear or an undo did.
 *
 * **Render budget** (SC-004): a cell is memoised on its text, error and state;
 * an edit's draft lives in the editor's own state, so typing renders that cell
 * and nothing else, and a focus move renders the two cells it touches. Keep
 * `renderCell` stable (`useCallback`) or every cell renders on every change.
 *
 * **Not here**: virtualised scrolling (a page is at most a few hundred lines,
 * spec *Assumptions*), column resizing, sorting. Pages are the caller's;
 * `rowIndexOffset` and `totalRowCount` keep `aria-rowindex` and
 * `aria-rowcount` true to the whole set.
 */

export interface EditableGridColumn {
  readonly key: string;
  /** The column's name, read by assistive technology and used in the editor's label. */
  readonly label: string;
  /** Visible header content; defaults to `label`. */
  readonly header?: ReactNode;
}

export interface EditableGridRow {
  readonly key: string;
  readonly label: string;
  /** Visible row-header content; defaults to `label`. */
  readonly header?: ReactNode;
  /** Every cell of the row is read-only. */
  readonly readOnly?: boolean;
}

export interface EditableGridCellChange {
  readonly rowKey: string;
  readonly columnKey: string;
  /** The new text; `''` clears the cell. */
  readonly text: string;
}

export type EditableGridChangeReason = 'edit' | 'paste' | 'fill' | 'clear' | 'undo' | 'redo';

export interface EditableGridRenderContext {
  readonly rowKey: string;
  readonly columnKey: string;
  readonly text: string;
  readonly error: string | undefined;
  readonly readOnly: boolean;
}

export interface EditableGridSelection {
  /** The active cell. */
  readonly active: { readonly rowKey: string; readonly columnKey: string };
  /** Every selected cell, row by row. */
  readonly cells: readonly { readonly rowKey: string; readonly columnKey: string }[];
}

/** What a caller can do to the grid from outside it — a bulk action is one undoable group. */
export interface EditableGridHandle {
  /** Apply a group of changes as one undoable step; returns how many cells changed. */
  apply(changes: readonly EditableGridCellChange[], reason?: EditableGridChangeReason): number;
  /** Forget the undo history — after a save, for one. */
  clearHistory(): void;
  /** The current selection. */
  selection(): EditableGridSelection | null;
}

export interface EditableGridProps {
  /** The grid's accessible name. */
  readonly label: string;
  /** The text of the corner header above the row headers. */
  readonly rowHeaderLabel: string;
  readonly columns: readonly EditableGridColumn[];
  readonly rows: readonly EditableGridRow[];
  readonly getText: (rowKey: string, columnKey: string) => string;
  readonly getError?: (rowKey: string, columnKey: string) => string | undefined;
  readonly isReadOnly?: (rowKey: string, columnKey: string) => boolean;
  /**
   * A cell's memo token: a cell renders again when its text, error, state or
   * this token changes. A caller whose cell shows more than its own text (what
   * an empty cell inherits from a neighbour) puts that in the token; without
   * one a cell renders on its text alone.
   */
  readonly getCellToken?: (rowKey: string, columnKey: string) => string;
  /** A cell's content when it is not being edited; defaults to its text. Keep it stable. */
  readonly renderCell?: (context: EditableGridRenderContext) => ReactNode;
  readonly onChange: (changes: readonly EditableGridCellChange[], reason: EditableGridChangeReason) => void;
  readonly onSelectionChange?: (selection: EditableGridSelection) => void;
  /** Navigation and copy only: no edit, paste, fill, clear or undo. */
  readonly readOnly?: boolean;
  /** Lines in the whole set, when the grid shows one page of it (`aria-rowcount`). */
  readonly totalRowCount?: number;
  /** Lines before this page (`aria-rowindex`). */
  readonly rowIndexOffset?: number;
  /** Rows PageUp and PageDown move by. */
  readonly pageStep?: number;
  readonly className?: string;
  readonly ref?: Ref<EditableGridHandle>;
}

interface HistoryEntry {
  readonly rowKey: string;
  readonly columnKey: string;
  readonly before: string;
  readonly after: string;
}

/** Undo steps kept; the oldest go first. */
const HISTORY_LIMIT = 200;

type CommitMove = 'down' | 'right' | 'left' | 'none';

export function EditableGrid(props: EditableGridProps): ReactNode {
  const t = useTranslation('core');
  const {
    columns,
    rows,
    readOnly = false,
    totalRowCount,
    rowIndexOffset = 0,
  } = props;
  const instructionsId = useId();
  const baseId = useId();
  const [active, setActive] = useState<GridPosition>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<GridPosition>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<{ readonly initial: string } | null>(null);
  const [message, setMessage] = useState('');
  const history = useRef<{ undo: HistoryEntry[][]; redo: HistoryEntry[][] }>({ undo: [], redo: [] });
  const cellElements = useRef(new Map<string, HTMLTableCellElement>());
  const tableRef = useRef<HTMLTableElement | null>(null);
  const focusPending = useRef(false);
  const announceToggle = useRef(false);

  const rowCount = rows.length;
  const colCount = columns.length;
  const position = rowCount > 0 && colCount > 0 ? clamp(active, rowCount, colCount) : null;
  const anchorPosition = rowCount > 0 && colCount > 0 ? clamp(anchor, rowCount, colCount) : null;
  const selectionRect = position && anchorPosition ? rectOf(anchorPosition, position) : null;

  // Everything an event handler reads, current at the time it runs, so the
  // handlers below can be stable and the memoised cells are not re-rendered by
  // a new function identity.
  const latest = useRef({ props, position, selectionRect, editing });
  latest.current = { props, position, selectionRect, editing };

  const announce = useCallback((text: string): void => {
    // A repeated sentence is not re-announced unless the region's text changes.
    announceToggle.current = !announceToggle.current;
    setMessage(announceToggle.current ? text : `${text} `);
  }, []);

  const cellReadOnly = useCallback((row: number, col: number): boolean => {
    const { props: p } = latest.current;
    const r = p.rows[row];
    const c = p.columns[col];
    if (!r || !c) return true;
    return Boolean(p.readOnly || r.readOnly || p.isReadOnly?.(r.key, c.key));
  }, []);

  /** Apply `changes` as one group, recorded for undo unless it is an undo or redo itself. */
  const applyChanges = useCallback(
    (changes: readonly EditableGridCellChange[], reason: EditableGridChangeReason): number => {
      const { props: p } = latest.current;
      const entries: HistoryEntry[] = [];
      for (const change of changes) {
        const before = p.getText(change.rowKey, change.columnKey);
        if (before === change.text) continue;
        entries.push({ rowKey: change.rowKey, columnKey: change.columnKey, before, after: change.text });
      }
      if (entries.length === 0) return 0;
      if (reason !== 'undo' && reason !== 'redo') {
        history.current.undo.push(entries);
        if (history.current.undo.length > HISTORY_LIMIT) history.current.undo.shift();
        history.current.redo = [];
      }
      p.onChange(
        entries.map((entry) => ({ rowKey: entry.rowKey, columnKey: entry.columnKey, text: entry.after })),
        reason,
      );
      return entries.length;
    },
    [],
  );

  const select = useCallback((nextActive: GridPosition, nextAnchor: GridPosition = nextActive, focus = true): void => {
    setActive(nextActive);
    setAnchor(nextAnchor);
    if (focus) focusPending.current = true;
  }, []);

  /** Select the bounding rectangle of `entries` that are on this page; keep the selection otherwise. */
  const selectChanged = useCallback(
    (entries: readonly { rowKey: string; columnKey: string }[]): void => {
      const { props: p } = latest.current;
      const rowIndex = new Map(p.rows.map((r, i) => [r.key, i]));
      const colIndex = new Map(p.columns.map((c, i) => [c.key, i]));
      let rect: GridRect | null = null;
      for (const entry of entries) {
        const row = rowIndex.get(entry.rowKey);
        const col = colIndex.get(entry.columnKey);
        if (row === undefined || col === undefined) continue;
        rect = rect
          ? {
              top: Math.min(rect.top, row),
              left: Math.min(rect.left, col),
              bottom: Math.max(rect.bottom, row),
              right: Math.max(rect.right, col),
            }
          : { top: row, left: col, bottom: row, right: col };
      }
      if (rect) select({ row: rect.top, col: rect.left }, { row: rect.bottom, col: rect.right });
    },
    [select],
  );

  const undo = useCallback((): void => {
    const group = history.current.undo.pop();
    if (!group) {
      announce(t('editableGrid.announce.nothingToUndo'));
      return;
    }
    history.current.redo.push(group);
    applyChanges(
      group.map((e) => ({ rowKey: e.rowKey, columnKey: e.columnKey, text: e.before })),
      'undo',
    );
    selectChanged(group);
    announce(t('editableGrid.announce.undone', { count: group.length }));
  }, [announce, applyChanges, selectChanged, t]);

  const redo = useCallback((): void => {
    const group = history.current.redo.pop();
    if (!group) {
      announce(t('editableGrid.announce.nothingToRedo'));
      return;
    }
    history.current.undo.push(group);
    applyChanges(
      group.map((e) => ({ rowKey: e.rowKey, columnKey: e.columnKey, text: e.after })),
      'redo',
    );
    selectChanged(group);
    announce(t('editableGrid.announce.redone', { count: group.length }));
  }, [announce, applyChanges, selectChanged, t]);

  /** The cells of `rect` that may change, as `{ rowKey, columnKey }`. */
  const writableCells = useCallback(
    (rect: GridRect): { rowKey: string; columnKey: string }[] => {
      const { props: p } = latest.current;
      const out: { rowKey: string; columnKey: string }[] = [];
      for (let row = rect.top; row <= rect.bottom; row += 1) {
        for (let col = rect.left; col <= rect.right; col += 1) {
          if (!cellReadOnly(row, col)) out.push({ rowKey: p.rows[row]!.key, columnKey: p.columns[col]!.key });
        }
      }
      return out;
    },
    [cellReadOnly],
  );

  const clearSelection = useCallback((): void => {
    const { props: p, selectionRect: rect } = latest.current;
    if (!rect) return;
    const changes = writableCells(rect)
      .filter((cell) => p.getText(cell.rowKey, cell.columnKey) !== '')
      .map((cell) => ({ ...cell, text: '' }));
    const count = applyChanges(changes, 'clear');
    if (count > 0) announce(t('editableGrid.announce.cleared', { count }));
  }, [announce, applyChanges, t, writableCells]);

  const fillDown = useCallback((): void => {
    const { props: p, selectionRect: rect } = latest.current;
    if (!rect) return;
    // One row selected: take the row above it, as a spreadsheet does.
    const sourceRow = rect.top === rect.bottom ? rect.top - 1 : rect.top;
    const firstTarget = rect.top === rect.bottom ? rect.top : rect.top + 1;
    if (sourceRow < 0) return;
    const changes: EditableGridCellChange[] = [];
    for (let row = firstTarget; row <= rect.bottom; row += 1) {
      for (let col = rect.left; col <= rect.right; col += 1) {
        if (cellReadOnly(row, col)) continue;
        changes.push({
          rowKey: p.rows[row]!.key,
          columnKey: p.columns[col]!.key,
          text: p.getText(p.rows[sourceRow]!.key, p.columns[col]!.key),
        });
      }
    }
    const count = applyChanges(changes, 'fill');
    if (count > 0) announce(t('editableGrid.announce.filled', { count }));
  }, [announce, applyChanges, cellReadOnly, t]);

  const paste = useCallback(
    (text: string): void => {
      const { props: p, selectionRect: rect } = latest.current;
      if (!rect) return;
      const block = parseClipboardBlock(text);
      if (block.length === 0) return;
      const changes: EditableGridCellChange[] = [];
      let skipped = 0;
      let bottom = rect.top;
      let right = rect.left;
      const single = block.length === 1 && block[0]!.length === 1;
      const spansSelection = single && (rect.bottom > rect.top || rect.right > rect.left);
      if (spansSelection) {
        // One value into a larger selection fills it.
        for (const cell of writableCells(rect)) changes.push({ ...cell, text: block[0]![0]! });
        bottom = rect.bottom;
        right = rect.right;
      } else {
        block.forEach((line, i) => {
          line.forEach((value, j) => {
            const row = rect.top + i;
            const col = rect.left + j;
            if (row >= p.rows.length || col >= p.columns.length || cellReadOnly(row, col)) {
              skipped += 1;
              return;
            }
            bottom = Math.max(bottom, row);
            right = Math.max(right, col);
            changes.push({ rowKey: p.rows[row]!.key, columnKey: p.columns[col]!.key, text: value });
          });
        });
      }
      applyChanges(changes, 'paste');
      if (changes.length > 0) select({ row: rect.top, col: rect.left }, { row: bottom, col: right });
      announce(
        skipped > 0
          ? t('editableGrid.announce.pasteSkipped', { count: changes.length, skipped })
          : t('editableGrid.announce.pasted', { count: changes.length }),
      );
    },
    [announce, applyChanges, cellReadOnly, select, t, writableCells],
  );

  const copyText = useCallback((): string | null => {
    const { props: p, selectionRect: rect } = latest.current;
    if (!rect) return null;
    const block: string[][] = [];
    for (let row = rect.top; row <= rect.bottom; row += 1) {
      const line: string[] = [];
      for (let col = rect.left; col <= rect.right; col += 1) {
        line.push(p.getText(p.rows[row]!.key, p.columns[col]!.key));
      }
      block.push(line);
    }
    return serializeClipboardBlock(block);
  }, []);

  // Copy and paste arrive as clipboard events, not keystrokes: that is what
  // reaches the page from Ctrl/⌘+C/V, the browser menu and a screen reader's
  // own commands alike, and the clipboard data comes with the event. They are
  // heard on the document because a focused cell with no text selection does
  // not always receive them itself; the grid answers only while focus is on
  // one of its cells and no editor is open (an open editor's input takes its
  // own paste).
  useEffect(() => {
    const owns = (): boolean => {
      const focusedElement = document.activeElement;
      return Boolean(
        focusedElement &&
          tableRef.current?.contains(focusedElement) &&
          focusedElement.getAttribute('role') === 'gridcell' &&
          !latest.current.editing,
      );
    };
    const onCopy = (event: ClipboardEvent): void => {
      if (!owns()) return;
      const text = copyText();
      if (text === null || !event.clipboardData) return;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent): void => {
      if (!owns()) return;
      event.preventDefault();
      if (latest.current.props.readOnly) {
        announce(t('editableGrid.announce.readOnly'));
        return;
      }
      paste(event.clipboardData?.getData('text/plain') ?? '');
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    return (): void => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, [announce, copyText, paste, t]);

  // Focus follows the active cell after a move made inside the grid — never on
  // mount, and never because the caller re-rendered.
  useLayoutEffect(() => {
    if (!focusPending.current || editing || !position) return;
    focusPending.current = false;
    const key = `${position.row}:${position.col}`;
    cellElements.current.get(key)?.focus();
  });

  useEffect(() => {
    const { props: p } = latest.current;
    if (!p.onSelectionChange || !position || !selectionRect) return;
    p.onSelectionChange(selectionOf(p, position, selectionRect));
  }, [position?.row, position?.col, selectionRect?.top, selectionRect?.left, selectionRect?.bottom, selectionRect?.right]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(
    props.ref,
    (): EditableGridHandle => ({
      apply: (changes, reason = 'edit') => applyChanges(changes, reason),
      clearHistory: () => {
        history.current = { undo: [], redo: [] };
      },
      selection: () => {
        const { props: p, position: pos, selectionRect: rect } = latest.current;
        return pos && rect ? selectionOf(p, pos, rect) : null;
      },
    }),
    [applyChanges],
  );

  const startEdit = useCallback(
    (initial: string | null): void => {
      const { position: pos, props: p } = latest.current;
      if (!pos) return;
      if (cellReadOnly(pos.row, pos.col)) {
        announce(t('editableGrid.announce.readOnly'));
        return;
      }
      setAnchor(pos);
      setEditing({ initial: initial ?? p.getText(p.rows[pos.row]!.key, p.columns[pos.col]!.key) });
    },
    [announce, cellReadOnly, t],
  );

  const commitEdit = useCallback(
    (text: string, move: CommitMove): void => {
      const { position: pos, props: p } = latest.current;
      setEditing(null);
      if (!pos) return;
      applyChanges([{ rowKey: p.rows[pos.row]!.key, columnKey: p.columns[pos.col]!.key, text }], 'edit');
      if (move === 'none') return;
      select(moveFrom(pos, move, p.rows.length, p.columns.length, 1));
    },
    [applyChanges, select],
  );

  const cancelEdit = useCallback((): void => {
    setEditing(null);
    focusPending.current = true;
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableElement>): void => {
      const { position: pos, props: p } = latest.current;
      if (!pos || latest.current.editing) return;
      if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'gridcell') return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key;
      const rowsN = p.rows.length;
      const colsN = p.columns.length;
      const step = p.pageStep ?? 10;

      const navigation: Record<string, GridMove> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        Home: mod ? 'gridStart' : 'rowStart',
        End: mod ? 'gridEnd' : 'rowEnd',
        PageUp: 'pageUp',
        PageDown: 'pageDown',
      };
      const move = navigation[key];
      if (move) {
        event.preventDefault();
        const next = moveFrom(pos, move, rowsN, colsN, step);
        if (event.shiftKey) {
          setActive(next);
          focusPending.current = true;
        } else {
          select(next);
        }
        return;
      }

      const lower = key.toLowerCase();
      if (mod && lower === 'z') {
        event.preventDefault();
        if (p.readOnly) return;
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && lower === 'y') {
        event.preventDefault();
        if (!p.readOnly) redo();
        return;
      }
      if (mod && lower === 'd') {
        // Ctrl+D is the browser's bookmark shortcut; inside the grid it fills.
        event.preventDefault();
        if (!p.readOnly) fillDown();
        return;
      }
      if (mod || event.altKey) return;

      if (key === 'Enter' || key === 'F2') {
        event.preventDefault();
        startEdit(null);
        return;
      }
      if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        if (p.readOnly) return;
        clearSelection();
        return;
      }
      if (key === 'Escape') {
        setAnchor(pos);
        return;
      }
      if (key.length === 1) {
        // A printable key starts an edit that replaces the text with it.
        event.preventDefault();
        if (p.readOnly) return;
        startEdit(key);
      }
    },
    [clearSelection, fillDown, redo, select, startEdit, undo],
  );

  const positionOf = (target: EventTarget | null): GridPosition | null => {
    if (!(target instanceof Element)) return null;
    const cellElement = target.closest('[role="gridcell"]');
    if (!cellElement || !tableRef.current?.contains(cellElement)) return null;
    const row = Number(cellElement.getAttribute('data-row'));
    const col = Number(cellElement.getAttribute('data-col'));
    return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null;
  };

  const onMouseDown = (event: MouseEvent<HTMLTableElement>): void => {
    if (event.target instanceof HTMLInputElement) return;
    const at = positionOf(event.target);
    if (!at) return;
    if (event.shiftKey && position) {
      event.preventDefault();
      setActive(at);
      focusPending.current = true;
      return;
    }
    select(at);
  };

  const onDoubleClick = (event: MouseEvent<HTMLTableElement>): void => {
    if (event.target instanceof HTMLInputElement) return;
    // The first click of the pair has already made this cell the active one.
    if (!positionOf(event.target)) return;
    startEdit(null);
  };

  const registerCell = useCallback((key: string, element: HTMLTableCellElement | null): void => {
    if (element) cellElements.current.set(key, element);
    else cellElements.current.delete(key);
  }, []);

  const renderCell = props.renderCell ?? defaultRenderCell;
  const editorLabel = useMemo(
    () =>
      (rowLabel: string, columnLabel: string): string =>
        t('editableGrid.editorLabel', { row: rowLabel, column: columnLabel }),
    [t],
  );

  return (
    <div className={cn('relative w-full overflow-auto b2b-table-scroll', props.className)}>
      <table
        ref={tableRef}
        role="grid"
        aria-label={props.label}
        aria-describedby={instructionsId}
        aria-multiselectable="true"
        aria-readonly={readOnly ? 'true' : undefined}
        aria-rowcount={(totalRowCount ?? rowCount) + 1}
        aria-colcount={colCount + 1}
        className="w-full border-collapse text-sm"
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
      >
        <thead>
          <tr role="row" aria-rowindex={1} className="border-b">
            <th role="columnheader" scope="col" className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">
              {props.rowHeaderLabel}
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                role="columnheader"
                scope="col"
                className="h-10 px-2 text-right align-middle font-medium text-muted-foreground"
              >
                {column.header ?? column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.key} role="row" aria-rowindex={rowIndexOffset + rowIndex + 2} className="border-b">
              <th role="rowheader" scope="row" className="px-2 py-1 text-left align-middle font-normal">
                {row.header ?? row.label}
              </th>
              {columns.map((column, colIndex) => {
                const isActive = position !== null && position.row === rowIndex && position.col === colIndex;
                const error = props.getError?.(row.key, column.key);
                return (
                  <GridCell
                    key={column.key}
                    cellId={`${baseId}-${rowIndex}-${colIndex}`}
                    row={rowIndex}
                    col={colIndex}
                    rowKey={row.key}
                    columnKey={column.key}
                    rowLabel={row.label}
                    columnLabel={column.label}
                    text={props.getText(row.key, column.key)}
                    token={props.getCellToken?.(row.key, column.key) ?? ''}
                    error={error}
                    readOnly={Boolean(readOnly || row.readOnly || props.isReadOnly?.(row.key, column.key))}
                    active={isActive}
                    selected={selectionRect !== null && inRect(selectionRect, rowIndex, colIndex)}
                    editingInitial={isActive && editing ? editing.initial : null}
                    renderCell={renderCell}
                    editorLabel={editorLabel}
                    register={registerCell}
                    onCommit={commitEdit}
                    onCancel={cancelEdit}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ReorderAnnouncer message={message} instructions={t('editableGrid.instructions')} instructionsId={instructionsId} />
    </div>
  );
}

function defaultRenderCell(context: EditableGridRenderContext): ReactNode {
  return context.text;
}

function selectionOf(props: EditableGridProps, position: GridPosition, rect: GridRect): EditableGridSelection {
  const cells: { rowKey: string; columnKey: string }[] = [];
  for (let row = rect.top; row <= rect.bottom; row += 1) {
    for (let col = rect.left; col <= rect.right; col += 1) {
      cells.push({ rowKey: props.rows[row]!.key, columnKey: props.columns[col]!.key });
    }
  }
  return {
    active: { rowKey: props.rows[position.row]!.key, columnKey: props.columns[position.col]!.key },
    cells,
  };
}

interface GridCellProps {
  readonly cellId: string;
  readonly row: number;
  readonly col: number;
  readonly rowKey: string;
  readonly columnKey: string;
  readonly rowLabel: string;
  readonly columnLabel: string;
  readonly text: string;
  /** The caller's memo token (`getCellToken`); compared, never rendered. */
  readonly token: string;
  readonly error: string | undefined;
  readonly readOnly: boolean;
  readonly active: boolean;
  readonly selected: boolean;
  /** The editor's starting text while this cell is being edited; `null` otherwise. */
  readonly editingInitial: string | null;
  readonly renderCell: (context: EditableGridRenderContext) => ReactNode;
  readonly editorLabel: (rowLabel: string, columnLabel: string) => string;
  readonly register: (key: string, element: HTMLTableCellElement | null) => void;
  readonly onCommit: (text: string, move: CommitMove) => void;
  readonly onCancel: () => void;
}

const GridCell = memo(function GridCell(props: GridCellProps): ReactNode {
  const { row, col, register } = props;
  const errorId = props.error ? `${props.cellId}-error` : undefined;
  const ref = useCallback((element: HTMLTableCellElement | null) => register(`${row}:${col}`, element), [register, row, col]);
  return (
    <td
      ref={ref}
      role="gridcell"
      data-row={row}
      data-col={col}
      tabIndex={props.active && props.editingInitial === null ? 0 : -1}
      aria-selected={props.selected}
      aria-readonly={props.readOnly ? 'true' : undefined}
      aria-invalid={props.error ? 'true' : undefined}
      aria-describedby={errorId}
      // The reason on hover too: the icon says *that* the cell is wrong, the
      // linked text says *why* to assistive technology, this says it to a pointer.
      title={props.error}
      className={cn(
        // 44 px rows below `sm` (Fitts), the denser 36 px a desktop editor wants above it.
        'relative h-11 min-w-24 px-2 py-1 text-right align-middle tabular-nums outline-none sm:h-9',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        props.selected && 'bg-primary/10',
        props.readOnly && 'text-muted-foreground',
        props.error && 'ring-1 ring-inset ring-destructive',
      )}
    >
      {props.editingInitial !== null ? (
        <CellEditor
          initial={props.editingInitial}
          label={props.editorLabel(props.rowLabel, props.columnLabel)}
          onCommit={props.onCommit}
          onCancel={props.onCancel}
        />
      ) : (
        <span className="inline-flex items-center justify-end gap-1">
          {props.error ? <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-destructive" /> : null}
          {props.renderCell({
            rowKey: props.rowKey,
            columnKey: props.columnKey,
            text: props.text,
            error: props.error,
            readOnly: props.readOnly,
          })}
        </span>
      )}
      {props.error ? (
        <span id={errorId} className="sr-only">
          {props.error}
        </span>
      ) : null}
    </td>
  );
});

function CellEditor(props: {
  readonly initial: string;
  readonly label: string;
  readonly onCommit: (text: string, move: CommitMove) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [value, setValue] = useState(props.initial);
  const done = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const finish = (action: () => void): void => {
    if (done.current) return;
    done.current = true;
    action();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      aria-label={props.label}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        // The editor's keys are its own: the grid's navigation must not see them.
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(() => props.onCommit(value, 'down'));
        } else if (event.key === 'Tab') {
          event.preventDefault();
          finish(() => props.onCommit(value, event.shiftKey ? 'left' : 'right'));
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(props.onCancel);
        }
      }}
      onBlur={() => finish(() => props.onCommit(value, 'none'))}
      className="h-7 w-full rounded border border-input bg-background px-1 text-right tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}
