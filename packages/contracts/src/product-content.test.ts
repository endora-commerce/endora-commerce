import { describe, expect, it } from 'vitest';
import * as admin from './admin-contributions.js';
import * as assets from './assets-library.js';
import * as catalog from './catalog.js';
import * as cf from './custom-fields.js';

/**
 * `specs/172-product-content-attributes/` (data-model §3–§4) — the contract
 * half of product content attributes: the `page_builder` value type in all
 * three attribute vocabularies, the shared 1 MiB ceiling, the envelope and the
 * admin and storefront shapes, the asset reference kind and the editor zone.
 */

const UUID = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const OTHER_UUID = '6f1b1a3e-7a0a-4c1e-9d51-2f2b0b6f8a10';

function accepts(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(true);
}

function rejects(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

/**
 * An envelope whose JSON serialisation is exactly `bytes` UTF-8 bytes long.
 * The skeleton `{"languages":{"en-US":{"t":""}}}` is padded with ASCII.
 */
function envelopeOfBytes(bytes: number): { languages: Record<string, Record<string, string>> } {
  const skeleton = JSON.stringify({ languages: { 'en-US': { t: '' } } }).length;
  return { languages: { 'en-US': { t: 'x'.repeat(bytes - skeleton) } } };
}

describe('the page_builder value type', () => {
  it('is a member of all three attribute type vocabularies', () => {
    expect(cf.customFieldValueTypeSchema.options).toContain('page_builder');
    expect(catalog.attributeValueTypeSchema.options).toContain('page_builder');
    expect(catalog.apiAttributeTypeSchema.options).toContain('page_builder');
  });

  it('maps to the page_builder API type whatever the slider flag says', () => {
    expect(catalog.apiAttributeTypeOf('page_builder', false)).toBe('page_builder');
    expect(catalog.apiAttributeTypeOf('page_builder', true)).toBe('page_builder');
  });

  it('admits no list-filter operator', () => {
    expect(cf.CUSTOM_FIELD_FILTER_OPERATORS.page_builder).toEqual([]);
  });

  it('has a definition failure code for an entity type that does not take it', () => {
    expect(cf.CUSTOM_FIELD_DEFINITION_ERROR_CODES).toContain('value_type_unsupported');
    expect(
      cf.isCustomFieldDefinitionFailure({
        name: 'CustomFieldDefinitionError',
        code: 'value_type_unsupported',
        message: 'x',
      }),
    ).toBe(true);
  });
});

describe('the Page Builder content ceiling', () => {
  it('is one mebibyte, shared with category content', () => {
    expect(catalog.PAGE_BUILDER_CONTENT_MAX_BYTES).toBe(1_048_576);
    expect(catalog.CATEGORY_CONTENT_MAX_BYTES).toBe(catalog.PAGE_BUILDER_CONTENT_MAX_BYTES);
  });
});

describe('productContentEnvelopeSchema', () => {
  it('accepts an envelope of languages, and null for no value', () => {
    accepts(catalog.productContentEnvelopeSchema, { languages: { 'en-US': { root: { props: {} }, content: [] } } });
    accepts(catalog.productContentEnvelopeSchema, { languages: {} });
    accepts(catalog.productContentEnvelopeSchema, null);
  });

  it('is strict, and refuses a language code outside 2–35 characters', () => {
    rejects(catalog.productContentEnvelopeSchema, { languages: {}, extra: 1 });
    rejects(catalog.productContentEnvelopeSchema, { languages: { e: {} } });
    rejects(catalog.productContentEnvelopeSchema, { languages: { ['x'.repeat(36)]: {} } });
    rejects(catalog.productContentEnvelopeSchema, { languages: { 'en-US': 'not a tree' } });
  });

  it('accepts exactly the ceiling in UTF-8 bytes and refuses one byte more, naming the limit', () => {
    const atLimit = envelopeOfBytes(1_048_576);
    expect(JSON.stringify(atLimit).length).toBe(1_048_576);
    accepts(catalog.productContentEnvelopeSchema, atLimit);

    const overLimit = envelopeOfBytes(1_048_577);
    const result = catalog.productContentEnvelopeSchema.safeParse(overLimit);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join(' ')).toContain('1048576');
  });

  it('counts UTF-8 bytes, not UTF-16 units', () => {
    // "ż" is one UTF-16 unit and two UTF-8 bytes.
    const skeleton = JSON.stringify({ languages: { 'pl-PL': { t: '' } } }).length;
    const chars = Math.ceil((1_048_576 - skeleton) / 2) + 1;
    rejects(catalog.productContentEnvelopeSchema, { languages: { 'pl-PL': { t: 'ż'.repeat(chars) } } });
  });
});

describe('admin product content shapes', () => {
  it('putProductContentRequestSchema is strict and takes an envelope or null', () => {
    accepts(catalog.putProductContentRequestSchema, { content: { languages: { 'en-US': {} } } });
    accepts(catalog.putProductContentRequestSchema, { content: null });
    rejects(catalog.putProductContentRequestSchema, {});
    rejects(catalog.putProductContentRequestSchema, { content: null, extra: true });
  });

  it('adminProductContentSchema carries the product, the key and the envelope', () => {
    accepts(catalog.adminProductContentSchema, { productId: UUID, attributeKey: 'buying_guide', content: null });
    accepts(catalog.adminProductContentSchema, {
      productId: UUID,
      attributeKey: 'buying_guide',
      content: { languages: { 'en-US': {} } },
    });
    rejects(catalog.adminProductContentSchema, { productId: 'nope', attributeKey: 'k', content: null });
  });

  it('adminProductContentListSchema carries summaries, never documents', () => {
    const list = {
      productId: UUID,
      attributeSetId: OTHER_UUID,
      attributes: [
        {
          attributeId: OTHER_UUID,
          key: 'buying_guide',
          label: { 'en-US': 'Buying guide' },
          labelDefault: 'Buying guide',
          position: 3,
          languages: [{ language: 'en-US', filled: true, blocks: 4, excerpt: 'Choosing…' }],
        },
      ],
    };
    accepts(catalog.adminProductContentListSchema, list);
    accepts(catalog.adminProductContentListSchema, { productId: UUID, attributeSetId: null, attributes: [] });
    rejects(catalog.adminProductContentListSchema, {
      ...list,
      attributes: [{ ...list.attributes[0], languages: [{ language: 'en-US', filled: true, blocks: -1, excerpt: null }] }],
    });
  });

  it('adminAttributeUsageSchema carries three non-negative counts', () => {
    accepts(catalog.adminAttributeUsageSchema, { attributeSetCount: 0, productValueCount: 2, productContentCount: 12 });
    rejects(catalog.adminAttributeUsageSchema, { attributeSetCount: -1, productValueCount: 0, productContentCount: 0 });
    rejects(catalog.adminAttributeUsageSchema, { attributeSetCount: 0, productValueCount: 0 });
  });
});

describe('storefront product content shapes', () => {
  it('productPageContentAttributeSchema carries the key, the resolved language and one document, no label', () => {
    const parsed = catalog.productPageContentAttributeSchema.parse({
      key: 'buying_guide',
      language: 'pl-PL',
      content: { root: { props: {} }, content: [] },
      label: 'dropped',
    });
    expect(parsed).toEqual({ key: 'buying_guide', language: 'pl-PL', content: { root: { props: {} }, content: [] } });
  });

  it('productDetailQuerySchema accepts include=content or nothing, and refuses anything else', () => {
    accepts(catalog.productDetailQuerySchema, {});
    accepts(catalog.productDetailQuerySchema, { include: 'content' });
    rejects(catalog.productDetailQuerySchema, { include: 'other' });
  });

  it('productDetailSchema.contentAttributes is optional', () => {
    const shape = catalog.productDetailSchema.shape;
    expect(shape.contentAttributes).toBeDefined();
    expect(shape.contentAttributes.safeParse(undefined).success).toBe(true);
    expect(
      shape.contentAttributes.safeParse([{ key: 'k', language: 'en-US', content: { content: [] } }]).success,
    ).toBe(true);
  });
});

describe('the asset reference kind and the editor zone', () => {
  it('names product content as an asset reference kind', () => {
    expect(assets.assetReferenceKindSchema.options).toContain('product_content');
  });

  it('declares the product content editor zone', () => {
    expect(admin.AdminZoneNameSchema.options).toContain('product.content.editor');
  });
});
