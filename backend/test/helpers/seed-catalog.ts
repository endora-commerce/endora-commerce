import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../../src/modules/catalog/entities/product.entity.js';
import { Category } from '../../src/modules/catalog/entities/category.entity.js';
import { AttributeSetAttribute } from '../../src/modules/catalog/entities/attribute-set-attribute.entity.js';
import { createAttributeFixture } from '../../src/modules/catalog/seeds/attribute-fixtures.js';
import { SalesChannel } from '../../src/kernel/sales-channels/sales-channel.entity.js';

// Feature 061 — attribute fixtures create the product-host Custom Field
// definition + catalog extension pair; re-export the helpers so test files
// keep their fixture edits mechanical.
export {
  createAttributeFixture,
  findAttributeDefinitionByKey,
  findAttributeExtensionByKey,
} from '../../src/modules/catalog/seeds/attribute-fixtures.js';

/** Fixed UUIDs for the three seeded Products — the RFQ tests reference these directly. */
export const SEED_PRODUCT_101_ID = '00000000-0000-4000-8000-000000000101';
export const SEED_PRODUCT_102_ID = '00000000-0000-4000-8000-000000000102';
export const SEED_PRODUCT_103_ID = '00000000-0000-4000-8000-000000000103';

/**
 * Minimum seed for US1 public catalog tests.
 *
 * - Two Sales Channels: `pl_retail` (public) and `pl_b2b_vip` (non-public).
 * - Three categories in a 2-level tree.
 * - Four ProductAttributes: `color` (filterable), `internal_sku_notes`
 *   (searchable but NOT filterable — used by T046 + T048 to prove the toggle
 *   path), `material` (filterable enum), `certification` (not-yet-filterable —
 *   exercised by T055 hot swap).
 * - Three active Products attached to both channels, with fixed UUIDs so RFQ
 *   tests (T049, T054) can reference them directly.
 */
export async function seedUs1Catalog(em: EntityManager): Promise<void> {
  // --- Sales Channels ----------------------------------------------------
  const retail = em.create(SalesChannel, {
    code: 'pl_retail',
    name: { 'pl-PL': 'PL Retail', 'en-US': 'PL Retail' },
    isPublic: true,
    defaultLanguage: 'pl-PL',
    defaultCurrency: 'PLN',
  });
  const b2bVip = em.create(SalesChannel, {
    code: 'pl_b2b_vip',
    name: { 'pl-PL': 'PL B2B VIP', 'en-US': 'PL B2B VIP' },
    isPublic: false,
    defaultLanguage: 'pl-PL',
    defaultCurrency: 'PLN',
  });
  await em.persistAndFlush([retail, b2bVip]);

  // --- Categories --------------------------------------------------------
  const root = em.create(Category, {
    name: { 'en-US': 'Widgets', 'pl-PL': 'Widżety' },
    slug: 'widgets',
  });
  await em.persistAndFlush(root);
  const childA = em.create(Category, {
    parentCategoryId: root.id,
    name: { 'en-US': 'Small widgets', 'pl-PL': 'Małe widżety' },
    slug: 'small-widgets',
  });
  const childB = em.create(Category, {
    parentCategoryId: root.id,
    name: { 'en-US': 'Large widgets', 'pl-PL': 'Duże widżety' },
    slug: 'large-widgets',
  });
  await em.persistAndFlush([childA, childB]);

  // --- Attributes --------------------------------------------------------
  // Feature 061 — each fixture creates the product-host Custom Field
  // definition + the catalog extension pair. Option sortOrder 0 for every
  // option matches the pre-061 seed shape (ties break by value ASC).
  const { extension: color } = await createAttributeFixture(em, {
    key: 'color',
    label: { 'en-US': 'Color', 'pl-PL': 'Kolor' },
    labelDefault: 'Color',
    valueType: 'enum',
    isSearchable: true,
    isFilterable: true,
    sortOrder: 0,
    options: ['red', 'green', 'blue'].map((v) => ({ value: v, sortOrder: 0 })),
  });
  const { extension: internalNotes } = await createAttributeFixture(em, {
    key: 'internal_sku_notes',
    label: { 'en-US': 'Internal SKU notes', 'pl-PL': 'Notatki wewnętrzne' },
    labelDefault: 'Internal SKU notes',
    valueType: 'string',
    isSearchable: true,
    sortOrder: 1,
  });
  const { extension: material } = await createAttributeFixture(em, {
    key: 'material',
    label: { 'en-US': 'Material', 'pl-PL': 'Materiał' },
    labelDefault: 'Material',
    valueType: 'enum',
    isFilterable: true,
    sortOrder: 2,
    options: ['steel', 'aluminium', 'plastic'].map((v) => ({ value: v, sortOrder: 0 })),
  });
  const { extension: certification } = await createAttributeFixture(em, {
    key: 'certification',
    label: { 'en-US': 'Certification', 'pl-PL': 'Certyfikat' },
    labelDefault: 'Certification',
    valueType: 'string',
    sortOrder: 3,
  });

  // Feature 002 (T023) — assign every seeded attribute to the system
  // Default Attribute Set so the catalog-admin's attribute-values
  // validation accepts these keys for the seeded Products. Membership is
  // definition-keyed since feature 061.
  const DEFAULT_ATTRIBUTE_SET_ID = 'defa0017-0000-4000-8000-000000000000';
  await em.persistAndFlush(
    [color, internalNotes, material, certification].map((attr, idx) =>
      em.create(AttributeSetAttribute, {
        attributeSetId: DEFAULT_ATTRIBUTE_SET_ID,
        customFieldDefinitionId: attr.customFieldDefinitionId,
        position: idx,
      }),
    ),
  );

  // --- Products ----------------------------------------------------------
  const exampleSimple = em.create(Product, {
    id: SEED_PRODUCT_101_ID,
    sku: 'EXAMPLE-SIMPLE-001',
    slug: 'example-simple-product',
    type: 'simple',
    status: 'active',
    name: { 'en-US': 'Example simple product', 'pl-PL': 'Przykładowy produkt prosty' },
    description: {
      'en-US': 'Reference product used across US1 contract and integration tests.',
      'pl-PL': 'Produkt referencyjny używany w testach US1.',
    },
    visibility: 'public',
    attributeValues: {
      color: 'red',
      material: 'steel',
      certification: 'ISO9001',
      defaultPrice: 19.99,
    },
  });
  const exampleB = em.create(Product, {
    id: SEED_PRODUCT_102_ID,
    sku: 'EXAMPLE-BLUE-002',
    slug: 'example-blue-product',
    type: 'simple',
    status: 'active',
    name: { 'en-US': 'Example blue product', 'pl-PL': 'Przykładowy produkt niebieski' },
    description: {
      'en-US': 'Another product used to test filter facets and search.',
      'pl-PL': 'Produkt do testów filtrów i wyszukiwarki.',
    },
    visibility: 'public',
    attributeValues: {
      color: 'blue',
      material: 'aluminium',
      defaultPrice: 24.5,
    },
  });
  const exampleC = em.create(Product, {
    id: SEED_PRODUCT_103_ID,
    sku: 'EXAMPLE-LARGE-003',
    slug: 'example-large-product',
    type: 'simple',
    status: 'active',
    name: { 'en-US': 'Example large product', 'pl-PL': 'Przykładowy duży produkt' },
    description: {
      'en-US': 'Large-category product — category filter integration test coverage.',
      'pl-PL': 'Produkt przypisany do dużych widżetów.',
    },
    visibility: 'public',
    attributeValues: { color: 'green', material: 'plastic', defaultPrice: 39 },
  });
  await em.persistAndFlush([exampleSimple, exampleB, exampleC]);

  // --- Associations (M:N bridges authored via raw SQL to avoid a relation graph) ---
  const conn = em.getConnection();
  await conn.execute(
    `insert into product_categories (product_id, category_id) values (?,?), (?,?), (?,?), (?,?)`,
    [
      exampleSimple.id, childA.id,
      exampleB.id, childA.id,
      exampleC.id, childB.id,
      exampleC.id, root.id,
    ],
  );
  await conn.execute(
    `insert into sales_channel_products (sales_channel_id, product_id) values (?,?), (?,?), (?,?), (?,?), (?,?), (?,?)`,
    [
      retail.id, exampleSimple.id,
      retail.id, exampleB.id,
      retail.id, exampleC.id,
      b2bVip.id, exampleSimple.id,
      b2bVip.id, exampleB.id,
      b2bVip.id, exampleC.id,
    ],
  );
  await conn.execute(
    `insert into sales_channel_categories (sales_channel_id, category_id) values (?,?), (?,?), (?,?), (?,?), (?,?), (?,?)`,
    [
      retail.id, root.id,
      retail.id, childA.id,
      retail.id, childB.id,
      b2bVip.id, root.id,
      b2bVip.id, childA.id,
      b2bVip.id, childB.id,
    ],
  );
}
