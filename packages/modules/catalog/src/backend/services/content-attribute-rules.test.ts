import { describe, expect, it } from 'vitest';
import { HttpError } from '@endora-commerce/platform/http';
import {
  CONTENT_ATTRIBUTE_LOCKED_FLAGS,
  assertContentAttributeShape,
  assertTypeChangeAllowed,
} from './content-attribute-rules.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, research R-6): a Page
 * Builder content attribute holds every capability that makes no sense for a
 * document off, and its type never moves to or from `page_builder` (FR-003,
 * FR-005).
 *
 * Feature 174 (`specs/174-product-editor-scope-switcher/`, FR-012) replaced the
 * channel and language scope flags with one `scopable` flag. A content
 * attribute's languages are its document envelope's, never scoped values, so
 * `scopable` is a locked capability (FR-040's per-channel refusal), and FR-004's
 * "always language-scoped" is the envelope itself — there is no flag left to hold.
 */

const FLAGS = [
  'isSearchable',
  'isFilterable',
  'isVariantAxis',
  'displayAsSlider',
  'isComparable',
  'quickSearchable',
  'isPromoRule',
  'isPriceRule',
  'massEditable',
  'isRequired',
  'isVisibleOnProductPage',
  'scopable',
] as const;

function thrown(run: () => unknown): HttpError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
  throw new Error('expected a refusal');
}

describe('assertContentAttributeShape', () => {
  it('names exactly the twelve locked capabilities', () => {
    expect([...CONTENT_ATTRIBUTE_LOCKED_FLAGS].sort()).toEqual([...FLAGS].sort());
  });

  for (const flag of FLAGS) {
    it(`refuses ${flag}: true, naming it`, () => {
      const error = thrown(() => assertContentAttributeShape({ [flag]: true }));
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual([{ path: flag, issue: 'not available for Page Builder content' }]);
    });
  }

  it('gives one detail per offending flag', () => {
    const error = thrown(() =>
      assertContentAttributeShape({ isSearchable: true, massEditable: true, scopable: false }),
    );
    expect((error.details as Array<{ path: string }>).map((detail) => detail.path)).toEqual([
      'isSearchable',
      'massEditable',
    ]);
  });

  it('accepts every flag off or omitted', () => {
    expect(() => assertContentAttributeShape({})).not.toThrow();
    const allOff = Object.fromEntries(FLAGS.map((flag) => [flag, false]));
    expect(() => assertContentAttributeShape(allOff)).not.toThrow();
  });
});

describe('assertTypeChangeAllowed', () => {
  it('refuses a change to page_builder', () => {
    const error = thrown(() => assertTypeChangeAllowed('string', 'page_builder'));
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('The value type of a Page Builder content attribute cannot be changed.');
  });

  it('refuses a change from page_builder', () => {
    expect(thrown(() => assertTypeChangeAllowed('page_builder', 'select')).statusCode).toBe(409);
  });

  it('allows a page_builder attribute to keep its type, and any other change', () => {
    expect(() => assertTypeChangeAllowed('page_builder', 'page_builder')).not.toThrow();
    expect(() => assertTypeChangeAllowed('string', 'number')).not.toThrow();
    expect(() => assertTypeChangeAllowed('enum', 'select')).not.toThrow();
  });
});
