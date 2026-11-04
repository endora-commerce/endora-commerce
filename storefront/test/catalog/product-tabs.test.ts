import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { productTabPlan, type ProductTabPresence, type ProductTabSource } from '../../lib/catalog/product-tabs';

/**
 * Feature 172 — the product page's tab decisions, taken by one pure function
 * so they can be pinned without rendering the RSC page (research R-18).
 */

const ATTACHMENT = {
  id: '00000000-0000-4000-8000-000000000001',
  position: 0,
  name: 'Datasheet',
  description: null,
  type: { id: '00000000-0000-4000-8000-000000000002', code: 'datasheet', name: { 'en-US': 'Datasheet' } },
  asset: {
    id: '00000000-0000-4000-8000-000000000003',
    kind: 'pdf',
    url: '/a.pdf',
    filename: 'a.pdf',
    sizeBytes: 10,
    mimeType: 'application/pdf',
  },
};

/**
 * A product as the page holds it. `attributeValues` is the raw value bag —
 * the plan must never read it, so it is here only to prove that.
 */
type Product = ProductTabSource & { attributeValues?: Record<string, string | number | boolean> };

function product(overrides: Partial<Product> = {}): Product {
  return {
    description: '',
    attributeValues: {},
    visibleAttributes: [],
    attachments: [],
    ...overrides,
  };
}

/** Every module present: the presence most products are rendered under. */
const PRESENT: ProductTabPresence = { pageBuilderPresent: true, absentModuleIds: [] };

const VISIBLE = { key: 'material', label: 'Material', valueType: 'select' as const, valueRendered: 'Brass' };

describe('productTabPlan — "Opis" (description)', () => {
  it('is present when the description is non-empty, and holds it', () => {
    expect(productTabPlan(product({ description: 'A sturdy drill.' }), PRESENT).description).toEqual({
      text: 'A sturdy drill.',
      content: [],
    });
  });

  it('is absent when the description is empty', () => {
    expect(productTabPlan(product({ description: '' }), PRESENT).description).toBeNull();
  });
});

describe('productTabPlan — "Załączniki" (attachments)', () => {
  it('counts the attachments', () => {
    expect(productTabPlan(product({ attachments: [ATTACHMENT, { ...ATTACHMENT, position: 1 }] }), PRESENT).attachments).toBe(2);
  });

  it('is absent with no attachments, or when the field is missing', () => {
    expect(productTabPlan(product({ attachments: [] }), PRESENT).attachments).toBeNull();
    expect(productTabPlan(product({ attachments: undefined }), PRESENT).attachments).toBeNull();
  });
});

describe('productTabPlan — "Parametry" (feature 172, US4: FR-038, FR-039)', () => {
  it('holds the visible attributes, and only them', () => {
    expect(
      productTabPlan(product({ attributeValues: { material: 'brass', supplier_code: 'X-1' }, visibleAttributes: [VISIBLE] }), PRESENT)
        .parameters,
    ).toEqual([VISIBLE]);
  });

  it('is absent for a product whose only values are hidden ones', () => {
    expect(
      productTabPlan(product({ attributeValues: { supplier_code: 'X-1' }, visibleAttributes: [] }), PRESENT).parameters,
    ).toBeNull();
  });

  it('is absent when the projection is missing', () => {
    expect(productTabPlan(product({ attributeValues: { supplier_code: 'X-1' }, visibleAttributes: undefined }), PRESENT).parameters).toBeNull();
  });
});

/**
 * Feature 172 (US3: FR-030, FR-031, FR-032, research R-20 (4)) — the content
 * attributes join "Opis" below the plain description, in the order the
 * backend sent them, and make the tab appear on their own. A content attribute
 * counts only when it would draw something here: at least one top-level block
 * with no owner segment, or whose owner module is not switched off.
 */
const block = (type: string): Record<string, unknown> => ({ type, props: { id: type } });
const content = (key: string, ...types: string[]) => ({
  key,
  language: 'en-US',
  content: { root: { props: {} }, content: types.map(block) },
});

describe('productTabPlan — "Opis" with content attributes (feature 172, US3)', () => {
  const GUIDE = content('buying_guide', 'cms.RichContent');
  const BANNER = content('banner', 'Heading');

  it('description only: the text, no content', () => {
    expect(productTabPlan(product({ description: 'Plain.' }), PRESENT).description).toEqual({
      text: 'Plain.',
      content: [],
    });
  });

  it('content only: the tab is shown, with no text (FR-031)', () => {
    expect(productTabPlan(product({ description: '', contentAttributes: [GUIDE] }), PRESENT).description).toEqual({
      text: null,
      content: [GUIDE],
    });
  });

  it('both: the text, then the content in the order received (FR-030)', () => {
    expect(
      productTabPlan(product({ description: 'Plain.', contentAttributes: [BANNER, GUIDE] }), PRESENT).description,
    ).toEqual({ text: 'Plain.', content: [BANNER, GUIDE] });
  });

  it('neither: no tab', () => {
    expect(productTabPlan(product({ description: '', contentAttributes: [] }), PRESENT).description).toBeNull();
    expect(productTabPlan(product({ description: '', contentAttributes: undefined }), PRESENT).description).toBeNull();
  });

  it('keeps a document whose blocks belong only to switched-off modules out, and with it the tab', () => {
    const offOnly = content('specs', 'blog.LatestPosts', 'forms.Form');
    const presence: ProductTabPresence = { pageBuilderPresent: true, absentModuleIds: ['blog', 'forms'] };
    expect(productTabPlan(product({ description: '', contentAttributes: [offOnly] }), presence).description).toBeNull();
    expect(
      productTabPlan(product({ description: 'Plain.', contentAttributes: [offOnly, GUIDE] }), presence).description,
    ).toEqual({ text: 'Plain.', content: [GUIDE] });
  });

  it('counts a document with at least one drawable block: a base block, or one of a present module', () => {
    const mixed = content('mixed', 'blog.LatestPosts', 'Heading');
    const presence: ProductTabPresence = { pageBuilderPresent: true, absentModuleIds: ['blog'] };
    expect(productTabPlan(product({ contentAttributes: [mixed] }), presence).description?.content).toEqual([mixed]);
  });

  it('never puts content in "Parametry" (FR-032)', () => {
    const plan = productTabPlan(product({ contentAttributes: [GUIDE], visibleAttributes: [VISIBLE] }), PRESENT);
    expect(plan.parameters).toEqual([VISIBLE]);
    expect(JSON.stringify(plan.parameters)).not.toContain('buying_guide');
    expect(productTabPlan(product({ contentAttributes: [GUIDE] }), PRESENT).parameters).toBeNull();
  });
});

describe('productTabPlan — the CMS switched off (feature 172, US5: FR-051)', () => {
  const OFF: ProductTabPresence = { pageBuilderPresent: false, absentModuleIds: ['cms'] };
  const GUIDE = content('buying_guide', 'cms.RichContent');
  const BANNER = content('banner', 'Heading');

  it('draws no content, even a document of base blocks only', () => {
    expect(
      productTabPlan(product({ description: 'Plain.', contentAttributes: [GUIDE, BANNER] }), OFF).description,
    ).toEqual({ text: 'Plain.', content: [] });
  });

  it('gives a content-only product no "Opis"', () => {
    expect(productTabPlan(product({ description: '', contentAttributes: [GUIDE, BANNER] }), OFF).description).toBeNull();
  });

  it('leaves the plain description, "Parametry" and "Załączniki" as they are', () => {
    const source = product({ description: 'Plain.', contentAttributes: [GUIDE], visibleAttributes: [VISIBLE] });
    const on = productTabPlan(source, PRESENT);
    const off = productTabPlan(source, OFF);
    expect(off.description?.text).toBe(on.description?.text);
    expect(off.parameters).toEqual(on.parameters);
    expect(off.attachments).toEqual(on.attachments);
  });

  it('is fed by the request’s presence of the CMS on the product page', () => {
    // The backend omits the content too (research R-13); the page's own check
    // closes the window in which a cached product read still carries it.
    const page = readFileSync(resolve(import.meta.dirname, '../../app/(catalog)/p/[slug]/page.tsx'), 'utf8');
    expect(page).toMatch(/pageBuilderPresent:\s*modules\.isPresent\('cms'\)/);
  });
});

