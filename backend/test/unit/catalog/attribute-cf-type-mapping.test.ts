import { describe, expect, it } from 'vitest';

import {
  cfToLegacyValueType,
  legacyToCfType,
} from '../../../src/modules/catalog/services/attribute-type-mapping.js';
import {
  dbToApiAttributeType,
  resolveAttributeApiType,
} from '../../../src/modules/catalog/services/catalog-admin.service.js';

/**
 * T015 (feature 061) — full round-trip of the research §R7 map:
 *
 *   legacy `value_type`  ⇄  (cf `value_type`, select_display, numeric_kind)
 *
 * plus the API forms (`type=slider` + `numericKind`) that layer on top of the
 * legacy 8-value form (feature 002 mapping preserved byte-for-byte).
 */

const R7_MAP = [
  { legacy: 'string', cf: 'text', selectDisplay: null, numericKind: null },
  { legacy: 'number', cf: 'number', selectDisplay: null, numericKind: 'number' },
  { legacy: 'price', cf: 'number', selectDisplay: null, numericKind: 'price' },
  { legacy: 'boolean', cf: 'boolean', selectDisplay: null, numericKind: null },
  { legacy: 'date', cf: 'date', selectDisplay: null, numericKind: null },
  { legacy: 'enum', cf: 'select', selectDisplay: 'pill', numericKind: null },
  { legacy: 'select', cf: 'select', selectDisplay: 'dropdown', numericKind: null },
  { legacy: 'multiselect', cf: 'multiselect', selectDisplay: null, numericKind: null },
] as const;

describe('research §R7 type map (feature 061, T015)', () => {
  it.each(R7_MAP)('legacy $legacy → cf triple and back', (entry) => {
    const triple = legacyToCfType(entry.legacy);
    expect(triple).toEqual({
      cfValueType: entry.cf,
      selectDisplay: entry.selectDisplay,
      numericKind: entry.numericKind,
    });
    expect(
      cfToLegacyValueType(triple.cfValueType, triple.selectDisplay, triple.numericKind),
    ).toBe(entry.legacy);
  });

  it('is bijective across all eight legacy values', () => {
    const triples = R7_MAP.map((e) => JSON.stringify(legacyToCfType(e.legacy)));
    expect(new Set(triples).size).toBe(R7_MAP.length);
  });

  it('defaults a bare cf "number" (no refinement) to legacy "number"', () => {
    expect(cfToLegacyValueType('number', null, null)).toBe('number');
  });

  it('defaults a bare cf "select" (no refinement) to legacy "select"', () => {
    expect(cfToLegacyValueType('select', null, null)).toBe('select');
  });

  it('round-trips the API slider form: type=slider + numericKind=price', () => {
    const resolved = resolveAttributeApiType({ type: 'slider', numericKind: 'price' });
    expect(resolved).toEqual({ valueType: 'price', displayAsSlider: true });
    const triple = legacyToCfType(resolved.valueType);
    expect(triple).toEqual({ cfValueType: 'number', selectDisplay: null, numericKind: 'price' });
    const legacy = cfToLegacyValueType(triple.cfValueType, triple.selectDisplay, triple.numericKind);
    expect(dbToApiAttributeType(legacy, true)).toEqual({ type: 'slider', numericKind: 'price' });
  });

  it('round-trips the API slider form: type=slider + numericKind=number', () => {
    const resolved = resolveAttributeApiType({ type: 'slider', numericKind: 'number' });
    expect(resolved).toEqual({ valueType: 'number', displayAsSlider: true });
    const triple = legacyToCfType(resolved.valueType);
    expect(triple).toEqual({ cfValueType: 'number', selectDisplay: null, numericKind: 'number' });
    const legacy = cfToLegacyValueType(triple.cfValueType, triple.selectDisplay, triple.numericKind);
    expect(dbToApiAttributeType(legacy, false)).toEqual({ type: 'number', numericKind: null });
  });

  it('round-trips the API select form (type=select → legacy enum → pill)', () => {
    const resolved = resolveAttributeApiType({ type: 'select' });
    expect(resolved.valueType).toBe('enum');
    expect(legacyToCfType('enum')).toEqual({
      cfValueType: 'select',
      selectDisplay: 'pill',
      numericKind: null,
    });
    expect(dbToApiAttributeType('enum', false).type).toBe('select');
  });
});
