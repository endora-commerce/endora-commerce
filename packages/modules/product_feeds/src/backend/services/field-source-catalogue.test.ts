import { describe, expect, it } from 'vitest';
import {
  buildFieldSourceCatalogue,
  feedableProductFieldDefinitions,
  type ProductFieldDefinition,
} from './field-source-catalogue.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-044, research
 * R-15): a Page Builder content attribute is a document per language, never a
 * feed value. The one filter `listProductFieldDefinitions` applies feeds both
 * the template field picker and the save-time key check, so a content
 * attribute is neither offered nor accepted.
 */

const DEFINITIONS: ProductFieldDefinition[] = [
  { key: 'color', label: 'Colour', description: null, valueType: 'select' },
  { key: 'buying_guide', label: 'Buying guide', description: null, valueType: 'page_builder' },
  { key: 'gtin', label: 'GTIN', description: null, valueType: 'text' },
];

describe('feedableProductFieldDefinitions', () => {
  it('drops every page_builder definition and keeps the rest in order', () => {
    expect(feedableProductFieldDefinitions(DEFINITIONS).map((definition) => definition.key)).toEqual([
      'color',
      'gtin',
    ]);
  });

  it('leaves the field-source catalogue without the content attribute', () => {
    const catalogue = buildFieldSourceCatalogue(feedableProductFieldDefinitions(DEFINITIONS));
    const keys = catalogue.groups.flatMap((group) => group.sources.map((source) => source.sourceKey));
    expect(keys).toContain('color');
    expect(keys).not.toContain('buying_guide');
  });
});
