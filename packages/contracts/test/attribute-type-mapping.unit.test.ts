import { describe, expect, it } from 'vitest';
import {
  apiAttributeTypeOf,
  apiAttributeTypeSchema,
  attributeValueTypeSchema,
  type ApiAttributeType,
  type AttributeValueType,
} from '../src/catalog.js';

/**
 * The one definition of the stored attribute value type → API attribute type
 * projection (`specs/134-paid-module-extraction/research.md` D19 §1).
 *
 * `catalog` derives the `type` of every attribute it reads from this function,
 * and every PIM connector derives from it the type it compares a binding
 * candidate against. It used to be written once per module and pinned by seam
 * tests that named two modules each; with one definition there is no seam, and
 * this file is the surviving driver of
 * `backend/test/unit/pim_unopim/attribute-type-mapping.test.ts` and of the
 * agreement block of `backend/test/unit/pim_ergonode/attribute-type-mapping.test.ts`.
 *
 * The expected table is written out rather than derived, so a change to the
 * projection is a deliberate edit here and not a silent drift.
 */
const EXPECTED: Record<AttributeValueType, { plain: ApiAttributeType; slider: ApiAttributeType }> = {
  string: { plain: 'input', slider: 'input' },
  number: { plain: 'number', slider: 'slider' },
  boolean: { plain: 'input', slider: 'input' },
  enum: { plain: 'select', slider: 'select' },
  date: { plain: 'input', slider: 'input' },
  multiselect: { plain: 'multiselect', slider: 'multiselect' },
  price: { plain: 'price', slider: 'slider' },
  select: { plain: 'select', slider: 'select' },
};

describe('apiAttributeTypeOf', () => {
  it('has an expectation for every stored value type', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...attributeValueTypeSchema.options].sort());
  });

  for (const valueType of attributeValueTypeSchema.options) {
    for (const displayAsSlider of [false, true]) {
      it(`maps ${valueType} / displayAsSlider=${String(displayAsSlider)}`, () => {
        const expected = displayAsSlider ? EXPECTED[valueType].slider : EXPECTED[valueType].plain;
        expect(apiAttributeTypeOf(valueType, displayAsSlider)).toBe(expected);
      });
    }
  }

  it('only ever answers a member of the API attribute type enum', () => {
    for (const valueType of attributeValueTypeSchema.options) {
      for (const displayAsSlider of [false, true]) {
        expect(apiAttributeTypeSchema.options).toContain(
          apiAttributeTypeOf(valueType, displayAsSlider),
        );
      }
    }
  });
});
