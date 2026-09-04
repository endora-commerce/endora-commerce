import { describe, expect, it } from 'vitest';
import {
  ComparableAttributeProjection,
  classifyRow,
  formatForDisplay,
  type ComparableAttributeDefinition,
} from './comparable-attribute-projection.js';

/**
 * T017 — projection rules per research.md R-6. No DB; pure functions.
 * Covers scalar equality, multiselect set equality, missing-on-one-side
 * → 'different', null in the values array, all-products-equal → 'common'.
 *
 * Feature 061 — the projection input is the `ComparableAttributeDefinition`
 * slice of the composed view (no catalog entity import).
 */

const SUT = new ComparableAttributeProjection();

function attr(partial: {
  key: string;
  valueType: ComparableAttributeDefinition['valueType'];
  label?: Record<string, string>;
}): ComparableAttributeDefinition {
  return {
    key: partial.key,
    label: partial.label ?? { en: partial.key, pl: partial.key },
    valueType: partial.valueType,
  };
}

describe('classifyRow', () => {
  it('returns common when all values are equal scalars', () => {
    expect(classifyRow('number', [10, 10, 10])).toBe('common');
    expect(classifyRow('string', ['Red', 'Red'])).toBe('common');
    expect(classifyRow('boolean', [true, true, true])).toBe('common');
  });

  it('returns different when at least one scalar disagrees', () => {
    expect(classifyRow('number', [10, 11, 10])).toBe('different');
    expect(classifyRow('string', ['Red', 'red'])).toBe('different');
    expect(classifyRow('boolean', [true, false])).toBe('different');
  });

  it('treats string equality after trim', () => {
    expect(classifyRow('string', [' Red ', 'Red'])).toBe('common');
  });

  it('treats numeric equality across numeric and price types', () => {
    expect(classifyRow('number', [1.0, '1', 1])).toBe('common');
    expect(classifyRow('price', ['9.50', 9.5])).toBe('common');
    expect(classifyRow('price', [9.5, 9.51])).toBe('different');
  });

  it('classifies missing on either side as different', () => {
    expect(classifyRow('number', [10, null])).toBe('different');
    expect(classifyRow('string', ['Red', undefined])).toBe('different');
    expect(classifyRow('multiselect', [['red'], []])).toBe('different');
    expect(classifyRow('string', ['Red', '   '])).toBe('different');
  });

  it('treats multiselect equality as set equality (order-insensitive)', () => {
    expect(classifyRow('multiselect', [['red', 'blue'], ['blue', 'red']])).toBe(
      'common',
    );
    expect(classifyRow('multiselect', [['red'], ['red', 'blue']])).toBe(
      'different',
    );
  });

  it('returns common for 0 or 1 product (no disagreement possible)', () => {
    expect(classifyRow('string', [])).toBe('common');
    expect(classifyRow('string', ['Red'])).toBe('common');
  });

  it('normalises dates to ISO before comparing', () => {
    expect(
      classifyRow('date', ['2026-01-01', '2026-01-01T00:00:00.000Z']),
    ).toBe('common');
    expect(
      classifyRow('date', ['2026-01-01', '2026-01-02']),
    ).toBe('different');
  });
});

describe('formatForDisplay', () => {
  it('returns null for missing values (renders as — on the storefront)', () => {
    expect(formatForDisplay('string', null)).toBeNull();
    expect(formatForDisplay('string', undefined)).toBeNull();
    expect(formatForDisplay('multiselect', [])).toBeNull();
    expect(formatForDisplay('string', '   ')).toBeNull();
  });

  it('joins multiselect values sorted by display string', () => {
    expect(formatForDisplay('multiselect', ['red', 'blue'])).toBe(
      'blue, red',
    );
  });

  it('coerces booleans into "true" / "false" stable strings', () => {
    expect(formatForDisplay('boolean', true)).toBe('true');
    expect(formatForDisplay('boolean', false)).toBe('false');
  });

  it('numeric formatting strips redundant precision', () => {
    expect(formatForDisplay('number', '1.0')).toBe('1');
    expect(formatForDisplay('price', 9.5)).toBe('9.5');
  });

  it('trims string values', () => {
    expect(formatForDisplay('string', ' Red ')).toBe('Red');
  });
});

describe('ComparableAttributeProjection.projectRows', () => {
  const weight = attr({ key: 'weight_kg', valueType: 'number' });
  const colors = attr({ key: 'colors', valueType: 'multiselect' });
  const material = attr({ key: 'material', valueType: 'string' });

  it('emits one row per attribute definition in the supplied order', () => {
    const products = [
      { attributeValues: { weight_kg: 10, colors: ['red'], material: 'Steel' } },
      { attributeValues: { weight_kg: 10, colors: ['red'], material: 'Steel' } },
    ];
    const rows = SUT.projectRows(products, [weight, colors, material]);
    expect(rows.map((r) => r.key)).toEqual(['weight_kg', 'colors', 'material']);
    expect(rows.every((r) => r.rowClass === 'common')).toBe(true);
  });

  it('emits one value per product per row, preserving column order', () => {
    const products = [
      { attributeValues: { weight_kg: 10 } },
      { attributeValues: { weight_kg: 12 } },
      { attributeValues: { weight_kg: 10 } },
    ];
    const rows = SUT.projectRows(products, [weight]);
    expect(rows[0]!.values).toEqual(['10', '12', '10']);
    expect(rows[0]!.rowClass).toBe('different');
  });

  it('renders missing values as null (storefront/PDF render —)', () => {
    const products = [
      { attributeValues: { material: 'Steel' } },
      { attributeValues: { material: undefined } },
    ];
    const rows = SUT.projectRows(products, [material]);
    expect(rows[0]!.values).toEqual(['Steel', null]);
    expect(rows[0]!.rowClass).toBe('different');
  });

  it('handles all-products-have-no-value as different (no spurious common)', () => {
    const products = [
      { attributeValues: {} },
      { attributeValues: {} },
    ];
    const rows = SUT.projectRows(products, [material]);
    expect(rows[0]!.values).toEqual([null, null]);
    expect(rows[0]!.rowClass).toBe('different');
  });
});
