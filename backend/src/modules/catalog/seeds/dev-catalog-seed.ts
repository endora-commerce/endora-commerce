/**
 * Dev seed (T093 / quickstart §3).
 *
 * Idempotent enough to run repeatedly during a development loop: drops and
 * recreates the public catalog tables, then bulk-inserts:
 *
 *   - 1 public Sales Channel + 1 logged-in-only channel.
 *   - 3-level Category tree (10 leaves total).
 *   - ~10 ProductAttributes (5 filterable, 3 searchable, 2 internal).
 *   - 200 synthetic Products with varied attributes/categories.
 *   - 1 Platform Administrator (admin@demo.local).
 *   - 1 demo Organization with 1 organization_admin Customer.
 *
 * Credentials are printed to stdout so the developer can sign in immediately.
 *
 * NOT for production. Drops business-data tables — refuses to run unless
 * NODE_ENV !== 'production' and the DATABASE_URL points at a localhost or
 * docker-compose host.
 */

import { initOrm, closeOrm } from '../../../db/index.js';
import { Product } from '../entities/product.entity.js';
import { Category } from '../entities/category.entity.js';
import { ProductAttribute } from '../entities/product-attribute.entity.js';
import { AttributeSetAttribute } from '../entities/attribute-set-attribute.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { Megamenu } from '../../megamenu/entities/megamenu.entity.js';
import { MegamenuItem } from '../../megamenu/entities/megamenu-item.entity.js';
import { MegamenuBinding } from '../../megamenu/entities/megamenu-binding.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { AdminUser } from '../../admin_users/entities/admin-user.entity.js';
import { AdminRole } from '../../admin_roles/entities/admin-role.entity.js';
import { DeliveryMethod } from '../../delivery_methods/entities/delivery-method.entity.js';
import { PaymentMethod } from '../../payment_methods/entities/payment-method.entity.js';
import { Tax } from '../../taxes/entities/tax.entity.js';
import { DefaultPriceListMigrator } from '../../price_lists/services/default-price-list-migration.js';
import { hashPassword } from '../../auth/services/password-hasher.js';
import { Warehouse, DEFAULT_WAREHOUSE_ID } from '../../inventory/entities/warehouse.entity.js';
import { WarehouseChannelAssignment } from '../../inventory/entities/warehouse-channel-assignment.entity.js';
import { StockLevel } from '../../inventory/entities/stock-level.entity.js';
import { WarehouseChannelReconciler } from '../../inventory/services/warehouse-channel-reconciler.js';

const DEMO_ADMIN_EMAIL = 'admin@demo.local';
const DEMO_ADMIN_PASSWORD = 'ChangeMe!123';
const DEMO_ORG_NAME = 'Acme B2B (demo)';
const DEMO_ORG_TAX_ID = 'PL5210000099';
const DEMO_BUYER_EMAIL = 'buyer@demo-org.example';
const DEMO_BUYER_PASSWORD = 'ChangeMe!123';

const PRODUCT_COUNT = 200;
const COLOR_VALUES = ['red', 'green', 'blue', 'black', 'white'];
const MATERIAL_VALUES = ['steel', 'aluminium', 'plastic', 'wood', 'glass'];

interface SeedRow<T> {
  data: T;
}

/** Singularized, lower-cased leaf noun for prose (e.g. "Screws" → "screw"). */
function leafNoun(leafNameEn: string): string {
  const lower = leafNameEn.toLowerCase();
  return lower.endsWith('s') ? lower.slice(0, -1) : lower;
}

/**
 * Build a richer, multi-paragraph product description (≥3 paragraphs, 3-4
 * sentences each) so the seeded catalog reads like real merchandising copy
 * rather than a one-line stub. Deterministic — derived purely from the
 * product's own attributes so re-seeding is stable.
 */
function buildProductDescription(input: {
  productName: string;
  leafNameEn: string;
  color: string;
  material: string;
  weightKg: number;
  certification: string | null;
}): string {
  const { productName, leafNameEn, color, material, weightKg, certification } = input;
  const noun = leafNoun(leafNameEn);
  const category = leafNameEn.toLowerCase();

  const overview = [
    `The ${productName} is a professional-grade ${color} ${noun} machined from ${material} for demanding industrial and trade applications.`,
    `It has been designed to deliver consistent performance across high-volume B2B workflows where reliability matters more than anything else.`,
    `Every unit is inspected before dispatch so what arrives on your workbench behaves exactly like the sample you evaluated.`,
    `This makes it a dependable default choice when you standardise your ${category} line across multiple sites.`,
  ].join(' ');

  const specs = [
    `Built from ${material}, the ${noun} balances strength and weight at roughly ${weightKg} kg per unit, keeping handling comfortable without sacrificing durability.`,
    `The ${color} finish resists everyday wear and stays legible on the shelf, which helps warehouse teams pick the right item quickly.`,
    certification
      ? `It ships with ${certification} conformity documentation, so it slots straight into regulated procurement processes.`
      : `It follows our standard internal quality baseline, so tolerances stay predictable from batch to batch.`,
    `Dimensional consistency between batches means downstream assembly steps rarely need rework.`,
  ].join(' ');

  const ordering = [
    `Because this ${noun} is stocked for recurring orders, it is well suited to blanket purchase agreements and scheduled replenishment.`,
    `Volume pricing tiers reward larger baskets, and lead times stay short thanks to steady on-hand inventory.`,
    `Pair it with the related items in the ${category} category to build a complete, compatible kit in a single order.`,
    `If you need a tailored quote for a large project, request one and our team will respond with contract terms.`,
  ].join(' ');

  return `${overview}\n\n${specs}\n\n${ordering}`;
}

/** Deterministic background colour (hex, no #) per leaf slug for demo images. */
function leafImageColor(slug: string): string {
  const palette: Record<string, string> = {
    screws: '1f6feb',
    bolts: '8250df',
    wrenches: 'bf8700',
    drills: 'cf222e',
    cables: '1a7f37',
    sensors: '0969da',
    gloves: 'bc4c00',
    helmets: '6e7781',
  };
  return palette[slug] ?? '30363d';
}

function mustBeNonProduction(): void {
  // The seed is destructive (it truncates the public catalog/business tables),
  // so it refuses NODE_ENV=production by default. A deliberate demo deployment
  // can opt in with ALLOW_DEV_SEED_IN_PRODUCTION=true — this is intentionally a
  // separate, explicit flag so an accidental run never wipes real data.
  const forced = process.env['ALLOW_DEV_SEED_IN_PRODUCTION'] === 'true';
  if (process.env['NODE_ENV'] === 'production' && !forced) {
    throw new Error(
      'refusing to run dev-catalog-seed in NODE_ENV=production ' +
        '(set ALLOW_DEV_SEED_IN_PRODUCTION=true to override — this WIPES business data)',
    );
  }
  const url = process.env['DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b';
  if (!/localhost|127\.0\.0\.1|postgres(?::\d+)?/.test(url)) {
    throw new Error(
      `refusing to run dev-catalog-seed against a non-local DATABASE_URL: ${url}`,
    );
  }
}

async function main(): Promise<void> {
  mustBeNonProduction();
  const orm = await initOrm();
  const em = orm.em.fork();
  const conn = em.getConnection();

  // Wipe in dependency order so re-runs work without manual cleanup.
  // attribute_set_attributes is truncated FIRST so the FK to
  // product_attributes can be dropped via cascade. attribute_sets is
  // preserved (the system Default row from migration 017 stays); custom
  // sets are removed below.
  await conn.execute(`
    truncate table
      attribute_set_attributes,
      sales_channel_products,
      product_categories,
      product_assets,
      product_attachments,
      bundle_slot_options,
      bundle_slots,
      grouped_items,
      product_links,
      gallery_item_labels,
      gallery_items,
      product_attributes,
      products,
      assets,
      megamenu_bindings,
      megamenu_items,
      megamenus,
      categories,
      sales_channels,
      customer_accounts,
      organizations,
      admin_users,
      admin_roles,
      price_list_assignments,
      price_list_items,
      price_lists,
      taxes,
      delivery_methods,
      payment_methods
    cascade
  `);

  // --- Sales Channels --------------------------------------------------
  const retail = em.create(SalesChannel, {
    code: 'pl_retail',
    name: { 'en-US': 'PL Retail', 'pl-PL': 'PL Retail' },
    isPublic: true,
    // Public channel doubles as the platform system default so header-less
    // requests (anonymous storefront, direct API hits) resolve here instead
    // of tripping the resolver's "registry empty" guard. Without this the
    // boot reconciler would promote the lexically-first channel (pl_b2b_vip,
    // a logged-in-only channel) — the wrong default for the storefront.
    systemDefault: true,
    defaultLanguage: 'pl-PL',
    defaultCurrency: 'PLN',
  });
  const b2bVip = em.create(SalesChannel, {
    code: 'pl_b2b_vip',
    name: { 'en-US': 'PL B2B VIP', 'pl-PL': 'PL B2B VIP' },
    isPublic: false,
    defaultLanguage: 'pl-PL',
    defaultCurrency: 'PLN',
  });
  await em.persistAndFlush([retail, b2bVip]);

  // --- Categories — 3-level tree ---------------------------------------
  const root = em.create(Category, {
    name: { 'en-US': 'Catalog', 'pl-PL': 'Katalog' },
    slug: 'catalog',
  });
  await em.persistAndFlush(root);

  const sectionDefs: Array<{ slug: string; nameEn: string }> = [
    { slug: 'fasteners', nameEn: 'Fasteners' },
    { slug: 'tools', nameEn: 'Tools' },
    { slug: 'electronics', nameEn: 'Electronics' },
    { slug: 'safety', nameEn: 'Safety equipment' },
  ];
  const sections: Category[] = [];
  for (const s of sectionDefs) {
    const cat = em.create(Category, {
      parentCategoryId: root.id,
      name: { 'en-US': s.nameEn },
      slug: s.slug,
    });
    sections.push(cat);
  }
  await em.persistAndFlush(sections);

  const leafDefs: Array<{ parentSlug: string; slug: string; nameEn: string }> = [
    { parentSlug: 'fasteners', slug: 'screws', nameEn: 'Screws' },
    { parentSlug: 'fasteners', slug: 'bolts', nameEn: 'Bolts' },
    { parentSlug: 'tools', slug: 'wrenches', nameEn: 'Wrenches' },
    { parentSlug: 'tools', slug: 'drills', nameEn: 'Drills' },
    { parentSlug: 'electronics', slug: 'cables', nameEn: 'Cables' },
    { parentSlug: 'electronics', slug: 'sensors', nameEn: 'Sensors' },
    { parentSlug: 'safety', slug: 'gloves', nameEn: 'Gloves' },
    { parentSlug: 'safety', slug: 'helmets', nameEn: 'Helmets' },
  ];
  const leaves: Category[] = [];
  for (const l of leafDefs) {
    const parent = sections.find((s) => s.slug === l.parentSlug)!;
    leaves.push(
      em.create(Category, {
        parentCategoryId: parent.id,
        name: { 'en-US': l.nameEn },
        slug: l.slug,
      }),
    );
  }
  await em.persistAndFlush(leaves);

  // --- Megamenu (feature 015) -----------------------------------------
  // A predefined navigation that mirrors the seeded category tree so the
  // storefront <Megamenu> component renders real, clickable links out of
  // the box (top level = the 4 sections, children = their leaf
  // categories). Bound active for every (channel, language) pair so the
  // resolver always finds a menu regardless of which scope the storefront
  // requests. Labels carry pl-PL + en-US.
  const menuLabels: Record<string, Record<string, string>> = {
    fasteners: { 'pl-PL': 'Łączniki', 'en-US': 'Fasteners' },
    tools: { 'pl-PL': 'Narzędzia', 'en-US': 'Tools' },
    electronics: { 'pl-PL': 'Elektronika', 'en-US': 'Electronics' },
    safety: { 'pl-PL': 'BHP', 'en-US': 'Safety equipment' },
    screws: { 'pl-PL': 'Wkręty', 'en-US': 'Screws' },
    bolts: { 'pl-PL': 'Śruby', 'en-US': 'Bolts' },
    wrenches: { 'pl-PL': 'Klucze', 'en-US': 'Wrenches' },
    drills: { 'pl-PL': 'Wiertła', 'en-US': 'Drills' },
    cables: { 'pl-PL': 'Kable', 'en-US': 'Cables' },
    sensors: { 'pl-PL': 'Czujniki', 'en-US': 'Sensors' },
    gloves: { 'pl-PL': 'Rękawice', 'en-US': 'Gloves' },
    helmets: { 'pl-PL': 'Kaski', 'en-US': 'Helmets' },
  };
  const labelFor = (slug: string, fallback: string): Record<string, string> =>
    menuLabels[slug] ?? { 'en-US': fallback };

  const mainMenu = em.create(Megamenu, {
    name: 'Main navigation',
    description: 'Predefined dev megamenu — mirrors the seeded category tree.',
  });
  await em.persistAndFlush(mainMenu);

  const topItems = sections.map((section, idx) =>
    em.create(MegamenuItem, {
      megamenuId: mainMenu.id,
      parentId: null,
      position: idx,
      kind: 'category-link',
      labels: labelFor(section.slug, section.name['en-US'] ?? section.slug),
      target: { categoryId: section.id },
    }),
  );
  await em.persistAndFlush(topItems);

  const childItems: MegamenuItem[] = [];
  sections.forEach((section, sectionIdx) => {
    const parentItem = topItems[sectionIdx]!;
    const childLeaves = leaves.filter((l) => l.parentCategoryId === section.id);
    childLeaves.forEach((leaf, leafIdx) => {
      childItems.push(
        em.create(MegamenuItem, {
          megamenuId: mainMenu.id,
          parentId: parentItem.id,
          position: leafIdx,
          kind: 'category-link',
          labels: labelFor(leaf.slug, leaf.name['en-US'] ?? leaf.slug),
          target: { categoryId: leaf.id },
        }),
      );
    });
  });
  await em.persistAndFlush(childItems);

  for (const ch of [retail, b2bVip]) {
    for (const language of ['pl-PL', 'en-US']) {
      em.create(MegamenuBinding, {
        megamenuId: mainMenu.id,
        salesChannelId: ch.id,
        language,
        active: true,
      });
    }
  }
  await em.flush();

  // --- Product attributes ---------------------------------------------
  const attrColor = em.create(ProductAttribute, {
    key: 'color',
    label: { 'en-US': 'Color' },
    labelDefault: 'Color',
    valueType: 'enum',
    isSearchable: true,
    isFilterable: true,
    isVariantAxis: false,
  });
  const attrMaterial = em.create(ProductAttribute, {
    key: 'material',
    label: { 'en-US': 'Material' },
    labelDefault: 'Material',
    valueType: 'enum',
    isSearchable: false,
    isFilterable: true,
    isVariantAxis: false,
  });
  const attrWeight = em.create(ProductAttribute, {
    key: 'weight_kg',
    label: { 'en-US': 'Weight (kg)' },
    labelDefault: 'Weight (kg)',
    valueType: 'number',
    isSearchable: false,
    isFilterable: true,
    isVariantAxis: false,
  });
  const attrCertification = em.create(ProductAttribute, {
    key: 'certification',
    label: { 'en-US': 'Certification' },
    labelDefault: 'Certification',
    valueType: 'string',
    isSearchable: true,
    isFilterable: false,
    isVariantAxis: false,
  });
  const attrInternalNotes = em.create(ProductAttribute, {
    key: 'internal_sku_notes',
    label: { 'en-US': 'Internal SKU notes' },
    labelDefault: 'Internal SKU notes',
    valueType: 'string',
    isSearchable: true,
    isFilterable: false,
    isVariantAxis: false,
  });
  // Feature 002 — sample attributes of the new API-form types so the
  // admin UI editor can demonstrate `multiselect` and `price` paths.
  const attrCompatibleSystems = em.create(ProductAttribute, {
    key: 'compatible_systems',
    label: { 'en-US': 'Compatible systems' },
    labelDefault: 'Compatible systems',
    valueType: 'multiselect',
    isSearchable: true,
    isFilterable: true,
    isVariantAxis: false,
  });
  const attrManufacturerPrice = em.create(ProductAttribute, {
    key: 'manufacturer_price',
    label: { 'en-US': 'Manufacturer price' },
    labelDefault: 'Manufacturer price',
    valueType: 'price',
    isSearchable: false,
    isFilterable: true,
    isVariantAxis: false,
    displayAsSlider: true,
  });
  await em.persistAndFlush([
    attrColor,
    attrMaterial,
    attrWeight,
    attrCertification,
    attrInternalNotes,
    attrCompatibleSystems,
    attrManufacturerPrice,
  ]);

  // Feature 012 — option-list rows for the three select-style attributes
  // (formerly stored as enum_values: string[] on the parent; the column is
  // gone). The dev seed populates labelDefault from the value itself.
  const { AttributeOption } = await import('../entities/attribute-option.entity.js');
  const optionRows: Array<{ attributeId: string; values: readonly string[] }> = [
    { attributeId: attrColor.id, values: COLOR_VALUES },
    { attributeId: attrMaterial.id, values: MATERIAL_VALUES },
    { attributeId: attrCompatibleSystems.id, values: ['windows', 'macos', 'linux'] },
  ];
  for (const row of optionRows) {
    for (const [i, v] of row.values.entries()) {
      em.create(AttributeOption, {
        attributeId: row.attributeId,
        value: v,
        label: {},
        labelDefault: v,
        isDefault: false,
        sortOrder: i,
      });
    }
  }
  await em.flush();

  // Feature 002 — assign every seeded attribute to the system Default
  // Attribute Set so the admin Product editor lists them out of the box.
  // The Default set itself is created/preserved by migration 017 with
  // a deterministic UUID; we never re-create it from this seed.
  const DEFAULT_ATTRIBUTE_SET_ID = 'defa0017-0000-4000-8000-000000000000';
  const allSeededAttributes = [
    attrColor,
    attrMaterial,
    attrWeight,
    attrCertification,
    attrInternalNotes,
    attrCompatibleSystems,
    attrManufacturerPrice,
  ];
  const assignments = allSeededAttributes.map((attr, idx) =>
    em.create(AttributeSetAttribute, {
      attributeSetId: DEFAULT_ATTRIBUTE_SET_ID,
      productAttributeId: attr.id,
      position: idx,
    }),
  );
  await em.persistAndFlush(assignments);

  // --- Products --------------------------------------------------------
  // `productLeaves[k]` records the leaf each product belongs to, so its name,
  // SKU/slug AND its category link all reference the SAME leaf. Previously the
  // name loop used a 1-based index while the category loop used a 0-based one,
  // which shifted every product into the neighbouring category (e.g. a product
  // named "Screws …" ended up filed under Helmets).
  const products: Product[] = [];
  const productLeaves: Category[] = [];
  for (let i = 1; i <= PRODUCT_COUNT; i++) {
    const idx = String(i).padStart(4, '0');
    const leaf = leaves[i % leaves.length]!;
    productLeaves.push(leaf);
    const color = COLOR_VALUES[i % COLOR_VALUES.length]!;
    const material = MATERIAL_VALUES[i % MATERIAL_VALUES.length]!;
    const weight = Number(((i % 50) / 10 + 0.1).toFixed(1));
    const price = 9.99 + (i % 100) * 1.5;
    const leafNameEn = leaf.name['en-US'] ?? leaf.slug;
    const productName = `${leafNameEn} ${idx}`;
    const certification = i % 7 === 0 ? 'ISO9001' : null;
    products.push(
      em.create(Product, {
        sku: `DEMO-${leaf.slug.toUpperCase()}-${idx}`,
        slug: `demo-${leaf.slug}-${idx}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': productName },
        description: {
          'en-US': buildProductDescription({
            productName,
            leafNameEn,
            color,
            material,
            weightKg: weight,
            certification,
          }),
        },
        visibility: 'public',
        attributeValues: {
          color,
          material,
          weight_kg: weight,
          certification,
          defaultPrice: price,
        },
      }),
    );
  }
  await em.persistAndFlush(products);

  // --- Composite products (T133, US5) ---------------------------------
  // 1 grouped product (with 2 simple children), 1 bundle product (with
  // 1 slot + 2 options), 1 virtual product (with downloadUrl). Wired
  // into the same retail channel and the first leaf category so they
  // surface on the storefront without manual setup.
  const groupedProduct = em.create(Product, {
    sku: 'DEMO-GROUPED-0001',
    slug: 'demo-grouped-set-0001',
    type: 'grouped',
    status: 'active',
    name: { 'en-US': 'Starter set (grouped)' },
    description: {
      'en-US': 'Starter set bundling two products with fixed quantities.',
    },
    visibility: 'public',
    attributeValues: { defaultPrice: 49.99 },
  });
  const bundleProduct = em.create(Product, {
    sku: 'DEMO-BUNDLE-0001',
    slug: 'demo-bundle-config-0001',
    type: 'bundle',
    status: 'active',
    name: { 'en-US': 'Configurable bundle' },
    description: {
      'en-US': 'Pick a color and quantity to configure your bundle.',
    },
    visibility: 'public',
    attributeValues: { defaultPrice: 99.99 },
  });
  const virtualProduct = em.create(Product, {
    sku: 'DEMO-VIRTUAL-0001',
    slug: 'demo-virtual-ebook-0001',
    type: 'virtual',
    status: 'active',
    name: { 'en-US': 'B2B Buyer Handbook (e-book)' },
    description: {
      'en-US': 'Digital e-book — instant download after purchase.',
    },
    visibility: 'public',
    attributeValues: { defaultPrice: 19.99 },
    downloadUrl: 'https://example.test/b2b-buyer-handbook.pdf',
  });
  await em.persistAndFlush([groupedProduct, bundleProduct, virtualProduct]);

  // --- Bridges (raw SQL for speed) ------------------------------------
  const productCategoryRows: string[] = [];
  const salesChannelProductRows: string[] = [];
  const productCategoryParams: unknown[] = [];
  const salesChannelProductParams: unknown[] = [];
  for (const [idx, p] of products.entries()) {
    // Same leaf the product was named/slugged after — keeps category
    // membership consistent with the product name.
    const leaf = productLeaves[idx]!;
    productCategoryRows.push('(?, ?)');
    productCategoryParams.push(p.id, leaf.id);
    salesChannelProductRows.push('(?, ?)');
    salesChannelProductParams.push(retail.id, p.id);
  }
  await conn.execute(
    `insert into product_categories (product_id, category_id) values ${productCategoryRows.join(', ')}`,
    productCategoryParams,
  );
  await conn.execute(
    `insert into sales_channel_products (sales_channel_id, product_id) values ${salesChannelProductRows.join(', ')}`,
    salesChannelProductParams,
  );

  // --- Product images (demo) ------------------------------------------
  // Attach 2-3 image Assets to every simple product so storefront cards and
  // the PDP render real <img> tags out of the box. URLs are deterministic
  // placeholder images labelled with the product name and tinted per
  // category, so re-seeding is stable and the insert stays offline (only the
  // browser fetches the URL at render time). `position` drives ordering and
  // the resolved `primaryAssetUrl` (position 0 = hero image).
  const imageAssetRows: string[] = [];
  const imageAssetParams: unknown[] = [];
  const productImageRows: string[] = [];
  const productImageParams: unknown[] = [];
  for (const [idx, p] of products.entries()) {
    const leaf = productLeaves[idx]!;
    const bg = leafImageColor(leaf.slug);
    const imageCount = 2 + (idx % 2); // 2 or 3 images per product
    const label = encodeURIComponent(p.name['en-US'] ?? p.slug);
    for (let n = 0; n < imageCount; n++) {
      const assetId = crypto.randomUUID();
      const url = `https://placehold.co/800x800/${bg}/ffffff.png?text=${label}%0A${n + 1}`;
      imageAssetRows.push(`(?, 'image', ?, 'image/png', 51200, ?, now(), now())`);
      imageAssetParams.push(assetId, `${p.slug}-${n + 1}.png`, url);
      productImageRows.push('(?, ?, ?)');
      productImageParams.push(p.id, assetId, n);
    }
  }
  await conn.execute(
    `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
     values ${imageAssetRows.join(', ')}`,
    imageAssetParams,
  );
  await conn.execute(
    `insert into product_assets (product_id, asset_id, position) values ${productImageRows.join(', ')}`,
    productImageParams,
  );

  // --- Composite product wiring (T133, US5) ---------------------------
  // Hook composites into the same first-leaf category + retail channel.
  const firstLeaf = leaves[0]!;
  for (const composite of [groupedProduct, bundleProduct, virtualProduct]) {
    await conn.execute(
      `insert into product_categories (product_id, category_id) values (?, ?)`,
      [composite.id, firstLeaf.id],
    );
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`,
      [retail.id, composite.id],
    );
  }
  // Grouped: two children, take the first two simple products.
  await conn.execute(
    `insert into grouped_items (id, parent_product_id, child_product_id, quantity, position, created_at, updated_at)
     values (?, ?, ?, 2, 0, now(), now()),
            (?, ?, ?, 1, 1, now(), now())`,
    [
      crypto.randomUUID(), groupedProduct.id, products[0]!.id,
      crypto.randomUUID(), groupedProduct.id, products[1]!.id,
    ],
  );
  // Bundle: one slot with two options (next two simple products).
  const bundleSlotId = crypto.randomUUID();
  await conn.execute(
    `insert into bundle_slots (id, parent_product_id, name, min_quantity, max_quantity, position, created_at, updated_at)
     values (?, ?, ?::jsonb, 1, 1, 0, now(), now())`,
    [
      bundleSlotId,
      bundleProduct.id,
      JSON.stringify({ 'en-US': 'Color', 'pl-PL': 'Kolor' }),
    ],
  );
  await conn.execute(
    `insert into bundle_slot_options (id, slot_id, option_product_id, default_quantity, position, created_at, updated_at)
     values (?, ?, ?, 1, 0, now(), now()),
            (?, ?, ?, 1, 1, now(), now())`,
    [
      crypto.randomUUID(), bundleSlotId, products[2]!.id,
      crypto.randomUUID(), bundleSlotId, products[3]!.id,
    ],
  );

  // --- Sample Attachments (T080, US3) ---------------------------------
  // Seed two PDF Assets and attach each to the first three simple
  // products as Certificate / Tech spec respectively, so the storefront
  // PDP renders the AttachmentsList without an admin needing to upload.
  const certAssetId = crypto.randomUUID();
  const specAssetId = crypto.randomUUID();
  await conn.execute(
    `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
     values
       (?, 'pdf', 'sample-certificate.pdf', 'application/pdf', 102400, 'https://example.test/sample-certificate.pdf', now(), now()),
       (?, 'pdf', 'sample-tech-spec.pdf',   'application/pdf', 204800, 'https://example.test/sample-tech-spec.pdf',   now(), now())`,
    [certAssetId, specAssetId],
  );
  const [certType] = await conn.execute<{ id: string }[]>(
    `select id from attachment_types where code = 'certificate' limit 1`,
  );
  const [specType] = await conn.execute<{ id: string }[]>(
    `select id from attachment_types where code = 'tech_spec' limit 1`,
  );
  if (certType && specType) {
    const targetProducts = products.slice(0, Math.min(3, products.length));
    for (const [idx, p] of targetProducts.entries()) {
      await conn.execute(
        `insert into product_attachments (id, product_id, asset_id, attachment_type_id, name, description, position, created_at, updated_at)
         values
           (?, ?, ?, ?, ?, ?, 0, now(), now()),
           (?, ?, ?, ?, ?, ?, 1, now(), now())`,
        [
          crypto.randomUUID(), p.id, certAssetId, certType.id,
          `CE Marking ${idx + 1}`, 'Manufacturer-issued conformity statement.',
          crypto.randomUUID(), p.id, specAssetId, specType.id,
          `Datasheet ${idx + 1}`, null,
        ],
      );
    }
  }

  // --- Demo Organization + buyer --------------------------------------
  const adminPasswordHash = await hashPassword(DEMO_ADMIN_PASSWORD);
  const buyerPasswordHash = await hashPassword(DEMO_BUYER_PASSWORD);

  const platformRole = em.create(AdminRole, {
    code: 'platform_admin',
    name: 'Platform Admin',
    permissions: ['*'],
  });
  await em.persistAndFlush(platformRole);

  const demoAdmin = em.create(AdminUser, {
    email: DEMO_ADMIN_EMAIL,
    passwordHash: adminPasswordHash,
    firstName: 'Demo',
    lastName: 'Admin',
    adminRoleId: platformRole.id,
    status: 'active',
  });
  await em.persistAndFlush(demoAdmin);

  // Feature 008 — sales_representative role + two demo accounts so the
  // quickstart can exercise assignment-scoped visibility.
  const salesRepRole = em.create(AdminRole, {
    code: 'sales_representative',
    name: 'Sales representative',
    permissions: [
      'rfqs:handle',
      'organizations:read.assigned',
      'catalog:read',
    ],
  });
  await em.persistAndFlush(salesRepRole);

  const salesRepAdmin = em.create(AdminUser, {
    email: 'sales-rep@demo.local',
    passwordHash: adminPasswordHash,
    firstName: 'Anna',
    lastName: 'Wiśniewska',
    adminRoleId: salesRepRole.id,
    status: 'active',
  });
  const salesRepOther = em.create(AdminUser, {
    email: 'sales-rep-other@demo.local',
    passwordHash: adminPasswordHash,
    firstName: 'Tomasz',
    lastName: 'Nowak',
    adminRoleId: salesRepRole.id,
    status: 'active',
  });
  await em.persistAndFlush([salesRepAdmin, salesRepOther]);

  const demoOrg = em.create(Organization, {
    name: DEMO_ORG_NAME,
    taxId: DEMO_ORG_TAX_ID,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: {
      street: 'ul. Demo 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
  });
  await em.persistAndFlush(demoOrg);

  const demoBuyer = em.create(CustomerAccount, {
    organizationId: demoOrg.id,
    email: DEMO_BUYER_EMAIL,
    passwordHash: buyerPasswordHash,
    firstName: 'Demo',
    lastName: 'Buyer',
    role: 'organization_admin',
    emailVerifiedAt: new Date(),
  });
  await em.persistAndFlush(demoBuyer);

  // --- Delivery + payment methods (T166) ------------------------------
  const pickup = em.create(DeliveryMethod, {
    code: 'in_person_pickup',
    name: { 'en-US': 'In-person pickup', 'pl-PL': 'Odbior osobisty' },
    cost: '0',
    currency: 'PLN',
    // Feature 035 — shipping adapter backing this delivery method.
    adapter: 'personal_pickup',
  });
  await em.persistAndFlush(pickup);

  const bankTransfer = em.create(PaymentMethod, {
    code: 'bank_transfer',
    name: { 'en-US': 'Bank transfer', 'pl-PL': 'Przelew bankowy' },
    kind: 'bank_transfer',
    adapter: 'bank_transfer',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'cancelled',
  });
  await em.persistAndFlush(bankTransfer);

  // --- Default price list — engine schema (feature 011) ----------------
  // Migration 031 seeds the Default row at db:migrate time and creates
  // a bracket per currency from each product's attributeValues.defaultPrice.
  // Re-running the migrator here picks up any product that the dev seed
  // just created so the storefront resolver always finds a Base bracket.
  // The migrator is idempotent — subsequent runs are no-ops.
  await new DefaultPriceListMigrator(() => em).run();

  // --- Feature 010 — multi-warehouse demo data (T085) ----------------
  // Add a second warehouse `Magazyn Kraków` and spread stock between it
  // and the seeded `default` warehouse so the inventory landing,
  // per-product roster, and channel-binding panels all have real data
  // to render. The existing channels keep `default` as their default
  // warehouse (the boot-time WarehouseChannelReconciler handled that)
  // and gain a second non-default assignment for `Magazyn Kraków`.
  const krakowWarehouseId = '00000000-0000-4000-8000-00000000d0c0';
  let krakow = await em.findOne(Warehouse, { id: krakowWarehouseId });
  if (!krakow) {
    krakow = em.create(Warehouse, {
      id: krakowWarehouseId,
      name: 'Magazyn Kraków',
      code: 'pl-krk',
      active: true,
      description: 'Demo secondary warehouse — Kraków, PL',
    });
    em.persist(krakow);
    await em.flush();
  }

  // Seed runs BEFORE the backend boots, so the WarehouseChannelReconciler
  // (which fires at boot, after DefaultChannelReconciler) hasn't yet
  // paired channels with the Default warehouse. Run it inline so the
  // dev DB lands fully wired and admins don't need a server bounce.
  await new WarehouseChannelReconciler(em.fork()).run();

  const channelsForBinding = await em.find(SalesChannel, {});
  for (const ch of channelsForBinding) {
    const existing = await em.findOne(WarehouseChannelAssignment, {
      warehouseId: krakowWarehouseId,
      salesChannelId: ch.id,
    });
    if (!existing) {
      const row = em.create(WarehouseChannelAssignment, {
        warehouseId: krakowWarehouseId,
        salesChannelId: ch.id,
        isDefault: false,
        sortOrder: 1,
      });
      em.persist(row);
    }
  }
  await em.flush();

  // Distribute stock for the seeded products: 60% in default, 40% in
  // Magazyn Kraków. Skip products that already have stock rows so a
  // re-run of the seed doesn't double-up.
  const productsForStock = await em.find(Product, {});
  let stockRowsCreated = 0;
  for (const p of productsForStock) {
    const existing = await em.find(StockLevel, { productId: p.id });
    if (existing.length > 0) continue;
    const baseQty = 50 + ((parseInt(p.id.replace(/-/g, '').slice(0, 8), 16) % 200));
    const defaultQty = Math.floor(baseQty * 0.6);
    const krakowQty = baseQty - defaultQty;
    em.persist(em.create(StockLevel, {
      productId: p.id,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      onHand: defaultQty,
    }));
    em.persist(em.create(StockLevel, {
      productId: p.id,
      warehouseId: krakowWarehouseId,
      onHand: krakowQty,
    }));
    stockRowsCreated += 2;
  }
  if (stockRowsCreated > 0) await em.flush();

  // --- Polish VAT Tax (T166) ------------------------------------------
  em.create(Tax, {
    code: 'pl_vat_23',
    name: 'PL VAT 23%',
    rate: '0.23',
    country: 'PL',
    isDefault: true,
  });
  await em.flush();

  // --- Summary --------------------------------------------------------
  const _summary: SeedRow<unknown>[] = [];
  void _summary;
  console.log('');
  console.log('=== Dev seed complete ===');
  console.log('');
  console.log(`Products       : ${PRODUCT_COUNT}`);
  console.log(`Categories     : ${1 + sections.length + leaves.length} nodes`);
  console.log(`Megamenu       : "Main navigation" (${topItems.length} top, ${childItems.length} sub), active on all channels`);
  console.log(`Sales Channels : pl_retail (public), pl_b2b_vip (logged-in only)`);
  console.log(`Warehouses     : default (system), pl-krk (Magazyn Kraków)`);
  console.log(`Price Lists    : default_pln (${PRODUCT_COUNT} items, default)`);
  console.log(`Taxes          : pl_vat_23 (23% on PL, default)`);
  console.log(`Delivery       : in_person_pickup (free)`);
  console.log(`Payment        : bank_transfer (proforma flow)`);
  console.log('');
  console.log('Sign in credentials (CHANGE before any non-local use):');
  console.log(`  Platform Administrator : ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
  console.log(`  Sales Representative   : sales-rep@demo.local / ${DEMO_ADMIN_PASSWORD}`);
  console.log(`  Sales Rep (other)      : sales-rep-other@demo.local / ${DEMO_ADMIN_PASSWORD}`);
  console.log(`  Organization Admin     : ${DEMO_BUYER_EMAIL} / ${DEMO_BUYER_PASSWORD}`);
  console.log('');
  console.log('Open the storefront at  http://localhost:3000');
  console.log('Open the admin panel at http://localhost:3002');
  console.log('');

  await closeOrm();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
