import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_CAPABILITIES,
  attributeMatches,
  enabledCapabilities,
  valueTypeLabelKey,
  type AttributeListEntry,
} from './attribute-list.js';

const entry = (overrides: Partial<AttributeListEntry> = {}): AttributeListEntry => ({
  key: 'material',
  label: { 'en-US': 'Material', 'pl-PL': 'Materiał' },
  labelDefault: 'Material',
  valueType: 'string',
  isSearchable: false,
  isFilterable: false,
  isVariantAxis: false,
  isComparable: false,
  massEditable: false,
  quickSearchable: false,
  isPromoRule: false,
  isPriceRule: false,
  ...overrides,
});

describe('attributeMatches (issue #1527)', () => {
  it('matches everything on an empty search and any type', () => {
    expect(attributeMatches(entry(), { query: '', valueType: '' })).toBe(true);
  });

  it('matches the key and every label, ignoring case, diacritics and surrounding spaces', () => {
    expect(attributeMatches(entry(), { query: 'MATER', valueType: '' })).toBe(true);
    expect(attributeMatches(entry(), { query: '  material ', valueType: '' })).toBe(true);
    // Postel: "material" typed without the Polish stroked l still finds the Polish label.
    expect(attributeMatches(entry({ key: 'x', labelDefault: 'x', label: { 'pl-PL': 'Materiał' } }), { query: 'materia', valueType: '' })).toBe(true);
    expect(attributeMatches(entry({ key: 'x', labelDefault: 'x', label: { 'pl-PL': 'Materiał' } }), { query: 'material', valueType: '' })).toBe(true);
    expect(attributeMatches(entry(), { query: 'colour', valueType: '' })).toBe(false);
  });

  it('narrows by type', () => {
    expect(attributeMatches(entry(), { query: '', valueType: 'string' })).toBe(true);
    expect(attributeMatches(entry(), { query: '', valueType: 'select' })).toBe(false);
  });
});

describe('enabledCapabilities', () => {
  it('lists the switched-on capabilities in the fixed column order', () => {
    expect(enabledCapabilities(entry({ isPriceRule: true, isSearchable: true }))).toEqual(['isSearchable', 'isPriceRule']);
    expect(enabledCapabilities(entry())).toEqual([]);
    expect(ATTRIBUTE_CAPABILITIES).toHaveLength(8);
  });
});

describe('valueTypeLabelKey', () => {
  it('names every value type with a translation key, never the raw enum', () => {
    expect(valueTypeLabelKey('page_builder')).toBe('attributes.type.pageBuilder');
    expect(valueTypeLabelKey('multiselect')).toBe('attributes.type.multiselect');
  });
});
