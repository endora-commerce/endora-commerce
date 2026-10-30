import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  bulkUpdateProductsRequestSchema,
  type CatalogPackagingUnitRecord,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  createPackagingUnitRequestSchema,
  createProductRequestSchema,
  packagingUnitSchema,
  productDetailSchema,
  productSummarySchema,
  updatePackagingUnitRequestSchema,
  updateProductRequestSchema,
} from './catalog.js';

/**
 * Feature 155 (FR-001, FR-002, FR-016; threat F5) — the catalogue request and DTO shapes
 * gain the pieces minimum, the packaging-unit minimum and the returnable flag, bounded
 * 1…1 000 000 (`contracts/catalog-api.md` §0–§4).
 */

const OUT_OF_RANGE = [0, -1, 1.5, 1_000_001];
const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
const UNIT_ID = '00000000-0000-4000-8000-000000000002';

describe('updateProductRequestSchema', () => {
  it.each([1, 10, 1_000_000, null])('accepts minOrderQuantity %s', (value) => {
    const parsed = updateProductRequestSchema.parse({ minOrderQuantity: value });
    expect(parsed.minOrderQuantity).toBe(value);
  });

  it.each(OUT_OF_RANGE)('refuses minOrderQuantity %s', (value) => {
    expect(updateProductRequestSchema.safeParse({ minOrderQuantity: value }).success).toBe(false);
  });

  it.each([true, false])('accepts returnable %s', (value) => {
    expect(updateProductRequestSchema.parse({ returnable: value }).returnable).toBe(value);
  });

  it('refuses a non-boolean returnable', () => {
    expect(updateProductRequestSchema.safeParse({ returnable: 'yes' }).success).toBe(false);
  });

  it('still parses a body without either key', () => {
    const parsed = updateProductRequestSchema.parse({ visibility: 'public' });
    expect(parsed).not.toHaveProperty('minOrderQuantity');
    expect(parsed).not.toHaveProperty('returnable');
  });
});

describe('createProductRequestSchema', () => {
  const base = {
    sku: 'SKU-1',
    type: 'simple',
    name: 'Bolt',
    description: null,
    categoryIds: [],
    attributeValues: {},
    visibility: 'public',
  };

  it('accepts both keys on create', () => {
    const parsed = createProductRequestSchema.parse({ ...base, minOrderQuantity: 10, returnable: false });
    expect(parsed.minOrderQuantity).toBe(10);
    expect(parsed.returnable).toBe(false);
  });

  it('refuses minOrderQuantity 1 000 001 on create', () => {
    expect(createProductRequestSchema.safeParse({ ...base, minOrderQuantity: 1_000_001 }).success).toBe(
      false,
    );
  });
});

describe('bulkUpdateProductsRequestSchema', () => {
  it('accepts returnable as the only field', () => {
    const parsed = bulkUpdateProductsRequestSchema.parse({
      productIds: [PRODUCT_ID],
      fields: { returnable: false },
    });
    expect(parsed.fields.returnable).toBe(false);
  });

  it('still refuses an empty field set', () => {
    expect(
      bulkUpdateProductsRequestSchema.safeParse({ productIds: [PRODUCT_ID], fields: {} }).success,
    ).toBe(false);
  });
});

describe('packaging-unit requests', () => {
  it.each([1, 3, 1_000_000, null])('create accepts minOrderUnits %s', (value) => {
    const parsed = createPackagingUnitRequestSchema.parse({
      name: 'Pallet',
      baseQuantity: 64,
      minOrderUnits: value,
    });
    expect(parsed.minOrderUnits).toBe(value);
  });

  it.each(OUT_OF_RANGE)('create refuses minOrderUnits %s', (value) => {
    expect(
      createPackagingUnitRequestSchema.safeParse({ name: 'Pallet', baseQuantity: 64, minOrderUnits: value })
        .success,
    ).toBe(false);
  });

  it.each([1, 1_000_000, null])('update accepts minOrderUnits %s', (value) => {
    expect(updatePackagingUnitRequestSchema.parse({ minOrderUnits: value }).minOrderUnits).toBe(value);
  });

  it.each(OUT_OF_RANGE)('update refuses minOrderUnits %s', (value) => {
    expect(updatePackagingUnitRequestSchema.safeParse({ minOrderUnits: value }).success).toBe(false);
  });

  it('both still refuse an unknown key (strict)', () => {
    expect(
      createPackagingUnitRequestSchema.safeParse({ name: 'Pallet', baseQuantity: 64, minOrderQty: 2 }).success,
    ).toBe(false);
    expect(updatePackagingUnitRequestSchema.safeParse({ minOrderQty: 2 }).success).toBe(false);
  });
});

describe('packaging-unit and product DTOs', () => {
  const unitDto = {
    id: UNIT_ID,
    productId: PRODUCT_ID,
    name: 'Pallet',
    baseQuantity: 64,
    position: 0,
    isDefault: false,
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
  };

  it('packagingUnitSchema parses with and without minOrderUnits', () => {
    expect(packagingUnitSchema.parse(unitDto)).not.toHaveProperty('minOrderUnits');
    expect(packagingUnitSchema.parse({ ...unitDto, minOrderUnits: 2 }).minOrderUnits).toBe(2);
    expect(packagingUnitSchema.parse({ ...unitDto, minOrderUnits: null }).minOrderUnits).toBeNull();
  });

  const summary = {
    id: PRODUCT_ID,
    sku: 'SKU-1',
    type: 'simple',
    name: 'Bolt',
    slug: 'bolt',
    categorySlugs: [],
    primaryAssetUrl: null,
    price: null,
    stockIndicator: null,
    stockLevel: null,
  };

  it('productSummarySchema parses with and without minOrderQuantity', () => {
    expect(productSummarySchema.parse(summary)).not.toHaveProperty('minOrderQuantity');
    expect(productSummarySchema.parse({ ...summary, minOrderQuantity: 10 }).minOrderQuantity).toBe(10);
    expect(productSummarySchema.parse({ ...summary, minOrderQuantity: null }).minOrderQuantity).toBeNull();
  });

  const detail = {
    ...summary,
    description: '',
    attributeValues: {},
    assets: [],
    variants: [],
    categories: [],
    seo: {
      metaTitle: 'Bolt',
      metaDescription: '',
      openGraph: { title: 'Bolt', description: '', imageUrl: null },
    },
    // Feature 163 — the page's paths, required on the detail since then.
    paths: { canonical: '/p/bolt', alternates: [], xDefault: '/p/bolt' },
    structuredDataJsonLd: {},
  };

  it('productDetailSchema parses with and without the new keys, incl. packagingUnits[].minOrderUnits', () => {
    const before = productDetailSchema.safeParse(detail);
    expect(before.success, JSON.stringify(before.error?.issues)).toBe(true);

    const pdpUnit = { id: UNIT_ID, name: 'Pallet', baseQuantity: 64, position: 0, isDefault: true };
    const parsed = productDetailSchema.parse({
      ...detail,
      minOrderQuantity: 10,
      packagingUnits: [
        { ...pdpUnit, minOrderUnits: 2 },
        { ...pdpUnit, id: PRODUCT_ID, minOrderUnits: null },
        { ...pdpUnit, id: '00000000-0000-4000-8000-000000000003' },
      ],
    });
    expect(parsed.minOrderQuantity).toBe(10);
    expect(parsed.packagingUnits?.map((u) => u.minOrderUnits)).toEqual([2, null, undefined]);
  });
});

/**
 * Feature 155 (R7, `contracts/catalog-api.md` §5) — the read-port records carry the rule
 * data as **required** fields, and the port gains the batch packaging-unit read. These
 * are type-level assertions: each `@ts-expect-error` is unused — and therefore a
 * type-check failure — the moment a field or the method becomes optional or goes away.
 */
describe('catalogue read-port records and port (type level)', () => {
  const productRecord: CatalogProductRecord = {
    id: PRODUCT_ID,
    sku: 'SKU-1',
    slug: 'bolt',
    type: 'simple',
    status: 'active',
    name: 'Bolt',
    description: null,
    stockMode: null,
    visibility: 'public',
    attributeValues: {},
    allowedOrganizationIds: [],
    attributeSetId: '00000000-0000-4000-8000-000000000004',
    downloadAssetId: null,
    downloadUrl: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    deletedAt: null,
    manageStock: false,
    backorderEnabled: false,
    lowStockThreshold: null,
    lowStockThresholdMode: 'cumulative',
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    minOrderQuantity: 10,
    returnable: true,
  };

  const unitRecord: CatalogPackagingUnitRecord = {
    id: UNIT_ID,
    productId: PRODUCT_ID,
    name: 'Pallet',
    baseQuantity: 64,
    position: 0,
    isDefault: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    minOrderUnits: 2,
  };

  it('CatalogProductRecord requires minOrderQuantity and returnable', () => {
    const { minOrderQuantity: _min, ...withoutMinimum } = productRecord;
    const { returnable: _flag, ...withoutFlag } = productRecord;
    // @ts-expect-error — `minOrderQuantity` is required (null means "no minimum").
    const missingMinimum: CatalogProductRecord = withoutMinimum;
    // @ts-expect-error — `returnable` is required.
    const missingFlag: CatalogProductRecord = withoutFlag;
    expect([missingMinimum, missingFlag]).toHaveLength(2);
    expectTypeOf<CatalogProductRecord['minOrderQuantity']>().toEqualTypeOf<number | null>();
    expectTypeOf<CatalogProductRecord['returnable']>().toEqualTypeOf<boolean>();
  });

  it('CatalogPackagingUnitRecord requires minOrderUnits', () => {
    const { minOrderUnits: _min, ...withoutMinimum } = unitRecord;
    // @ts-expect-error — `minOrderUnits` is required (null means "no minimum").
    const missingMinimum: CatalogPackagingUnitRecord = withoutMinimum;
    expect(missingMinimum).toBeDefined();
    expectTypeOf<CatalogPackagingUnitRecord['minOrderUnits']>().toEqualTypeOf<number | null>();
  });

  it('CatalogProductReadPort requires listPackagingUnitsByProductIds', () => {
    expectTypeOf<CatalogProductReadPort['listPackagingUnitsByProductIds']>().toEqualTypeOf<
      (productIds: readonly string[]) => Promise<CatalogPackagingUnitRecord[]>
    >();
    type WithoutBatchUnits = Omit<CatalogProductReadPort, 'listPackagingUnitsByProductIds'>;
    const partial = {} as WithoutBatchUnits;
    // @ts-expect-error — the batch packaging-unit read is a required member of the port.
    const port: CatalogProductReadPort = partial;
    expect(port).toBeDefined();
  });
});
