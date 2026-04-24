import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../../src/modules/catalog/entities/product.entity.js';
import { Category } from '../../src/modules/catalog/entities/category.entity.js';
import { ProductAttribute } from '../../src/modules/catalog/entities/product-attribute.entity.js';
import { SalesChannel } from '../../src/modules/catalog/entities/sales-channel.entity.js';

/**
 * Minimum seed for US1 public catalog tests.
 *
 * - Two Sales Channels: `pl_retail` (public) and `pl_b2b_vip` (non-public).
 * - Three categories in a 2-level tree.
 * - Four ProductAttributes: `color` (filterable), `internal_sku_notes`
 *   (searchable but NOT filterable — used by T046 + T048 to prove the toggle
 *   path), `material` (filterable enum), `certification` (not-yet-filterable —
 *   exercised by T055 hot swap).
 * - Three active Products attached to both channels (a few with specific
 *   slugs the contract tests rely on — `example-simple-product`, etc.).
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
  const color = em.create(ProductAttribute, {
    key: 'color',
    label: { 'en-US': 'Color', 'pl-PL': 'Kolor' },
    valueType: 'enum',
    enumValues: ['red', 'green', 'blue'],
    isSearchable: true,
    isFilterable: true,
    isVariantAxis: false,
  });
  const internalNotes = em.create(ProductAttribute, {
    key: 'internal_sku_notes',
    label: { 'en-US': 'Internal SKU notes', 'pl-PL': 'Notatki wewnętrzne' },
    valueType: 'string',
    isSearchable: true,
    isFilterable: false,
    isVariantAxis: false,
  });
  const material = em.create(ProductAttribute, {
    key: 'material',
    label: { 'en-US': 'Material', 'pl-PL': 'Materiał' },
    valueType: 'enum',
    enumValues: ['steel', 'aluminium', 'plastic'],
    isSearchable: false,
    isFilterable: true,
    isVariantAxis: false,
  });
  const certification = em.create(ProductAttribute, {
    key: 'certification',
    label: { 'en-US': 'Certification', 'pl-PL': 'Certyfikat' },
    valueType: 'string',
    isSearchable: false,
    isFilterable: false,
    isVariantAxis: false,
  });
  await em.persistAndFlush([color, internalNotes, material, certification]);

  // --- Products ----------------------------------------------------------
  const exampleSimple = em.create(Product, {
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
      defaultPrice: 19.99,
    },
  });
  const exampleB = em.create(Product, {
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
}
