import { describe, expect, it } from 'vitest';
import * as catalog from './catalog.js';
import {
  bulkUpdateProductsRequestSchema,
  createProductRequestSchema,
  productStatusSchema,
  resolveProductIdsRequestSchema,
  updateProductRequestSchema,
} from './catalog.js';
import { SetProductStatusParamsSchema } from './prompt-actions.js';
import { quickOrderSearchResultSchema } from './quick-order.js';

/**
 * Feature 163, spec Session 2026-10-25 (Q1, O-1) — the product status is `active` |
 * `inactive` at every scope. `draft` is gone and the legacy `archived` write alias
 * (feature 032) is refused rather than mapped: archiving is its own action
 * (FR-010, FR-019, FR-112; research R30.3–R30.5).
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const C = '00000000-0000-4000-8000-0000000000c1';

const CREATE_BASE = {
  sku: 'SKU-1',
  type: 'simple',
  name: 'One',
  description: 'One',
  categoryIds: [],
  attributeValues: {},
  visibility: 'public',
} as const;

describe('productStatusSchema (FR-010, FR-112)', () => {
  it('is active / inactive', () => {
    expect(productStatusSchema.options).toEqual(['active', 'inactive']);
  });

  it.each(['draft', 'archived'])('refuses %s', (value) => {
    expect(productStatusSchema.safeParse(value).success).toBe(false);
  });
});

describe('the legacy write alias is gone (O-1)', () => {
  it('exports neither coerceProductStatusWrite nor productStatusWriteSchema', () => {
    expect('coerceProductStatusWrite' in catalog).toBe(false);
    expect('productStatusWriteSchema' in catalog).toBe(false);
  });
});

describe('writes refuse draft and archived (FR-112)', () => {
  it.each(['draft', 'archived'])('create refuses status %s on the status path', (status) => {
    const parsed = createProductRequestSchema.safeParse({ ...CREATE_BASE, status });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path[0] === 'status')).toBe(true);
  });

  it.each(['active', 'inactive'])('create accepts status %s', (status) => {
    expect(createProductRequestSchema.safeParse({ ...CREATE_BASE, status }).success).toBe(true);
  });

  it.each(['draft', 'archived'])('update refuses status %s and does not map it', (status) => {
    const parsed = updateProductRequestSchema.safeParse({ status });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path[0] === 'status')).toBe(true);
  });

  it('update keeps inactive as inactive', () => {
    expect(updateProductRequestSchema.parse({ status: 'inactive' }).status).toBe('inactive');
  });

  it.each(['draft', 'archived'])('resolve-ids refuses status %s', (status) => {
    expect(resolveProductIdsRequestSchema.safeParse({ status }).success).toBe(false);
  });

  it.each(['draft', 'archived'])('bulk fields.status refuses %s', (status) => {
    expect(
      bulkUpdateProductsRequestSchema.safeParse({ productIds: [P], fields: { status } }).success,
    ).toBe(false);
  });

  it.each(['draft', 'archived'])('bulk fields.scopedStatus.value refuses %s', (value) => {
    expect(
      bulkUpdateProductsRequestSchema.safeParse({
        productIds: [P],
        fields: { scopedStatus: { channelId: C, languageCode: null, value } },
      }).success,
    ).toBe(false);
  });

  it('bulk fields.scopedStatus.value still accepts inherit', () => {
    expect(
      bulkUpdateProductsRequestSchema.safeParse({
        productIds: [P],
        fields: { scopedStatus: { channelId: C, languageCode: 'de-DE', value: 'inherit' } },
      }).success,
    ).toBe(true);
  });
});

describe('resolve-ids — the archived mode (R30.4)', () => {
  it.each(['exclude', 'include', 'only'])('accepts archived: %s', (archived) => {
    expect(resolveProductIdsRequestSchema.safeParse({ archived }).success).toBe(true);
  });

  it('refuses an unknown archived mode', () => {
    expect(resolveProductIdsRequestSchema.safeParse({ archived: 'all' }).success).toBe(false);
  });

  it('keeps the legacy includeArchived flag', () => {
    expect(resolveProductIdsRequestSchema.safeParse({ includeArchived: false }).success).toBe(true);
  });
});

describe('bulk fields.archived — Archive / Restore on the bulk path (FR-053, R30.3)', () => {
  it.each([true, false])('accepts archived: %s alone', (archived) => {
    expect(
      bulkUpdateProductsRequestSchema.safeParse({ productIds: [P], fields: { archived } }).success,
    ).toBe(true);
  });

  it.each([
    ['status', { status: 'active' }],
    ['visibility', { visibility: 'public' }],
    ['returnable', { returnable: true }],
    ['attributeSetId', { attributeSetId: P }],
    ['attributeValues', { attributeValues: { color: 'red' } }],
    ['categories', { categories: { mode: 'add', categoryIds: [P] } }],
    ['salesChannels', { salesChannels: { mode: 'add', channelIds: [C] } }],
    ['scopedStatus', { scopedStatus: { channelId: C, languageCode: null, value: 'active' } }],
  ])('refuses archived beside %s, on the archived path', (_name, other) => {
    const parsed = bulkUpdateProductsRequestSchema.safeParse({
      productIds: [P],
      fields: { archived: true, ...other },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path.includes('archived'))).toBe(true);
  });

  it('refuses a non-boolean archived', () => {
    expect(
      bulkUpdateProductsRequestSchema.safeParse({ productIds: [P], fields: { archived: 'yes' } }).success,
    ).toBe(false);
  });
});

describe('other typed consumers drop draft (R30.5)', () => {
  it('the assistant status tool takes active / inactive only', () => {
    expect(
      SetProductStatusParamsSchema.safeParse({ productIds: [P], status: 'draft' }).success,
    ).toBe(false);
    expect(
      SetProductStatusParamsSchema.safeParse({ productIds: [P], status: 'inactive' }).success,
    ).toBe(true);
  });

  it('a quick-order search result carries active / inactive only', () => {
    const base = { productId: P, sku: 'S', name: 'N', slug: 's' };
    expect(quickOrderSearchResultSchema.safeParse({ ...base, status: 'draft' }).success).toBe(false);
    expect(quickOrderSearchResultSchema.safeParse({ ...base, status: 'active' }).success).toBe(true);
  });
});
