/**
 * `specs/193-admin-form-extensions/` D-300.14 (`contracts/field-slots.md` §5,
 * SC-005) — the one layout implementation, over the shared vectors: in order,
 * under 50 seeded shuffles of the slots and moves, and reversed. Registration
 * order, bundle order and process never change a form.
 */
import { describe, expect, it } from 'vitest';

import { applyFieldMoves, formLayout } from './admin-forms.js';
import { FORM_LAYOUT_VECTORS, type FormLayoutVector } from './admin-forms.vectors.js';

function layoutOf(vector: FormLayoutVector, order: (n: number) => number[] = (n) => [...Array(n).keys()]) {
  const slots = vector.slots ?? [];
  const moves = vector.moves ?? [];
  return formLayout({
    sections: vector.sections,
    hidden: vector.hidden ?? [],
    visibleWhen: vector.visibleWhen ?? {},
    values: vector.values ?? {},
    slots: order(slots.length).map((index) => slots[index]!),
    moves: order(moves.length).map((index) => moves[index]!),
  });
}

/** A deterministic permutation, so a failure names a reproducible order. */
function permutation(seed: number): (n: number) => number[] {
  return (n) => {
    const indexes = [...Array(n).keys()];
    let state = seed;
    for (let i = n - 1; i > 0; i -= 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const j = state % (i + 1);
      [indexes[i], indexes[j]] = [indexes[j]!, indexes[i]!];
    }
    return indexes;
  };
}

describe('formLayout over the shared vectors (§5)', () => {
  for (const vector of FORM_LAYOUT_VECTORS) {
    it(vector.name, () => {
      expect(layoutOf(vector).map((section) => ({ section: section.key, items: section.items.map((item) => item.key) }))).toEqual(
        vector.expected,
      );
    });
  }
});

describe('formLayout is deterministic under shuffled registration (SC-005)', () => {
  for (const vector of FORM_LAYOUT_VECTORS) {
    it(vector.name, () => {
      const reference = JSON.stringify(layoutOf(vector));
      for (let seed = 1; seed <= 50; seed += 1) {
        expect(JSON.stringify(layoutOf(vector, permutation(seed))), `seed ${String(seed)}`).toBe(reference);
      }
      expect(JSON.stringify(layoutOf(vector, (n) => [...Array(n).keys()].reverse()))).toBe(reference);
    });
  }
});

describe('applyFieldMoves (§5 step 1)', () => {
  const sections = [
    { key: 'identity', keys: ['name', 'taxId', 'parentId'] },
    { key: 'address', keys: ['registeredAddress'] },
  ];

  it('applies moves in (moduleId, key) code-point order, whatever order they arrive in', () => {
    const moves = [
      { moduleId: 'zeta', key: 'name', after: 'registeredAddress' },
      { moduleId: 'alpha', key: 'parentId', after: 'registeredAddress' },
    ];
    const expected = [
      { key: 'identity', keys: ['taxId'] },
      { key: 'address', keys: ['registeredAddress', 'parentId', 'name'] },
    ];
    expect(applyFieldMoves(sections, moves)).toEqual(expected);
    expect(applyFieldMoves(sections, [...moves].reverse())).toEqual(expected);
  });

  it('orders by code point, not by locale: an upper-case module id sorts first', () => {
    // `localeCompare` would put `acme` before `Zeta`; code points put `Z` (90) before `a` (97).
    const moves = [
      { moduleId: 'acme', key: 'name', after: 'registeredAddress' },
      { moduleId: 'Zeta', key: 'taxId', after: 'registeredAddress' },
    ];
    expect(applyFieldMoves(sections, moves)[1]).toEqual({ key: 'address', keys: ['registeredAddress', 'taxId', 'name'] });
  });

  it('ignores a move whose key or anchor is in no section, and leaves its input untouched', () => {
    const copy = JSON.parse(JSON.stringify(sections)) as typeof sections;
    expect(applyFieldMoves(sections, [{ moduleId: 'acme', key: 'nickname', before: 'name' }, { moduleId: 'acme', key: 'name', after: 'vatId' }])).toEqual(
      sections,
    );
    expect(sections).toEqual(copy);
  });
});
