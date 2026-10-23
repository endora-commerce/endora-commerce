import { describe, expect, it } from 'vitest';
import { priceBookRowsWriteSchema, type PriceBookLine, type PriceBookRow } from '@endora-commerce/contracts';
import {
  addLines,
  applySaveErrors,
  buildSave,
  cellKey,
  cellText,
  cellToken,
  cellView,
  createEditState,
  editCell,
  editCellDetail,
  editedStarts,
  effectiveRows,
  invalidCount,
  rebase,
  rowCountAfter,
  selectionKeyOf,
  unsavedCount,
  withLines,
  type BookEditState,
} from './book-edit-state.js';

/**
 * The grid's edit state (feature 161, T063; `data-model.md` §3; FR-010,
 * FR-013, FR-014, FR-017, FR-037).
 *
 * What is pinned here is the round trip the coordinator named: a cell's text →
 * a parsed price → one batch → the rows the server stores. Rows of one
 * selection may not overlap (160 FR-006), so a line's windows are *chained*:
 * each tier row ends one below the next row's start, the last is open. Adding
 * or clearing a tier therefore moves its neighbour's end, and the batch says
 * so; a custom window set in the cell detail keeps its own end.
 */

const P1 = '00000000-0000-4000-8000-000000161b01';
const P2 = '00000000-0000-4000-8000-000000161b02';
const V1 = '00000000-0000-4000-8000-000000161b11';
const SCREWS = '00000000-0000-4000-8000-000000161ca1';

const NO_LABELS = {
  productName: null,
  productSku: null,
  variantLabel: null,
  variantSku: null,
  categoryPath: null,
  attributeLabel: null,
  attributeValueLabel: null,
};

let seq = 0;
const rowId = (): string => `00000000-0000-4000-8000-${(0x1610000 + ++seq).toString(16).padStart(12, '0')}`;

function row(selection: PriceBookRow['selection'], min: number, max: number | null, price: PriceBookRow['price']): PriceBookRow {
  return {
    id: rowId(),
    selectionKind: selection.variantId ? 'variant' : selection.productId ? 'product' : selection.categoryId ? 'category' : 'all',
    selection,
    minQuantity: min,
    maxQuantity: max,
    price,
    inactiveReason: null,
    targetDeleted: false,
    labels: NO_LABELS,
    naturalKey: {},
  };
}

const sel = (s: Partial<PriceBookRow['selection']>): PriceBookRow['selection'] => ({
  variantId: null,
  productId: null,
  categoryId: null,
  attribute: null,
  ...s,
});

function line(selection: PriceBookRow['selection'], rows: PriceBookRow[], variants?: PriceBookLine[]): PriceBookLine {
  return {
    selectionKey: selectionKeyOf(selection),
    selectionKind: selection.variantId ? 'variant' : selection.productId ? 'product' : selection.categoryId ? 'category' : 'all',
    selection,
    labels: { ...NO_LABELS, productName: selection.productId ? 'Screws 0200' : null },
    naturalKey: {},
    inactiveReason: null,
    targetDeleted: false,
    rows,
    ...(variants ? { variants } : {}),
  };
}

const p1Sel = sel({ productId: P1 });
const screwsSel = sel({ categoryId: SCREWS });
const P1_KEY = selectionKeyOf(p1Sel);
const SCREWS_KEY = selectionKeyOf(screwsSel);

/** L2 of the worked examples: Screws −10 %, P1 −20 %, both from 1. */
function l2(): { state: BookEditState; screws: PriceBookRow; p1: PriceBookRow } {
  const screws = row(screwsSel, 1, null, { type: 'percent', percent: '-10.00' });
  const p1 = row(p1Sel, 1, null, { type: 'percent', percent: '-20.00' });
  const state = withLines(createEditState({ version: 3, isBase: false }), [line(screwsSel, [screws]), line(p1Sel, [p1])]);
  return { state, screws, p1 };
}

describe('selection keys', () => {
  it('are the server’s: variant | product | category | attribute key | value', () => {
    expect(selectionKeyOf(sel({ variantId: V1, productId: P1 }))).toBe(`${V1}||||`);
    expect(selectionKeyOf(p1Sel)).toBe(`|${P1}|||`);
    expect(selectionKeyOf(sel({ categoryId: SCREWS, attribute: { key: 'color', value: 'red' } }))).toBe(`||${SCREWS}|color|red`);
    expect(selectionKeyOf(sel({ attribute: { key: 'color', value: 'red' } }))).toBe(`|||color|red`);
    expect(selectionKeyOf(sel({}))).toBe('||||');
    expect(cellKey(P1_KEY, 10)).toBe(`|${P1}|||@10`);
  });
});

describe('editing a cell', () => {
  it('shows the stored price as text, in the admin language', () => {
    const { state } = l2();
    expect(cellText(state, P1_KEY, 1, 'en')).toBe('-20%');
    expect(cellText(state, P1_KEY, 10, 'en')).toBe('');
  });

  it('records a changed price, and forgets an edit that returns to the stored value', () => {
    let { state } = l2();
    state = editCell(state, P1_KEY, 1, '−15 %');
    expect(unsavedCount(state)).toBe(1);
    expect(cellView(state, P1_KEY, 1)).toMatchObject({ price: { type: 'percent', percent: '-15.00' }, edited: true });
    state = editCell(state, P1_KEY, 1, '-20%');
    expect(unsavedCount(state)).toBe(0);
  });

  it('keeps refused text in the cell with its reason, and blocks the save', () => {
    let { state } = l2();
    state = editCell(state, P1_KEY, 1, '20%');
    expect(cellText(state, P1_KEY, 1, 'en')).toBe('20%');
    expect(cellView(state, P1_KEY, 1).invalid).toEqual({ text: '20%', reason: { kind: 'invalid', reason: 'percentNeedsSign' } });
    expect(invalidCount(state)).toBe(1);
    expect(buildSave(state)).toEqual({ blocked: { invalid: 1 } });
  });

  it('refuses a fixed price on the all-products line', () => {
    const all = sel({});
    let state = withLines(createEditState({ version: 1, isBase: false }), [line(all, [row(all, 1, null, { type: 'percent', percent: '-1.00' })])]);
    state = editCell(state, selectionKeyOf(all), 1, '95');
    expect(cellView(state, selectionKeyOf(all), 1).invalid?.reason).toEqual({ kind: 'invalid', reason: 'fixedOnAll' });
  });

  it('on a base book, prices a product line with a fixed amount only and a variant any way', () => {
    const v1Sel = sel({ variantId: V1, productId: P1 });
    const base = row(p1Sel, 1, null, { type: 'fixed', amount: '100.0000' });
    let state = withLines(createEditState({ version: 1, isBase: true }), [line(p1Sel, [base], [line(v1Sel, [])])]);
    state = editCell(state, P1_KEY, 1, '-5%');
    expect(cellView(state, P1_KEY, 1).invalid?.reason).toEqual({ kind: 'invalid', reason: 'baseFixedOnly' });
    state = editCell(state, selectionKeyOf(v1Sel), 1, '+10%');
    expect(cellView(state, selectionKeyOf(v1Sel), 1).price).toEqual({ type: 'percent', percent: '10.00' });
  });
});

describe('windows and the batch', () => {
  it('saves a changed price against its stored row id, nothing else', () => {
    let { state, p1 } = l2();
    state = editCell(state, P1_KEY, 1, '-15%');
    const save = buildSave(state);
    if ('blocked' in save) throw new Error('blocked');
    expect(save.body).toEqual({
      mode: 'merge',
      upsert: [{ id: p1.id, selection: { productId: P1 }, minQuantity: 1, maxQuantity: null, price: { type: 'percent', percent: '-15.00' } }],
      delete: [],
    });
    expect(priceBookRowsWriteSchema.safeParse({ ...save.body, expectedVersion: 3 }).success).toBe(true);
    expect(save.cells).toEqual([cellKey(P1_KEY, 1)]);
  });

  it('adding a tier ends the tier below it one quantity earlier', () => {
    let { state, p1 } = l2();
    state = editCell(state, P1_KEY, 10, '-25%');
    expect(effectiveRows(state, P1_KEY).map((r) => [r.min, r.max])).toEqual([
      [1, 9],
      [10, null],
    ]);
    const save = buildSave(state);
    if ('blocked' in save) throw new Error('blocked');
    expect(save.body.upsert).toEqual([
      { id: p1.id, selection: { productId: P1 }, minQuantity: 1, maxQuantity: 9, price: { type: 'percent', percent: '-20.00' } },
      { selection: { productId: P1 }, minQuantity: 10, maxQuantity: null, price: { type: 'percent', percent: '-25.00' } },
    ]);
    // The neighbour's row is the cell's too, for an error the server names by row id.
    expect(save.cells).toEqual([cellKey(P1_KEY, 1), cellKey(P1_KEY, 10)]);
  });

  it('clearing a tier deletes its row and opens the tier below', () => {
    const r1 = row(p1Sel, 1, 9, { type: 'fixed', amount: '95.0000' });
    const r10 = row(p1Sel, 10, null, { type: 'fixed', amount: '90.0000' });
    let state = withLines(createEditState({ version: 1, isBase: false }), [line(p1Sel, [r1, r10])]);
    state = editCell(state, P1_KEY, 10, '');
    const save = buildSave(state);
    if ('blocked' in save) throw new Error('blocked');
    expect(save.body.upsert).toEqual([{ id: r1.id, selection: { productId: P1 }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '95.0000' } }]);
    expect(save.body.delete).toEqual([r10.id]);
  });

  it('keeps a custom window from the cell detail, and the stored custom windows it did not touch', () => {
    const r1 = row(p1Sel, 1, 24, { type: 'fixed', amount: '95.0000' });
    const r25 = row(p1Sel, 25, 49, { type: 'fixed', amount: '90.0000' });
    let state = withLines(createEditState({ version: 1, isBase: false }), [line(p1Sel, [r1, r25])]);
    expect(cellView(state, P1_KEY, 25)).toMatchObject({ window: { min: 25, max: 49 }, custom: true });
    state = editCell(state, P1_KEY, 25, '88');
    let save = buildSave(state);
    if ('blocked' in save) throw new Error('blocked');
    expect(save.body.upsert).toEqual([{ id: r25.id, selection: { productId: P1 }, minQuantity: 25, maxQuantity: 49, price: { type: 'fixed', amount: '88.0000' } }]);
    state = editCellDetail(state, P1_KEY, 25, { price: { type: 'fixed', amount: '88.0000' }, min: 25, max: 99 });
    save = buildSave(state);
    if ('blocked' in save) throw new Error('blocked');
    expect(save.body.upsert[0]).toMatchObject({ id: r25.id, minQuantity: 25, maxQuantity: 99 });
    state = editCellDetail(state, P1_KEY, 25, 'clear');
    save = buildSave(state);
    if ('blocked' in save) throw new Error('blocked');
    expect(save.body.delete).toEqual([r25.id]);
    // r1 ended at 24 because r25 began at 25; with r25 gone, r1 is open-ended.
    expect(save.body.upsert).toEqual([{ id: r1.id, selection: { productId: P1 }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '95.0000' } }]);
  });

  it('counts the rows a save would leave, for the 5 000-row cap', () => {
    let { state } = l2();
    state = editCell(state, P1_KEY, 10, '-25%');
    state = editCell(state, SCREWS_KEY, 1, '');
    expect(rowCountAfter(state, 2)).toBe(2);
  });
});

describe('inherited cells (FR-037)', () => {
  it('shows the nearest lower tier covering the quantity, or says the line does not price it', () => {
    const r1 = row(p1Sel, 1, 9, { type: 'percent', percent: '-20.00' });
    const r10 = row(p1Sel, 10, null, { type: 'percent', percent: '-25.00' });
    const r1b = row(screwsSel, 1, 9, { type: 'percent', percent: '-10.00' });
    const state = withLines(createEditState({ version: 1, isBase: false }), [line(p1Sel, [r1, r10]), line(screwsSel, [r1b])]);
    expect(cellView(state, P1_KEY, 100).inherited).toEqual({ from: 10, price: { type: 'percent', percent: '-25.00' } });
    expect(cellView(state, SCREWS_KEY, 10).inherited).toBeNull();
    expect(cellView(state, SCREWS_KEY, 10).price).toBeNull();
  });
});

describe('lines added through the pickers', () => {
  it('adds each selection once, counts it as unsaved, and saves only priced cells', () => {
    let { state } = l2();
    const p2 = sel({ productId: P2 });
    const added = addLines(state, [
      { selection: p2, kind: 'product', labels: { ...NO_LABELS, productName: 'Screws 0300' } },
      { selection: p2, kind: 'product', labels: NO_LABELS },
      { selection: p1Sel, kind: 'product', labels: NO_LABELS },
    ]);
    expect([added.added, added.skipped]).toEqual([1, 2]);
    state = added.state;
    expect(unsavedCount(state)).toBe(1);
    state = editCell(state, selectionKeyOf(p2), 1, '45');
    expect(unsavedCount(state)).toBe(1);
    const save = buildSave(state);
    if ('blocked' in save) throw new Error('blocked');
    expect(save.body.upsert).toEqual([{ selection: { productId: P2 }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '45.0000' } }]);
  });
});

describe('server refusals and a stale book', () => {
  it('marks every failing cell, by upsert index and by stored row id', () => {
    let { state, screws } = l2();
    state = editCell(state, P1_KEY, 1, '-15%');
    state = editCell(state, P1_KEY, 10, '-25%');
    const save = buildSave(state);
    if ('blocked' in save) throw new Error('blocked');
    state = applySaveErrors(state, save, [
      { index: 1, field: 'price', code: 'PRICE_BOOK_ROW_SHAPE', message: 'bad' },
      { rowId: screws.id, field: 'minQuantity', code: 'PRICE_BOOK_ROW_OVERLAP', message: 'overlap' },
    ]);
    expect(cellView(state, P1_KEY, 10).error).toBe('PRICE_BOOK_ROW_SHAPE');
    expect(cellView(state, SCREWS_KEY, 1).error).toBe('PRICE_BOOK_ROW_OVERLAP');
    // The rule, when the server names it, is kept rather than its group (Checkpoint 11 ruling 2).
    const ruled = applySaveErrors(state, save, [
      { index: 1, field: 'price.type', code: 'PRICE_BOOK_ROW_SHAPE', reason: 'fixed_on_all', message: 'English' },
    ]);
    expect(cellView(ruled, P1_KEY, 10).error).toBe('reason.fixed_on_all');
    // The edits stay for correction.
    expect(unsavedCount(state)).toBe(2);
    // Editing a marked cell clears its mark.
    state = editCell(state, P1_KEY, 10, '-26%');
    expect(cellView(state, P1_KEY, 10).error).toBeUndefined();
  });

  it('rebases the edits onto a reloaded book and drops those the other writer already made', () => {
    let { state, p1, screws } = l2();
    state = editCell(state, P1_KEY, 1, '-15%');
    state = editCell(state, SCREWS_KEY, 1, '-12%');
    // Someone else set Screws to −12 % meanwhile.
    const theirs = { ...screws, price: { type: 'percent' as const, percent: '-12.00' } };
    state = rebase(withLines(state, [line(screwsSel, [theirs]), line(p1Sel, [p1])]), 4);
    expect(state.baseVersion).toBe(4);
    expect(unsavedCount(state)).toBe(1);
    expect(cellView(state, P1_KEY, 1).edited).toBe(true);
  });
});

describe('moving a window and showing placeholder lines', () => {
  it('moves a row to another start: deletes it there and writes the window anew', () => {
    const r1 = row(p1Sel, 1, null, { type: 'fixed', amount: '95.0000' });
    let state = withLines(createEditState({ version: 1, isBase: false }), [line(p1Sel, [r1])]);
    state = editCellDetail(state, P1_KEY, 1, { price: { type: 'fixed', amount: '42.0000' }, min: 25, max: 49 });
    expect(cellView(state, P1_KEY, 1).price).toBeNull();
    expect(cellView(state, P1_KEY, 25)).toMatchObject({ price: { type: 'fixed', amount: '42.0000' }, window: { min: 25, max: 49 }, custom: true });
    const save = buildSave(state);
    if ('blocked' in save) throw new Error('blocked');
    expect(save.body).toEqual({
      mode: 'merge',
      upsert: [{ selection: { productId: P1 }, minQuantity: 25, maxQuantity: 49, price: { type: 'fixed', amount: '42.0000' } }],
      delete: [r1.id],
    });
    expect(editedStarts(state)).toEqual([1, 25]);
  });

  it('shows lines that are not unsaved changes (a product’s unpriced variants)', () => {
    const { state } = l2();
    const v1 = sel({ variantId: V1, productId: P1 });
    const shown = addLines(state, [{ selection: v1, kind: 'variant', labels: NO_LABELS, parentKey: P1_KEY }], { unsaved: false });
    expect(shown.added).toBe(1);
    expect(unsavedCount(shown.state)).toBe(0);
    expect(shown.state.lines.get(selectionKeyOf(v1))?.parentKey).toBe(P1_KEY);
  });
});

describe('cell tokens — the grid’s render bound (SC-004, FR-036)', () => {
  it('change for the cells of the edited line only, and for its variants', () => {
    const v1Sel = sel({ variantId: V1, productId: P1 });
    const p1 = row(p1Sel, 1, null, { type: 'percent', percent: '-20.00' });
    const screws = row(screwsSel, 1, null, { type: 'percent', percent: '-10.00' });
    const before = withLines(createEditState({ version: 1, isBase: false }), [line(screwsSel, [screws]), line(p1Sel, [p1], [line(v1Sel, [])])]);
    const after = editCell(before, P1_KEY, 10, '-25%');
    const changed = (key: string, start: number): boolean => cellToken(before, key, start) !== cellToken(after, key, start);
    expect([1, 10, 100].map((start) => changed(SCREWS_KEY, start))).toEqual([false, false, false]);
    // The edited cell, the tier below it (its window ends at 9 now) and the
    // empty cell above it (it inherits from 10 now) …
    expect([1, 10, 100].map((start) => changed(P1_KEY, start))).toEqual([true, true, true]);
    // … and the variant cells that show what the product line gives.
    expect(changed(selectionKeyOf(v1Sel), 10)).toBe(true);
    expect(changed(selectionKeyOf(v1Sel), 1)).toBe(false);
  });
});
