import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  packagingMismatchError,
  resolveLinePackaging,
  type PackagingUnitCandidate,
} from './packaging-resolution.js';

/**
 * Feature 155, Phase 10 (T075) — a buyer's quote line names its packaging unit
 * by id, or by name and base quantity, and is resolved against the catalogue
 * before anything is written (FR-026, FR-027; `contracts/quote-requests-api.md`
 * §1; threat F6).
 */

const B = 'product-b';
const C = 'product-c';
const PALLET_B: PackagingUnitCandidate = { id: 'unit-b-pallet', productId: B, name: 'Pallet', baseQuantity: 64 };
const BOX_B: PackagingUnitCandidate = { id: 'unit-b-box', productId: B, name: 'Box', baseQuantity: 12 };
const PALLET_C: PackagingUnitCandidate = { id: 'unit-c-pallet', productId: C, name: 'Pallet', baseQuantity: 50 };
const UNITS = [PALLET_B, BOX_B, PALLET_C];

describe('resolveLinePackaging', () => {
  it('a line with no packaging reference is plain pieces', () => {
    const { lines, mismatches } = resolveLinePackaging([{ productId: B }], UNITS);
    expect(mismatches).toEqual([]);
    expect(lines).toEqual([{ packagingUnitId: null, packagingUnitName: null, packagingUnitBaseQuantity: null }]);
  });

  it('an id of a unit of the line’s product stores the catalogue name and base quantity', () => {
    const { lines, mismatches } = resolveLinePackaging([{ productId: B, packagingUnitId: PALLET_B.id }], UNITS);
    expect(mismatches).toEqual([]);
    expect(lines[0]).toEqual({ packagingUnitId: PALLET_B.id, packagingUnitName: 'Pallet', packagingUnitBaseQuantity: 64 });
  });

  it('the id wins over a name and base quantity the line also sent', () => {
    const { lines, mismatches } = resolveLinePackaging(
      [{ productId: B, packagingUnitId: PALLET_B.id, packagingUnitName: 'Box', packagingUnitBaseQuantity: 50 }],
      UNITS,
    );
    expect(mismatches).toEqual([]);
    expect(lines[0]).toEqual({ packagingUnitId: PALLET_B.id, packagingUnitName: 'Pallet', packagingUnitBaseQuantity: 64 });
  });

  it('name + matching base quantity, no id, resolves to that unit', () => {
    const { lines, mismatches } = resolveLinePackaging(
      [{ productId: B, packagingUnitName: 'Pallet', packagingUnitBaseQuantity: 64 }],
      UNITS,
    );
    expect(mismatches).toEqual([]);
    expect(lines[0]).toEqual({ packagingUnitId: PALLET_B.id, packagingUnitName: 'Pallet', packagingUnitBaseQuantity: 64 });
  });

  it('name + a base quantity the unit does not have → base_quantity_mismatch', () => {
    const { mismatches } = resolveLinePackaging(
      [{ productId: B, packagingUnitName: 'Pallet', packagingUnitBaseQuantity: 50 }],
      UNITS,
    );
    expect(mismatches).toEqual([expect.objectContaining({ index: 0, productId: B, reason: 'base_quantity_mismatch' })]);
  });

  it('a name the product does not have → name_unknown (another product’s unit name included)', () => {
    const { mismatches } = resolveLinePackaging(
      [
        { productId: B, packagingUnitName: 'Crate', packagingUnitBaseQuantity: 64 },
        { productId: C, packagingUnitName: 'Box', packagingUnitBaseQuantity: 12 },
      ],
      UNITS,
    );
    expect(mismatches.map((m) => [m.index, m.reason])).toEqual([
      [0, 'name_unknown'],
      [1, 'name_unknown'],
    ]);
  });

  it('a name without a base quantity is treated as a base-quantity mismatch', () => {
    const { mismatches } = resolveLinePackaging([{ productId: B, packagingUnitName: 'Pallet' }], UNITS);
    expect(mismatches).toEqual([expect.objectContaining({ index: 0, reason: 'base_quantity_mismatch' })]);
  });

  it('a base quantity without a name or an id is a packaging reference that names no unit', () => {
    const { mismatches } = resolveLinePackaging([{ productId: B, packagingUnitBaseQuantity: 64 }], UNITS);
    expect(mismatches).toEqual([expect.objectContaining({ index: 0, reason: 'name_unknown' })]);
  });

  it('an unknown id, a deleted unit’s id and another product’s unit id give the one reason unknown_unit [F6]', () => {
    const deletedUnitId = 'unit-b-deleted';
    const { mismatches } = resolveLinePackaging(
      [
        { productId: B, packagingUnitId: 'unit-never-existed' },
        { productId: B, packagingUnitId: deletedUnitId },
        { productId: B, packagingUnitId: PALLET_C.id },
      ],
      UNITS,
    );
    expect(mismatches.map((m) => m.reason)).toEqual(['unknown_unit', 'unknown_unit', 'unknown_unit']);
    // The distinction exists only for the logger.
    expect(mismatches[2]!.cause).toBe('unit_of_another_product');
    expect(mismatches[0]!.cause).toBe('not_a_current_unit');
  });

  it('lists every failing line, in input order, and still resolves the good ones', () => {
    const { lines, mismatches } = resolveLinePackaging(
      [
        { productId: B, packagingUnitId: 'nope' },
        { productId: B, packagingUnitId: BOX_B.id },
        { productId: C, packagingUnitName: 'Pallet', packagingUnitBaseQuantity: 64 },
      ],
      UNITS,
    );
    expect(mismatches.map((m) => m.index)).toEqual([0, 2]);
    expect(lines[1]).toEqual({ packagingUnitId: BOX_B.id, packagingUnitName: 'Box', packagingUnitBaseQuantity: 12 });
  });
});

/**
 * Feature 163, Phase 22 (T138; FR-079; owner decision 2026-10-26) — the line
 * snapshots the unit's name at the request's scope language: its translation
 * there, else the global name. The **name match** of a line naming its unit
 * stays on the global name.
 */
describe('resolveLinePackaging — the unit name at the scope language (163)', () => {
  const TRANSLATED: PackagingUnitCandidate = {
    ...PALLET_B,
  };

  it('an id-named unit stores its translation at the scope language', () => {
    const { lines } = resolveLinePackaging([{ productId: B, packagingUnitId: TRANSLATED.id }], [TRANSLATED], 'pl-PL');
    expect(lines).toEqual([{ packagingUnitId: TRANSLATED.id, packagingUnitName: 'Paleta', packagingUnitBaseQuantity: 64 }]);
  });

  it('a unit named by its global name still matches, and stores the translation', () => {
    const { lines, mismatches } = resolveLinePackaging(
      [{ productId: B, packagingUnitName: 'Pallet', packagingUnitBaseQuantity: 64 }],
      [TRANSLATED],
      'pl-pl',
    );
    expect(mismatches).toEqual([]);
    expect(lines[0]!.packagingUnitName).toBe('Paleta');
  });

  it('the translated name is not a name a line can match by', () => {
    const { mismatches } = resolveLinePackaging(
      [{ productId: B, packagingUnitName: 'Paleta', packagingUnitBaseQuantity: 64 }],
      [TRANSLATED],
      'pl-PL',
    );
    expect(mismatches.map((m) => m.reason)).toEqual(['name_unknown']);
  });

  it('no scope language, or one without a translation, stores the global name', () => {
    // The scope language is a channel language (`scopeLanguageOf`), matched exactly, case aside.
    const line = [{ productId: B, packagingUnitId: TRANSLATED.id }];
    expect(resolveLinePackaging(line, [TRANSLATED], null).lines[0]!.packagingUnitName).toBe('Pallet');
    expect(resolveLinePackaging(line, [TRANSLATED], 'de').lines[0]!.packagingUnitName).toBe('Pallet');
    expect(resolveLinePackaging(line, [TRANSLATED]).lines[0]!.packagingUnitName).toBe('Pallet');
  });
});

describe('packagingMismatchError', () => {
  const names = new Map([
    [B, 'Brick'],
    [C, 'Cement'],
  ]);

  it('is 422 PACKAGING_UNIT_MISMATCH naming the first failing line, with every line and no cause', () => {
    const { mismatches } = resolveLinePackaging(
      [
        { productId: B },
        { productId: C, packagingUnitId: PALLET_B.id },
        { productId: B, packagingUnitName: 'Pallet', packagingUnitBaseQuantity: 50 },
      ],
      UNITS,
    );
    const error = packagingMismatchError(mismatches, names);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe(ERROR_CODES.PACKAGING_UNIT_MISMATCH);
    expect(error.details).toEqual({
      lineNumber: 2,
      productName: 'Cement',
      lines: [
        { index: 1, productId: C, productName: 'Cement', reason: 'unknown_unit' },
        { index: 2, productId: B, productName: 'Brick', reason: 'base_quantity_mismatch' },
      ],
    });
    expect(JSON.stringify(error.details)).not.toContain('unit_of_another_product');
  });
});
