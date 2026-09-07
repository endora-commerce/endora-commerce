import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useReorderList,
  type ReorderLabels,
} from '../../../../packages/admin-shell/src/components/reorder/useReorderList';

/**
 * Feature 067 / T081 — the shared reorder primitive (FR-069, SC-014).
 *
 * FR-069 says reordering must be operable **by keyboard alone**, with the
 * moved item's new position perceivable to a screen-reader user. That is two
 * requirements, and the second is the one that gets dropped: a list that moves
 * silently is unusable to anyone who cannot see it move.
 *
 * So every transition below asserts both halves — the new order, and the exact
 * sentence the live region announces.
 */

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: 'a', name: 'id' },
  { id: 'b', name: 'title' },
  { id: 'c', name: 'price' },
];

const LABELS: ReorderLabels = {
  grabbed: (v) => `Grabbed ${v.name}. Position ${v.index} of ${v.total}.`,
  moving: (v) => `${v.name}, position ${v.index} of ${v.total}.`,
  dropped: (v) => `${v.name} dropped. Now at position ${v.index} of ${v.total}.`,
  cancelled: (v) => `Reorder cancelled. ${v.name} is back at position ${v.index}.`,
  moved: (v) => `${v.name} moved to position ${v.index} of ${v.total}.`,
  atStart: (v) => `${v.name} is already first.`,
  atEnd: (v) => `${v.name} is already last.`,
  handle: (v) => `Reorder ${v.name}`,
};

function setup(onReorder = vi.fn<(next: Row[]) => void>()) {
  const view = renderHook(
    ({ items }: { items: Row[] }) =>
      useReorderList<Row>({
        items,
        getId: (row) => row.id,
        getLabel: (row) => row.name,
        onReorder,
        labels: LABELS,
      }),
    { initialProps: { items: ROWS } },
  );
  return { ...view, onReorder };
}

/** A keyboard event the hook can consume, with the two calls it makes on it. */
function key(k: string, options: { altKey?: boolean } = {}): {
  key: string;
  altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
} {
  return {
    key: k,
    altKey: options.altKey ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe('useReorderList', () => {
  it('moves an item down and announces its new position', () => {
    const { result, onReorder } = setup();
    act(() => result.current.moveBy('a', 1));
    expect(onReorder).toHaveBeenCalledWith([ROWS[1], ROWS[0], ROWS[2]]);
    expect(result.current.announcement).toBe('id moved to position 2 of 3.');
  });

  it('refuses to move past either end, and says so rather than doing nothing', () => {
    const { result, onReorder } = setup();
    act(() => result.current.moveBy('a', -1));
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.announcement).toBe('id is already first.');

    act(() => result.current.moveBy('c', 1));
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.announcement).toBe('price is already last.');
  });

  it('moves to an absolute position (the answer for a 60-field template)', () => {
    const { result, onReorder } = setup();
    act(() => result.current.moveTo('c', 0));
    expect(onReorder).toHaveBeenCalledWith([ROWS[2], ROWS[0], ROWS[1]]);
    expect(result.current.announcement).toBe('price moved to position 1 of 3.');
  });

  describe('keyboard grab mode', () => {
    it('grabs, moves and drops with space and the arrow keys alone', () => {
      const { result, rerender, onReorder } = setup();

      act(() => result.current.onHandleKeyDown('a', key(' ')));
      expect(result.current.grabbedId).toBe('a');
      expect(result.current.announcement).toBe('Grabbed id. Position 1 of 3.');

      act(() => result.current.onHandleKeyDown('a', key('ArrowDown')));
      expect(onReorder).toHaveBeenLastCalledWith([ROWS[1], ROWS[0], ROWS[2]]);
      expect(result.current.announcement).toBe('id, position 2 of 3.');

      // The parent owns the list, so the hook sees the new order on the next render.
      rerender({ items: [ROWS[1]!, ROWS[0]!, ROWS[2]!] });

      act(() => result.current.onHandleKeyDown('a', key(' ')));
      expect(result.current.grabbedId).toBeNull();
      expect(result.current.announcement).toBe('id dropped. Now at position 2 of 3.');
    });

    it('escape puts the item back where it was picked up from', () => {
      const { result, rerender, onReorder } = setup();
      act(() => result.current.onHandleKeyDown('c', key(' ')));
      act(() => result.current.onHandleKeyDown('c', key('ArrowUp')));
      rerender({ items: [ROWS[0]!, ROWS[2]!, ROWS[1]!] });
      onReorder.mockClear();

      act(() => result.current.onHandleKeyDown('c', key('Escape')));
      expect(onReorder).toHaveBeenCalledWith([ROWS[0], ROWS[1], ROWS[2]]);
      expect(result.current.grabbedId).toBeNull();
      expect(result.current.announcement).toBe('Reorder cancelled. price is back at position 3.');
    });

    it('Alt+arrow moves without entering grab mode (the VS Code convention)', () => {
      const { result, onReorder } = setup();
      act(() => result.current.onHandleKeyDown('a', key('ArrowDown', { altKey: true })));
      expect(result.current.grabbedId).toBeNull();
      expect(onReorder).toHaveBeenCalledWith([ROWS[1], ROWS[0], ROWS[2]]);
      expect(result.current.announcement).toBe('id moved to position 2 of 3.');
    });

    it('arrows move focus, not the item, while nothing is grabbed', () => {
      const { result, onReorder } = setup();
      act(() => result.current.onHandleKeyDown('a', key('ArrowDown')));
      expect(onReorder).not.toHaveBeenCalled();
      expect(result.current.activeId).toBe('b');

      act(() => result.current.onHandleKeyDown('b', key('End')));
      expect(result.current.activeId).toBe('c');
      act(() => result.current.onHandleKeyDown('c', key('Home')));
      expect(result.current.activeId).toBe('a');
    });
  });

  it('keeps the roving tab stop on the moved item, so focus travels with it', () => {
    const { result } = setup();
    act(() => result.current.onHandleKeyDown('a', key(' ')));
    act(() => result.current.onHandleKeyDown('a', key('ArrowDown')));
    // Not "position 2", which would leave focus on whatever moved into slot 1.
    expect(result.current.activeId).toBe('a');
  });

  it('gives exactly one handle a tab stop', () => {
    const { result } = setup();
    const stops = ROWS.filter((row) => result.current.getHandleProps(row, 0).tabIndex === 0);
    expect(stops).toHaveLength(1);
  });

  it('labels each handle with the item it moves, and marks a grabbed one pressed', () => {
    const { result } = setup();
    expect(result.current.getHandleProps(ROWS[1]!, 1)['aria-label']).toBe('Reorder title');
    expect(result.current.getHandleProps(ROWS[1]!, 1)['aria-pressed']).toBe(false);
    act(() => result.current.onHandleKeyDown('b', key(' ')));
    expect(result.current.getHandleProps(ROWS[1]!, 1)['aria-pressed']).toBe(true);
  });

  it('reorders on a pointer drop, and announces it like every other path', () => {
    const { result, onReorder } = setup();
    act(() => result.current.onDragStart('a'));
    expect(result.current.draggingId).toBe('a');
    act(() => result.current.onDrop('c'));
    expect(onReorder).toHaveBeenCalledWith([ROWS[1], ROWS[2], ROWS[0]]);
    expect(result.current.announcement).toBe('id moved to position 3 of 3.');
    expect(result.current.draggingId).toBeNull();
  });

  it('does nothing at all while disabled — a filtered list has no unambiguous order', () => {
    const onReorder = vi.fn<(next: Row[]) => void>();
    const { result } = renderHook(() =>
      useReorderList<Row>({
        items: ROWS,
        getId: (row) => row.id,
        getLabel: (row) => row.name,
        onReorder,
        labels: LABELS,
        disabled: true,
      }),
    );
    act(() => result.current.moveBy('a', 1));
    act(() => result.current.onHandleKeyDown('a', key(' ')));
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.grabbedId).toBeNull();
    expect(result.current.announcement).toBe('');
    expect(result.current.getItemProps(ROWS[0]!, 0).draggable).toBe(false);
  });

  it('exposes the position of every item, so a screen reader can count them', () => {
    const { result } = setup();
    const props = result.current.getItemProps(ROWS[1]!, 1);
    expect(props['aria-posinset']).toBe(2);
    expect(props['aria-setsize']).toBe(3);
    expect(props['aria-roledescription']).toBeTruthy();
  });
});
