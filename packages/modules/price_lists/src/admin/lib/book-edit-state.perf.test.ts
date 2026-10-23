import { describe, expect, it } from 'vitest';
import { addLines, buildSave, createEditState, editCell, editCells, selectionKeyOf, type NewLine } from './book-edit-state.js';

/**
 * A 5 000-row save at the edit-state level (feature 161, T099; FR-036): a
 * paste of 5 000 prices into 5 000 new product lines — one change group, as
 * the grid hands it over — and the one batch that saves them stay linear.
 * Written first, this test measured 4 269 ms: each cell of the group copied
 * every edit so far, and the save read every edit once per line (both
 * quadratic); `editCells` applies a group in one pass and `buildSave` groups
 * the edits by line once — 73 ms on the development machine, 2026-10-23.
 * **Budget**: 1 000 ms, about fourteen times that; it catches a quadratic
 * coming back, not jitter.
 */

const NO_LABELS = {
  productName: null,
  productSku: null,
  variantLabel: null,
  variantSku: null,
  categoryPath: null,
  attributeLabel: null,
  attributeValueLabel: null,
};
const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

describe('book edit state — 5 000 rows (161 T099)', () => {
  it('builds the batch of 5 000 typed rows within the budget in the header', () => {
    const lines: NewLine[] = Array.from({ length: 5000 }, (_, i) => ({
      kind: 'product',
      selection: { productId: id(i + 1) },
      labels: { ...NO_LABELS, productSku: `SKU-${i}` },
    }));
    const started = performance.now();
    let state = addLines(createEditState({ version: 1, isBase: false }), lines).state;
    state = editCells(
      state,
      lines.map((line, i) => ({ lineKey: selectionKeyOf(line.selection), start: 1, text: `${i + 1},50` })),
    );
    const plan = buildSave(state);
    const elapsed = performance.now() - started;
    if ('blocked' in plan) throw new Error('blocked');
    expect(plan.body.upsert).toHaveLength(5000);
    expect(elapsed).toBeLessThan(1000);
  });

  it('applies a group exactly as the same edits one by one', () => {
    const lines: NewLine[] = Array.from({ length: 20 }, (_, i) => ({
      kind: 'product',
      selection: { productId: id(i + 1) },
      labels: { ...NO_LABELS, productSku: `SKU-${i}` },
    }));
    const start = addLines(createEditState({ version: 1, isBase: false }), lines).state;
    const group = lines.flatMap((line, i) => [
      { lineKey: selectionKeyOf(line.selection), start: 1, text: `${i},5` },
      { lineKey: selectionKeyOf(line.selection), start: 10, text: i % 2 ? '-5%' : 'abc' },
      { lineKey: selectionKeyOf(line.selection), start: 1, text: i % 3 ? '' : '7' },
    ]);
    const oneByOne = group.reduce((acc, c) => editCell(acc, c.lineKey, c.start, c.text), start);
    expect(editCells(start, group)).toEqual(oneByOne);
  });
});
