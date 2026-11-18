import { describe, expect, it } from 'vitest';
import {
  buildVariantAttributeValues,
  draftFromVariantValues,
  findVariantWithSameValues,
  formatVariantAxisValue,
  pickAttributeLabel,
  selectVariantAxes,
  unknownVariantKeys,
  type VariantAxis,
} from './variant-axes.js';

/**
 * Issue #1457 (UX audit CAT-04) — the Variants tab builds a variant's attribute values from the
 * variant axes of the product's attribute set, not from a free-text `key=value` string.
 */

const COLOR: VariantAxis = {
  id: 'a-color',
  key: 'color',
  label: 'Colour',
  valueType: 'select',
  options: [
    { value: 'red', label: 'Red' },
    { value: 'blue', label: 'Blue' },
  ],
};
const SIZE: VariantAxis = { id: 'a-size', key: 'size', label: 'Size', valueType: 'enum', options: [{ value: 'm', label: 'M' }] };
const WATERPROOF: VariantAxis = { id: 'a-wp', key: 'waterproof', label: 'Waterproof', valueType: 'boolean', options: null };
const LENGTH: VariantAxis = { id: 'a-len', key: 'length', label: 'Length', valueType: 'number', options: null };
const NOTE: VariantAxis = { id: 'a-note', key: 'note', label: 'Note', valueType: 'string', options: null };

const LABELS = { yes: 'Yes', no: 'No', empty: '—' };

describe('pickAttributeLabel', () => {
  it('reads the admin language, then English, then any label, then the fallback', () => {
    expect(pickAttributeLabel({ 'pl-PL': 'Kolor', 'en-US': 'Colour' }, 'color', 'pl')).toBe('Kolor');
    expect(pickAttributeLabel({ 'en-US': 'Colour' }, 'color', 'pl')).toBe('Colour');
    expect(pickAttributeLabel({ 'de-DE': 'Farbe' }, 'color', 'pl')).toBe('Farbe');
    expect(pickAttributeLabel({}, 'color', 'pl')).toBe('color');
  });
});

describe('selectVariantAxes', () => {
  const set = [
    { id: 'a-size', key: 'size', label: { 'en-US': 'Size' }, valueType: 'enum', position: 2 },
    { id: 'a-brand', key: 'brand', label: { 'en-US': 'Brand' }, valueType: 'string', position: 0 },
    { id: 'a-color', key: 'color', label: { 'en-US': 'Colour', 'pl-PL': 'Kolor' }, valueType: 'select', position: 1 },
    { id: 'a-body', key: 'body', label: { 'en-US': 'Body' }, valueType: 'page_builder', position: 3 },
  ];

  it('keeps only the set attributes flagged as variant axes, in set order, labelled in the admin language', () => {
    const axes = selectVariantAxes(set, new Set(['a-size', 'a-color', 'a-other']), 'pl');
    expect(axes.map((a) => [a.key, a.label, a.valueType])).toEqual([
      ['color', 'Kolor', 'select'],
      ['size', 'Size', 'enum'],
    ]);
    expect(axes.every((a) => a.options === null)).toBe(true);
  });

  it('never offers a Page Builder attribute as an axis', () => {
    expect(selectVariantAxes(set, new Set(['a-body']), 'en')).toEqual([]);
  });
});

describe('buildVariantAttributeValues', () => {
  it('stores each axis in its own value type', () => {
    const result = buildVariantAttributeValues([COLOR, WATERPROOF, LENGTH, NOTE], {
      color: 'red',
      waterproof: 'false',
      length: ' 12.5 ',
      note: '  matte  ',
    });
    expect(result).toEqual({ values: { color: 'red', waterproof: false, length: 12.5, note: 'matte' }, missing: [], invalid: [] });
  });

  it('accepts a decimal comma in a number axis (Postel)', () => {
    expect(buildVariantAttributeValues([LENGTH], { length: '7,5' }).values).toEqual({ length: 7.5 });
  });

  it('reports every axis without a value, and a value that is no option or no number', () => {
    const result = buildVariantAttributeValues([COLOR, SIZE, LENGTH, NOTE], { color: 'green', length: 'abc', note: '   ' });
    expect(result.missing).toEqual(['size', 'note']);
    expect(result.invalid).toEqual(['color', 'length']);
  });

  it('keeps a stored key that is no axis, so an edit does not drop data it does not show', () => {
    const result = buildVariantAttributeValues([COLOR], { color: 'blue' }, { legacy: 'x', color: 'red' });
    expect(result.values).toEqual({ legacy: 'x', color: 'blue' });
  });
});

describe('draftFromVariantValues', () => {
  it('reads stored values back into the controls', () => {
    expect(draftFromVariantValues([COLOR, WATERPROOF, LENGTH, NOTE], { color: 'red', waterproof: true, length: 3, extra: 'y' })).toEqual({
      color: 'red',
      waterproof: 'true',
      length: '3',
      note: '',
    });
  });

  it('reads a boolean axis stored as text', () => {
    expect(draftFromVariantValues([WATERPROOF], { waterproof: 'false' })).toEqual({ waterproof: 'false' });
  });
});

describe('formatVariantAxisValue', () => {
  it('shows the option label, Yes or No, the plain value, or the empty mark', () => {
    expect(formatVariantAxisValue(COLOR, 'blue', LABELS)).toBe('Blue');
    expect(formatVariantAxisValue(COLOR, 'teal', LABELS)).toBe('teal');
    expect(formatVariantAxisValue(WATERPROOF, true, LABELS)).toBe('Yes');
    expect(formatVariantAxisValue(WATERPROOF, 'false', LABELS)).toBe('No');
    expect(formatVariantAxisValue(LENGTH, 4, LABELS)).toBe('4');
    expect(formatVariantAxisValue(NOTE, undefined, LABELS)).toBe('—');
    expect(formatVariantAxisValue(NOTE, '', LABELS)).toBe('—');
  });
});

describe('unknownVariantKeys', () => {
  it('lists the stored keys no axis names, once, sorted', () => {
    expect(
      unknownVariantKeys([COLOR], [{ variantAttributeValues: { color: 'red', zeta: 1 } }, { variantAttributeValues: { alpha: 2, zeta: 3 } }]),
    ).toEqual(['alpha', 'zeta']);
  });
});

describe('findVariantWithSameValues', () => {
  const variants = [
    { id: 'v1', sku: 'TEE-RED-M', variantAttributeValues: { color: 'red', size: 'm' } },
    { id: 'v2', sku: 'TEE-BLUE-M', variantAttributeValues: { color: 'blue', size: 'm', legacy: 'x' } },
  ];

  it('finds the variant that already has the same value on every axis', () => {
    expect(findVariantWithSameValues([COLOR, SIZE], variants, { color: 'blue', size: 'm' })?.sku).toBe('TEE-BLUE-M');
    expect(findVariantWithSameValues([COLOR, SIZE], variants, { color: 'blue', size: 'l' })).toBeNull();
  });

  it('ignores the variant being edited', () => {
    expect(findVariantWithSameValues([COLOR, SIZE], variants, { color: 'red', size: 'm' }, 'v1')).toBeNull();
  });

  it('finds nothing when there is no axis to compare', () => {
    expect(findVariantWithSameValues([], variants, {})).toBeNull();
  });
});
