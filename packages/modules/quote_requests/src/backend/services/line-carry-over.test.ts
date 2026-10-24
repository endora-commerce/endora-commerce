import { describe, expect, it } from 'vitest';
import {
  carriedProposal,
  pairLines,
  referenceInputsUnchanged,
  type CarryOverRow,
} from './line-carry-over.js';

/**
 * Feature 146, Phase 6 (T034) — which stored line an incoming line of a
 * rewrite *is* (research R5, data-model §2), and what a paired line keeps
 * (FR-034, FR-035, FR-036; threat model T5).
 */

const P1 = 'product-1';
const P2 = 'product-2';
const V1 = 'variant-1';
const V2 = 'variant-2';

function row(id: string, extra: Partial<CarryOverRow> = {}): CarryOverRow {
  return { id, productId: P1, variantId: null, packagingUnitName: null, ...extra };
}

describe('pairLines — admin modify (ids honoured)', () => {
  it('an id naming a row of this request with the same product pairs with that row', () => {
    const a = row('a');
    const b = row('b');
    const { paired, removed } = pairLines([a, b], [{ id: 'b', productId: P1 }], 'admin');
    expect(paired).toEqual([b]);
    expect(removed).toEqual([a]);
  });

  it('an id naming a row of another product does not pair by id', () => {
    const a = row('a', { productId: P1 });
    const { paired, removed } = pairLines([a], [{ id: 'a', productId: P2 }], 'admin');
    expect(paired).toEqual([null]);
    expect(removed).toEqual([a]);
  });

  it('an id naming no row falls back to the product rule rather than refusing', () => {
    const a = row('a');
    const { paired } = pairLines([a], [{ id: 'unknown', productId: P1 }], 'admin');
    expect(paired).toEqual([a]);
  });

  it('a line without variantId (key absent) pairs with a row of that product, preferring a variant-less one', () => {
    const withVariant = row('v', { variantId: V1 });
    const plain = row('p');
    expect(pairLines([withVariant, plain], [{ productId: P1 }], 'admin').paired).toEqual([plain]);
    expect(pairLines([withVariant], [{ productId: P1 }], 'admin').paired).toEqual([withVariant]);
  });

  it('two variants of one product never cross-pair', () => {
    const v1 = row('v1', { variantId: V1 });
    const v2 = row('v2', { variantId: V2 });
    const { paired } = pairLines(
      [v1, v2],
      [
        { productId: P1, variantId: V2 },
        { productId: P1, variantId: V1 },
      ],
      'admin',
    );
    expect(paired).toEqual([v2, v1]);
    // An explicit variant with no row of its own is a new line, not the other variant.
    expect(pairLines([v1], [{ productId: P1, variantId: V2 }], 'admin').paired).toEqual([null]);
  });

  it('every unpaired existing row is reported removed and every unpaired incoming line is new', () => {
    const a = row('a');
    const b = row('b', { productId: P2 });
    const { paired, removed } = pairLines([a, b], [{ productId: P1 }, { productId: 'product-3' }], 'admin');
    expect(paired).toEqual([a, null]);
    expect(removed).toEqual([b]);
  });
});

describe('pairLines — customer patchDraft (no ids)', () => {
  it('ignores an id: a customer line is paired by product, variant, packaging and position only', () => {
    const a = row('a');
    const b = row('b');
    const { paired } = pairLines([a, b], [{ id: 'b', productId: P1, variantId: null }], 'customer');
    expect(paired).toEqual([a]);
  });

  it('an absent variant means "no variant": it never pairs with a variant row', () => {
    const v1 = row('v1', { variantId: V1 });
    expect(pairLines([v1], [{ productId: P1, variantId: null }], 'customer').paired).toEqual([null]);
  });

  it('within one product and variant, an equal packaging name wins over position', () => {
    const plain = row('plain');
    const pallet = row('pallet', { packagingUnitName: 'Paleta' });
    const { paired } = pairLines(
      [plain, pallet],
      [
        { productId: P1, variantId: null, packagingUnitName: 'Paleta' },
        { productId: P1, variantId: null, packagingUnitName: null },
      ],
      'customer',
    );
    expect(paired).toEqual([pallet, plain]);
  });

  it('with no equal packaging name, position decides', () => {
    const first = row('first', { packagingUnitName: 'Karton' });
    const second = row('second', { packagingUnitName: 'Paleta' });
    const { paired, removed } = pairLines(
      [first, second],
      [{ productId: P1, variantId: null, packagingUnitName: 'Skrzynka' }],
      'customer',
    );
    expect(paired).toEqual([first]);
    expect(removed).toEqual([second]);
  });

  it('FR-031 (b) — the stored unit id pairs a line whose unit was renamed, ahead of a name match', () => {
    const renamed = row('renamed', { packagingUnitId: 'unit-pallet', packagingUnitName: 'Paleta' });
    const sameName = row('same-name', { packagingUnitId: 'unit-other', packagingUnitName: 'Paleta EUR' });
    const { paired } = pairLines(
      [sameName, renamed],
      [{ productId: P1, variantId: null, packagingUnitId: 'unit-pallet', packagingUnitName: 'Paleta EUR' }],
      'customer',
    );
    expect(paired).toEqual([renamed]);
  });

  it('a line without a unit id still pairs by name, and an id never pairs a row without one', () => {
    const legacy = row('legacy', { packagingUnitName: 'Paleta' });
    expect(
      pairLines([legacy], [{ productId: P1, variantId: null, packagingUnitName: 'Paleta' }], 'customer').paired,
    ).toEqual([legacy]);
    expect(
      pairLines(
        [legacy],
        [{ productId: P1, variantId: null, packagingUnitId: 'unit-pallet', packagingUnitName: 'Paleta' }],
        'customer',
      ).paired,
    ).toEqual([legacy]);
  });

  it('an exact packaging match is not stolen by an earlier line that falls back to position', () => {
    const karton = row('karton', { packagingUnitName: 'Karton' });
    const paleta = row('paleta', { packagingUnitName: 'Paleta' });
    const { paired } = pairLines(
      [paleta, karton],
      [
        { productId: P1, variantId: null, packagingUnitName: 'Skrzynka' },
        { productId: P1, variantId: null, packagingUnitName: 'Paleta' },
      ],
      'customer',
    );
    expect(paired).toEqual([karton, paleta]);
  });
});

/**
 * Feature 159 (research N-32) — one product may sit on several lines, in
 * different groups. With no id to go by, a line pairs with a row of its own
 * group first, then one of its own quantity, before position decides.
 */
describe('pairLines — one product on several lines (feature 159)', () => {
  const Y = 'group-y';
  const Z = 'group-z';

  it('a customer line pairs with the row of its quantity: removing the 5 keeps the 3 in its group', () => {
    const five = row('five', { quantity: 5, groupId: Y });
    const three = row('three', { quantity: 3, groupId: Z });
    const { paired, removed } = pairLines(
      [five, three],
      [{ productId: P1, variantId: null, packagingUnitName: null, quantity: 3 }],
      'customer',
    );
    expect(paired).toEqual([three]);
    expect(removed).toEqual([five]);
  });

  it('a line naming its group pairs with the row of that group, ahead of quantity and position', () => {
    const five = row('five', { quantity: 5, groupId: Y });
    const three = row('three', { quantity: 3, groupId: Z });
    const { paired } = pairLines(
      [five, three],
      [
        { productId: P1, variantId: null, packagingUnitName: null, groupId: Z, quantity: 5 },
        { productId: P1, variantId: null, packagingUnitName: null, groupId: Y, quantity: 3 },
      ],
      'customer',
    );
    expect(paired).toEqual([three, five]);
  });

  it('group and quantity together win over the group alone', () => {
    const a = row('a', { quantity: 2, groupId: Y });
    const b = row('b', { quantity: 7, groupId: Y });
    const { paired } = pairLines(
      [a, b],
      [
        { productId: P1, variantId: null, packagingUnitName: null, groupId: Y, quantity: 4 },
        { productId: P1, variantId: null, packagingUnitName: null, groupId: Y, quantity: 2 },
      ],
      'customer',
    );
    // The 2 claims its exact row first; the 4 (changed) takes the other row of Y.
    expect(paired).toEqual([b, a]);
  });

  it('`groupId: null` is a group too — the ungrouped section', () => {
    const grouped = row('grouped', { quantity: 1, groupId: Y });
    const ungrouped = row('ungrouped', { quantity: 1, groupId: null });
    const { paired } = pairLines(
      [grouped, ungrouped],
      [{ productId: P1, variantId: null, packagingUnitName: null, groupId: null }],
      'customer',
    );
    expect(paired).toEqual([ungrouped]);
  });

  it('an admin line without an id pairs by group within its variant wildcard', () => {
    const y = row('y', { variantId: V1, quantity: 1, groupId: Y });
    const z = row('z', { variantId: V1, quantity: 1, groupId: Z });
    const { paired } = pairLines([y, z], [{ productId: P1, groupId: Z }], 'admin');
    expect(paired).toEqual([z]);
  });

  it('a line saying nothing of group or quantity still pairs by position', () => {
    const a = row('a', { quantity: 5, groupId: Y });
    const b = row('b', { quantity: 3, groupId: Z });
    const { paired } = pairLines(
      [a, b],
      [{ productId: P1, variantId: null, packagingUnitName: null }],
      'customer',
    );
    expect(paired).toEqual([a]);
  });
});

describe('carriedProposal — threat model T5', () => {
  it('a paired line whose body omits desiredUnitPrice carries the stored proposal', () => {
    expect(carriedProposal(undefined, { desiredUnitPrice: '95.00' })).toBe('95.00');
  });

  it('an explicit value replaces it', () => {
    expect(carriedProposal(80, { desiredUnitPrice: '95.00' })).toBe('80.00');
    expect(carriedProposal(0, { desiredUnitPrice: '95.00' })).toBe('0.00');
  });

  it('stores a typed proposal half-up on its decimal digits, not the binary 1.00 (#417)', () => {
    expect(carriedProposal(1.005, null)).toBe('1.01');
  });

  it('a new line without a proposal has none', () => {
    expect(carriedProposal(undefined, null)).toBeNull();
    expect(carriedProposal(12.5, null)).toBe('12.50');
  });
});

describe('referenceInputsUnchanged — whether a paired line keeps its stored reference', () => {
  const stored = {
    productId: P1,
    variantId: V1,
    quantity: 10,
    packagingUnitName: 'Paleta',
    packagingUnitBaseQuantity: 5,
  };

  it('is true when product, variant, quantity and packaging unit are all equal', () => {
    expect(referenceInputsUnchanged(stored, { ...stored })).toBe(true);
    expect(
      referenceInputsUnchanged(
        { ...stored, variantId: null, packagingUnitName: null, packagingUnitBaseQuantity: null },
        { productId: P1, quantity: 10 },
      ),
    ).toBe(true);
  });

  it('FR-031 (b) — the same unit id is the same unit, whatever it is called now', () => {
    const withId = { ...stored, packagingUnitId: 'unit-pallet' };
    expect(referenceInputsUnchanged(withId, { ...withId, packagingUnitName: 'Paleta EUR' })).toBe(true);
    expect(referenceInputsUnchanged(withId, { ...withId, packagingUnitId: 'unit-other' })).toBe(false);
    expect(referenceInputsUnchanged(withId, { ...withId, packagingUnitBaseQuantity: 6 })).toBe(false);
    // Only one side carries an id: the name decides, as before.
    expect(referenceInputsUnchanged(stored, { ...withId, packagingUnitName: 'Paleta EUR' })).toBe(false);
    expect(referenceInputsUnchanged(stored, { ...withId })).toBe(true);
  });

  it('is false when any of them changed', () => {
    expect(referenceInputsUnchanged(stored, { ...stored, quantity: 11 })).toBe(false);
    expect(referenceInputsUnchanged(stored, { ...stored, variantId: V2 })).toBe(false);
    expect(referenceInputsUnchanged(stored, { ...stored, packagingUnitName: 'Karton' })).toBe(false);
    expect(referenceInputsUnchanged(stored, { ...stored, packagingUnitBaseQuantity: 6 })).toBe(false);
    expect(referenceInputsUnchanged(stored, { ...stored, productId: P2 })).toBe(false);
  });
});
