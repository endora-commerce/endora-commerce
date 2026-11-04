import { describe, expect, it } from 'vitest';
import type { CatalogAttributeView } from './catalog-attribute-read.service.js';
import { contentAttributeMembers, languageStatuses } from './product-content.service.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-020, FR-030,
 * FR-061, research R-16) — which content attributes a product carries, and in
 * what order: the `page_builder` members of its **current** attribute set, by
 * set position, ties broken by key. Membership is definition-keyed, as every
 * set read is (feature 061).
 */

const view = (key: string, valueType: string): CatalogAttributeView =>
  ({
    id: `ext-${key}`,
    customFieldDefinitionId: `def-${key}`,
    key,
    label: { 'en-US': `EN ${key}` },
    labelDefault: `EN ${key}`,
    valueType,
  }) as unknown as CatalogAttributeView;

const VIEWS = [
  view('guide', 'page_builder'),
  view('banner', 'page_builder'),
  view('tie_b', 'page_builder'),
  view('tie_a', 'page_builder'),
  view('outside', 'page_builder'),
  view('color', 'enum'),
];

describe('contentAttributeMembers', () => {
  it('keeps the page_builder members of the set, by position then key', () => {
    const members = contentAttributeMembers(
      [
        { custom_field_definition_id: 'def-color', position: 0 },
        { custom_field_definition_id: 'def-guide', position: 3 },
        { custom_field_definition_id: 'def-banner', position: 1 },
        { custom_field_definition_id: 'def-tie_b', position: 2 },
        { custom_field_definition_id: 'def-tie_a', position: 2 },
        { custom_field_definition_id: 'def-gone', position: 4 },
      ],
      VIEWS,
    );
    expect(members.map((member) => member.key)).toEqual(['banner', 'tie_a', 'tie_b', 'guide']);
    expect(members[0]).toEqual({
      attributeId: 'ext-banner',
      key: 'banner',
      label: { 'en-US': 'EN banner' },
      labelDefault: 'EN banner',
      position: 1,
    });
  });

  it('answers nothing for an empty set', () => {
    expect(contentAttributeMembers([], VIEWS)).toEqual([]);
  });
});

describe('languageStatuses', () => {
  it('lists every stored language as filled, by language code', () => {
    expect(
      languageStatuses({
        'pl-PL': { blocks: 2, excerpt: 'Poradnik' },
        'en-US': { blocks: 1, excerpt: null },
      }),
    ).toEqual([
      { language: 'en-US', filled: true, blocks: 1, excerpt: null },
      { language: 'pl-PL', filled: true, blocks: 2, excerpt: 'Poradnik' },
    ]);
  });

  it('answers nothing for no stored value', () => {
    expect(languageStatuses(undefined)).toEqual([]);
  });
});
