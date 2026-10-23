import type {
  PriceBookBatchRowInput,
  PriceBookLine,
  PriceBookRow,
  PriceBookRowError,
  PriceBookRowLabels,
  PriceBookRowPrice,
  PriceBookSelectionKind,
} from '@endora-commerce/contracts';
import { formatPriceCell, parsePriceCell, type PriceCellLanguage, type PriceCellRefusal } from './price-cell.js';

/**
 * The grid's edit state (feature 161, `data-model.md` §3; FR-010, FR-013,
 * FR-014, FR-017, FR-037). Pure: no React, no request.
 *
 * **Keys.** A line is its selection, keyed as the server keys it
 * (`variant|product|category|attribute key|value`, `price-book-rules.ts`
 * `selectionKey`), so a line read on one page and edited on another is one
 * line. A cell is `lineKey@start`, the start being the quantity tier column.
 *
 * **Windows.** Rows of one selection may not overlap (160 FR-006). A stored row
 * is *chained* when it ends one below the next row's start, or is the last and
 * open-ended; every other row has a *custom* window (set in the cell detail,
 * FR-010). After the edits, chained rows are re-chained — so adding a tier
 * ends the one below it, and clearing a tier opens it again — while custom
 * windows keep their ends. Only rows whose start, end or price changed go into
 * the batch.
 *
 * **What it does not hold**: the undo history. Undo and redo are the admin-kit
 * grid's (`EditableGrid`), which replays a group's earlier texts through
 * {@link editCell}; a text equal to the stored price drops the edit.
 */

export interface EditSelection {
  readonly variantId: string | null;
  readonly productId: string | null;
  readonly categoryId: string | null;
  readonly attribute: { readonly key: string; readonly value: string } | null;
}

export interface EditLine {
  readonly key: string;
  readonly kind: PriceBookSelectionKind;
  readonly selection: EditSelection;
  readonly labels: PriceBookRowLabels;
  readonly rows: readonly PriceBookRow[];
  readonly inactiveReason: PriceBookLine['inactiveReason'];
  readonly targetDeleted: boolean;
  /** The product line a variant line sits under. */
  readonly parentKey: string | null;
  /** Added through a picker and not stored yet. */
  readonly added: boolean;
}

/** A refusal of the browser's own: the parser's, or a base book's product line priced other than fixed. */
export type CellRefusal = PriceCellRefusal | { readonly kind: 'invalid'; readonly reason: 'baseFixedOnly' };

export type CellEdit =
  | { readonly kind: 'set'; readonly price: PriceBookRowPrice; readonly window?: { readonly min: number; readonly max: number | null } }
  | { readonly kind: 'clear' }
  | { readonly kind: 'invalid'; readonly text: string; readonly reason: CellRefusal };

export interface BookEditState {
  /** The book version the edits are made against (G5). */
  readonly baseVersion: number;
  readonly isBase: boolean;
  readonly lines: ReadonlyMap<string, EditLine>;
  readonly edits: ReadonlyMap<string, CellEdit>;
  /** The server's refusal code per cell, from the last save (G6). */
  readonly serverErrors: ReadonlyMap<string, string>;
}

export const cellKey = (lineKey: string, start: number): string => `${lineKey}@${start}`;

/** The server's key of a selection (`price-book-rules.ts` `selectionKey`). */
export function selectionKeyOf(selection: Partial<EditSelection>): string {
  const variantId = selection.variantId ?? '';
  return [variantId, variantId ? '' : (selection.productId ?? ''), selection.categoryId ?? '', selection.attribute?.key ?? '', selection.attribute?.value ?? ''].join('|');
}

export function createEditState(options: { readonly version: number; readonly isBase: boolean }): BookEditState {
  return { baseVersion: options.version, isBase: options.isBase, lines: new Map(), edits: new Map(), serverErrors: new Map() };
}

const selectionOf = (s: PriceBookLine['selection']): EditSelection => ({
  variantId: s.variantId ?? null,
  productId: s.productId ?? null,
  categoryId: s.categoryId ?? null,
  attribute: s.attribute ?? null,
});

/**
 * Remember lines read from the server (a page): their stored rows replace what
 * was known, the edits stay. Variant lines are kept under their product. An
 * edit that now equals the stored price is dropped — after a reload, the other
 * writer may have made it already.
 */
export function withLines(state: BookEditState, lines: readonly PriceBookLine[]): BookEditState {
  const next = new Map(state.lines);
  const put = (line: PriceBookLine, parentKey: string | null): void => {
    next.set(line.selectionKey, {
      key: line.selectionKey,
      kind: line.selectionKind,
      selection: selectionOf(line.selection),
      labels: line.labels,
      rows: [...line.rows].sort((a, b) => a.minQuantity - b.minQuantity),
      inactiveReason: line.inactiveReason,
      targetDeleted: line.targetDeleted,
      parentKey,
      added: false,
    });
  };
  for (const line of lines) {
    put(line, null);
    for (const variant of line.variants ?? []) put(variant, line.selectionKey);
  }
  return dropSettled({ ...state, lines: next });
}

/** A line to add through a picker. */
export interface NewLine {
  readonly selection: Partial<EditSelection>;
  readonly kind: PriceBookSelectionKind;
  readonly labels: PriceBookRowLabels;
  readonly parentKey?: string | null;
}

/** Add lines not yet in the book or in the edits; a selection already there is skipped, never doubled (FR-008). */
export function addLines(
  state: BookEditState,
  lines: readonly NewLine[],
  options: {
    /**
     * `false` for lines shown rather than added — a product's unpriced
     * variants (FR-009): typing into one is a change, showing it is not.
     */
    readonly unsaved?: boolean;
  } = {},
): { state: BookEditState; added: number; skipped: number } {
  const next = new Map(state.lines);
  let added = 0;
  let skipped = 0;
  for (const line of lines) {
    const selection: EditSelection = {
      variantId: line.selection.variantId ?? null,
      productId: line.selection.productId ?? null,
      categoryId: line.selection.categoryId ?? null,
      attribute: line.selection.attribute ?? null,
    };
    const key = selectionKeyOf(selection);
    if (next.has(key)) {
      skipped += 1;
      continue;
    }
    next.set(key, {
      key,
      kind: line.kind,
      selection,
      labels: line.labels,
      rows: [],
      inactiveReason: null,
      targetDeleted: false,
      parentKey: line.parentKey ?? null,
      added: options.unsaved ?? true,
    });
    added += 1;
  }
  return { state: { ...state, lines: next }, added, skipped };
}

const storedAt = (line: EditLine, start: number): PriceBookRow | undefined => line.rows.find((r) => r.minQuantity === start);

const samePrice = (a: PriceBookRowPrice, b: PriceBookRowPrice): boolean => {
  if (a.type !== b.type) return false;
  if (a.type === 'percent' && b.type === 'percent') return Number(a.percent) === Number(b.percent);
  if (a.type !== 'percent' && b.type !== 'percent') return Number(a.amount) === Number(b.amount);
  return false;
};

/** Parse a cell's text for one line, with the base book's rule on product lines. */
function parseFor(state: BookEditState, line: EditLine, text: string): CellEdit {
  const parsed = parsePriceCell(text, { selection: line.selection });
  if (parsed.kind === 'empty') return { kind: 'clear' };
  if (parsed.kind === 'invalid') return { kind: 'invalid', text, reason: parsed };
  if (state.isBase && line.kind === 'product' && parsed.price.type !== 'fixed') {
    return { kind: 'invalid', text, reason: { kind: 'invalid', reason: 'baseFixedOnly' } };
  }
  return { kind: 'set', price: parsed.price };
}

/** An edit that would leave the cell as stored is no edit. */
function settled(line: EditLine, start: number, edit: CellEdit): boolean {
  const stored = storedAt(line, start);
  if (edit.kind === 'clear') return stored === undefined;
  if (edit.kind === 'invalid') return false;
  if (!stored) return false;
  if (!samePrice(stored.price, edit.price)) return false;
  return edit.window === undefined || (edit.window.min === stored.minQuantity && edit.window.max === stored.maxQuantity);
}

function dropSettled(state: BookEditState): BookEditState {
  let changed = false;
  const edits = new Map(state.edits);
  for (const [key, edit] of edits) {
    const at = key.lastIndexOf('@');
    const line = state.lines.get(key.slice(0, at));
    if (line && settled(line, Number(key.slice(at + 1)), edit)) {
      edits.delete(key);
      changed = true;
    }
  }
  return changed ? { ...state, edits } : state;
}

function putEdit(state: BookEditState, lineKey: string, start: number, edit: CellEdit): BookEditState {
  const line = state.lines.get(lineKey);
  if (!line) return state;
  const key = cellKey(lineKey, start);
  const edits = new Map(state.edits);
  if (settled(line, start, edit)) edits.delete(key);
  else edits.set(key, edit);
  const serverErrors = new Map(state.serverErrors);
  serverErrors.delete(key);
  return { ...state, edits, serverErrors };
}

/** The grid typed `text` into a cell (an edit, a paste, a fill, an undo). */
export function editCell(state: BookEditState, lineKey: string, start: number, text: string): BookEditState {
  const line = state.lines.get(lineKey);
  if (!line) return state;
  return putEdit(state, lineKey, start, parseFor(state, line, text));
}

/**
 * A change group the grid hands over at once — a paste, a fill, a bulk change,
 * an undo (feature 161, T099; FR-036): the same result as `editCell` applied
 * one by one, in one pass. Applied one by one, each cell copied every edit so
 * far, and a 5 000-cell paste took seconds.
 */
export function editCells(
  state: BookEditState,
  changes: ReadonlyArray<{ readonly lineKey: string; readonly start: number; readonly text: string }>,
): BookEditState {
  if (changes.length === 0) return state;
  const edits = new Map(state.edits);
  const serverErrors = new Map(state.serverErrors);
  let touched = false;
  for (const change of changes) {
    const line = state.lines.get(change.lineKey);
    if (!line) continue;
    touched = true;
    const key = cellKey(change.lineKey, change.start);
    const edit = parseFor(state, line, change.text);
    if (settled(line, change.start, edit)) edits.delete(key);
    else edits.set(key, edit);
    serverErrors.delete(key);
  }
  return touched ? { ...state, edits, serverErrors } : state;
}

/** The cell detail (FR-010): a price with its own window, or a clear. */
export function editCellDetail(
  state: BookEditState,
  lineKey: string,
  start: number,
  detail: { readonly price: PriceBookRowPrice; readonly min: number; readonly max: number | null } | 'clear',
): BookEditState {
  if (detail === 'clear') return putEdit(state, lineKey, start, { kind: 'clear' });
  const set: CellEdit = { kind: 'set', price: detail.price, window: { min: detail.min, max: detail.max } };
  if (detail.min === start) return putEdit(state, lineKey, start, set);
  // A window moved to another start: the row leaves this start and is written
  // anew at its own, where its column shows it.
  return putEdit(putEdit(state, lineKey, start, { kind: 'clear' }), lineKey, detail.min, set);
}

export interface EffectiveRow {
  readonly min: number;
  readonly max: number | null;
  readonly price: PriceBookRowPrice;
  /** The stored row this one updates, if any. */
  readonly rowId: string | undefined;
  /** The column the row is edited in (its stored start, for a moved window). */
  readonly start: number;
  readonly custom: boolean;
}

/** The line's rows once the edits are applied, windows re-chained (see the file header). */
export function effectiveRows(state: BookEditState, lineKey: string): EffectiveRow[] {
  const line = state.lines.get(lineKey);
  if (!line) return [];
  return effectiveRowsOf(line, editsByLine(state).get(lineKey) ?? []);
}

/**
 * Every line's edits, grouped once per edit map (T099): a save reads each
 * line's once, and a page of cells — each asking for its line's rows — does
 * not scan every edit per cell. The edit map is replaced, never mutated, on
 * every change, so it keys the cache.
 */
const editsByLineCache = new WeakMap<ReadonlyMap<string, CellEdit>, Map<string, Array<readonly [string, CellEdit]>>>();

function editsByLine(state: BookEditState): Map<string, Array<readonly [string, CellEdit]>> {
  const cached = editsByLineCache.get(state.edits);
  if (cached) return cached;
  const out = new Map<string, Array<readonly [string, CellEdit]>>();
  for (const [key, edit] of state.edits) {
    const lineKey = key.slice(0, key.lastIndexOf('@'));
    const list = out.get(lineKey);
    if (list) list.push([key, edit]);
    else out.set(lineKey, [[key, edit]]);
  }
  editsByLineCache.set(state.edits, out);
  return out;
}

function effectiveRowsOf(line: EditLine, lineEdits: ReadonlyArray<readonly [string, CellEdit]>): EffectiveRow[] {
  const stored = line.rows;
  const chained = (index: number): boolean => {
    const row = stored[index]!;
    const next = stored[index + 1];
    return next ? row.maxQuantity === next.minQuantity - 1 : row.maxQuantity === null;
  };
  const rows: { min: number; max: number | null; price: PriceBookRowPrice; rowId: string | undefined; start: number; custom: boolean }[] = [];
  const editedStarts = new Set<number>();
  for (const [key, edit] of lineEdits) {
    const at = key.lastIndexOf('@');
    const start = Number(key.slice(at + 1));
    editedStarts.add(start);
    const original = storedAt(line, start);
    const originalIndex = original ? stored.indexOf(original) : -1;
    if (edit.kind === 'clear') continue;
    if (edit.kind === 'invalid') {
      // Not saved: the stored row, if any, stays as it is.
      if (original) rows.push({ min: original.minQuantity, max: original.maxQuantity, price: original.price, rowId: original.id, start, custom: !chained(originalIndex) });
      continue;
    }
    if (edit.window) {
      rows.push({ min: edit.window.min, max: edit.window.max, price: edit.price, rowId: original?.id, start, custom: true });
    } else if (original) {
      rows.push({ min: original.minQuantity, max: original.maxQuantity, price: edit.price, rowId: original.id, start, custom: !chained(originalIndex) });
    } else {
      rows.push({ min: start, max: null, price: edit.price, rowId: undefined, start, custom: false });
    }
  }
  stored.forEach((row, index) => {
    if (editedStarts.has(row.minQuantity)) return;
    rows.push({ min: row.minQuantity, max: row.maxQuantity, price: row.price, rowId: row.id, start: row.minQuantity, custom: !chained(index) });
  });
  rows.sort((a, b) => a.min - b.min);
  return rows.map((row, index) => {
    if (row.custom) return row;
    const next = rows[index + 1];
    return { ...row, max: next ? next.min - 1 : null };
  });
}

export interface CellView {
  /** The cell's price after the edits, `null` when the line does not price from this start. */
  readonly price: PriceBookRowPrice | null;
  readonly window: { readonly min: number; readonly max: number | null } | null;
  readonly custom: boolean;
  readonly edited: boolean;
  readonly invalid: { readonly text: string; readonly reason: CellRefusal } | undefined;
  /** For an empty cell: the nearest lower tier whose window covers this start (FR-037). */
  readonly inherited: { readonly from: number; readonly price: PriceBookRowPrice } | null;
  /** The server's refusal code for this cell after the last save. */
  readonly error: string | undefined;
}

export function cellView(state: BookEditState, lineKey: string, start: number): CellView {
  const key = cellKey(lineKey, start);
  const edit = state.edits.get(key);
  const rows = effectiveRows(state, lineKey);
  const own = rows.find((row) => row.start === start);
  const inherited =
    own === undefined
      ? ([...rows].reverse().find((row) => row.min < start && (row.max === null || row.max >= start)) ?? null)
      : null;
  return {
    price: own?.price ?? null,
    window: own ? { min: own.min, max: own.max } : null,
    custom: own?.custom ?? false,
    edited: edit !== undefined,
    invalid: edit?.kind === 'invalid' ? { text: edit.text, reason: edit.reason } : undefined,
    inherited: inherited ? { from: inherited.min, price: inherited.price } : null,
    error: state.serverErrors.get(key),
  };
}

/** Every tier start an edit names, ascending — columns the book does not have yet. */
export function editedStarts(state: BookEditState): number[] {
  return [...new Set([...state.edits.keys()].map((key) => Number(key.slice(key.lastIndexOf('@') + 1))))].sort((a, b) => a - b);
}

/**
 * A cell's memo token for the grid (`EditableGrid` `getCellToken`): everything
 * the cell shows — its view, and for an empty variant cell what its product
 * line gives (FR-009). Equal tokens mean an unchanged cell, so an edit renders
 * the cells of its line (and its variants) and no other (SC-004, FR-036).
 */
export function cellToken(state: BookEditState, lineKey: string, start: number): string {
  const view = cellView(state, lineKey, start);
  const line = state.lines.get(lineKey);
  const parent = line?.parentKey && view.price === null && !view.inherited ? cellView(state, line.parentKey, start) : null;
  return JSON.stringify([view, parent?.price ?? parent?.inherited?.price ?? null]);
}

/** The text a cell is edited and copied as. */
export function cellText(state: BookEditState, lineKey: string, start: number, language: PriceCellLanguage): string {
  const view = cellView(state, lineKey, start);
  if (view.invalid) return view.invalid.text;
  return view.price ? formatPriceCell(view.price, language) : '';
}

/** Edited cells, plus added lines that carry none yet (US2 scenario 1: 40 lines added → 40). */
export function unsavedCount(state: BookEditState): number {
  const editedLines = new Set([...state.edits.keys()].map((key) => key.slice(0, key.lastIndexOf('@'))));
  let added = 0;
  for (const line of state.lines.values()) if (line.added && !editedLines.has(line.key)) added += 1;
  return state.edits.size + added;
}

export function invalidCount(state: BookEditState): number {
  let n = 0;
  for (const edit of state.edits.values()) if (edit.kind === 'invalid') n += 1;
  return n;
}

export interface SavePlan {
  readonly body: { readonly mode: 'merge'; readonly upsert: PriceBookBatchRowInput[]; readonly delete: string[] };
  /** The cell of each `upsert` entry, by index (G6 `errors[].index`). */
  readonly cells: readonly string[];
  /** The cell of each stored row the batch names or touches (G6 `errors[].rowId`). */
  readonly rowCells: ReadonlyMap<string, string>;
}

const wireSelection = (s: EditSelection): PriceBookBatchRowInput['selection'] =>
  s.variantId
    ? { variantId: s.variantId }
    : {
        ...(s.productId ? { productId: s.productId } : {}),
        ...(s.categoryId ? { categoryId: s.categoryId } : {}),
        ...(s.attribute ? { attribute: s.attribute } : {}),
      };

/** One batch of every change (FR-013), or why it cannot be sent yet (FR-017). */
export function buildSave(state: BookEditState): SavePlan | { readonly blocked: { readonly invalid: number } } {
  const invalid = invalidCount(state);
  if (invalid > 0) return { blocked: { invalid } };
  const upsert: PriceBookBatchRowInput[] = [];
  const cells: string[] = [];
  const del: string[] = [];
  const rowCells = new Map<string, string>();
  const byLine = editsByLine(state);
  for (const line of state.lines.values()) {
    for (const row of line.rows) rowCells.set(row.id, cellKey(line.key, row.minQuantity));
    const lineEdits = byLine.get(line.key);
    if (!lineEdits) continue;
    const rows = effectiveRowsOf(line, lineEdits);
    const kept = new Set(rows.map((row) => row.rowId).filter((id): id is string => id !== undefined));
    for (const row of rows) {
      const stored = row.rowId ? line.rows.find((r) => r.id === row.rowId) : undefined;
      if (stored && stored.minQuantity === row.min && stored.maxQuantity === row.max && samePrice(stored.price, row.price)) continue;
      upsert.push({
        ...(row.rowId ? { id: row.rowId } : {}),
        selection: wireSelection(line.selection),
        minQuantity: row.min,
        maxQuantity: row.max,
        price: row.price,
      });
      cells.push(cellKey(line.key, row.start));
    }
    for (const row of line.rows) if (!kept.has(row.id)) del.push(row.id);
  }
  return { body: { mode: 'merge', upsert, delete: del }, cells, rowCells };
}

/** Mark every cell the server refused (G6), keeping every edit (FR-014). */
export function applySaveErrors(state: BookEditState, plan: SavePlan, errors: readonly PriceBookRowError[]): BookEditState {
  const serverErrors = new Map<string, string>();
  for (const error of errors) {
    const key =
      error.index !== undefined ? plan.cells[error.index] : error.rowId !== undefined ? plan.rowCells.get(error.rowId) : undefined;
    // The rule when the server names it (`errors.reason.*`), else its group (`errors.*`).
    if (key && !serverErrors.has(key)) serverErrors.set(key, error.reason ? `reason.${error.reason}` : error.code);
  }
  return { ...state, serverErrors };
}

/** After a stale refusal and a reload: keep the edits against the new version (SC-005). */
export function rebase(state: BookEditState, version: number): BookEditState {
  return dropSettled({ ...state, baseVersion: version, serverErrors: new Map() });
}

/**
 * After a save: nothing unsaved. The stored lines stay until the caller reads
 * them again (their rows are then replaced); lines added and not stored go.
 */
export function afterSave(state: BookEditState, version: number): BookEditState {
  const lines = new Map([...state.lines].filter(([, line]) => !line.added));
  return { ...createEditState({ version, isBase: state.isBase }), lines };
}

/** The book's row count once the batch is written — for the 5 000-row cap of non-base books. */
export function rowCountAfter(state: BookEditState, storedRowCount: number): number {
  const plan = buildSave({ ...state, edits: new Map([...state.edits].filter(([, e]) => e.kind !== 'invalid')) });
  if ('blocked' in plan) return storedRowCount;
  return storedRowCount + plan.body.upsert.filter((row) => row.id === undefined).length - plan.body.delete.length;
}

/** The text of a cell's price for a language, re-exported for the grid's renderer. */
export { formatPriceCell };
