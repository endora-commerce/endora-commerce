/**
 * The demo blocks that have **already** reached their own modules, kept here
 * verbatim as the parity comparison's reference side (feature 113, Phase 2).
 *
 * ## Why this file exists, and why it is not a duplicate to be tidied away
 *
 * `test/integration/demo/demo-parity.test.ts` is the only thing in the
 * repository that judges whether the demo seed still produces the same shop: no
 * check's population contains `backend/src/seeds/`, and no static instrument
 * can see whether a moved block writes the rows the block it replaced wrote. It
 * works by seeding two databases and diffing them — `dev-catalog-seed.ts` on
 * one side, `endora demo seed` on the other.
 *
 * That comparison is only worth something while the two sides are **different
 * code**. The moment a module's block leaves `demo-host-residue.ts`, the
 * reference side stops writing those rows, and the comparison stops being able
 * to see the move at all: the table drops out of the reference population, and
 * a batch that dropped a column, changed an adapter name or lost a row would
 * be as green as one that moved the block faithfully.
 *
 * So a moved block is not deleted from the host. It is moved **here**,
 * unchanged, and this file is called by `dev-catalog-seed.ts` and by nothing
 * else. The composed path runs the module's own copy; the reference path runs
 * this one; the parity test compares the two databases row for row. A batch
 * that changes a value in the module and not here goes red, which is the whole
 * point of writing the comparison before the first block moved.
 *
 * ## What it is not
 *
 * It is not a home and it is not a second implementation to keep in step. It is
 * a **frozen copy**: nothing here may be improved, refactored or corrected — a
 * correction belongs in the module that now owns the rows, and this file's
 * disagreement with it is the finding. It is deleted whole at T226, with
 * `demo-host-residue.ts` and `dev-catalog-seed.ts`, when there is no longer a
 * legacy path to be the reference.
 *
 * Nothing here opens a database, opens a scope or checks the guard; all three
 * are the entry point's (contract §3.3, §3.4), exactly as in the residue.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { entities as deliveryMethodsEntities } from '@endora-commerce/mod-delivery-methods/backend';
import {
  entities as inventoryEntities,
  WarehouseChannelReconciler,
} from '@endora-commerce/mod-inventory/backend';
import { entities as paymentMethodsEntities } from '@endora-commerce/mod-payment-methods/backend';
import { entities as taxesEntities } from '@endora-commerce/mod-taxes/backend';
import { entities as catalogEntities } from '@endora-commerce/mod-catalog/backend';
import { entities as adminRolesEntities } from '@endora-commerce/mod-admin-roles/backend';
import { entities as adminUsersEntities } from '@endora-commerce/mod-admin-users/backend';
import { entities as creditLimitsEntities } from '@endora-commerce/mod-credit-limits/backend';
import { entities as organizationsEntities } from '@endora-commerce/mod-organizations/backend';
import { entityNamed } from '../packages/package-entity-lookup.js';
// The row shapes for the three classes below — an `import type` of the
// declaration inside each package's **built** artefact, for the reason
// `demo-host-residue.ts` gives in full: a module package publishes its entities
// as one array and no class by name (D-168), and this file's build sets
// `rootDir: ./src`, so a `.ts` outside it is TS6059 even for a type-only
// import. Nothing is constructed from the type; `import type` erases.
import type { DeliveryMethod as DeliveryMethodRow } from '../../../packages/modules/delivery_methods/dist/backend/entities/delivery-method.entity.js';
import type { PaymentMethod as PaymentMethodRow } from '../../../packages/modules/payment_methods/dist/backend/entities/payment-method.entity.js';
import type { Tax as TaxRow } from '../../../packages/modules/taxes/dist/backend/entities/tax.entity.js';
import type { Warehouse as WarehouseRow } from '../../../packages/modules/inventory/dist/backend/entities/warehouse.entity.js';
import type { WarehouseChannelAssignment as WarehouseChannelAssignmentRow } from '../../../packages/modules/inventory/dist/backend/entities/warehouse-channel-assignment.entity.js';
import type { Product as ProductRow } from '../../../packages/modules/catalog/dist/backend/entities/product.entity.js';
import type { Category as CategoryRow } from '../../../packages/modules/catalog/dist/backend/entities/category.entity.js';
import type { AttributeSetAttribute as AttributeSetAttributeRow } from '../../../packages/modules/catalog/dist/backend/entities/attribute-set-attribute.entity.js';
import type { AdminRole as AdminRoleRow } from '../../../packages/modules/admin_roles/dist/backend/entities/admin-role.entity.js';
import type { AdminUser as AdminUserRow } from '../../../packages/modules/admin_users/dist/backend/entities/admin-user.entity.js';
import type { CreditLimit as CreditLimitRow } from '../../../packages/modules/credit_limits/dist/backend/entities/credit-limit.entity.js';
import type { Organization as OrganizationRow } from '../../../packages/modules/organizations/dist/backend/entities/organization.entity.js';
import { SalesChannel } from '../kernel/sales-channels/sales-channel.entity.js';
import { hashPassword } from '../kernel/crypto/password-hasher.js';
import { createAttributeFixture } from './attribute-fixtures.js';

const DeliveryMethod = entityNamed<DeliveryMethodRow>(
  deliveryMethodsEntities,
  'DeliveryMethod',
  '@endora-commerce/mod-delivery-methods/backend',
);
const PaymentMethod = entityNamed<PaymentMethodRow>(
  paymentMethodsEntities,
  'PaymentMethod',
  '@endora-commerce/mod-payment-methods/backend',
);
const Tax = entityNamed<TaxRow>(taxesEntities, 'Tax', '@endora-commerce/mod-taxes/backend');
const Warehouse = entityNamed<WarehouseRow>(
  inventoryEntities,
  'Warehouse',
  '@endora-commerce/mod-inventory/backend',
);
const WarehouseChannelAssignment = entityNamed<WarehouseChannelAssignmentRow>(
  inventoryEntities,
  'WarehouseChannelAssignment',
  '@endora-commerce/mod-inventory/backend',
);
const Product = entityNamed<ProductRow>(
  catalogEntities,
  'Product',
  '@endora-commerce/mod-catalog/backend',
);
const Category = entityNamed<CategoryRow>(
  catalogEntities,
  'Category',
  '@endora-commerce/mod-catalog/backend',
);
const AttributeSetAttribute = entityNamed<AttributeSetAttributeRow>(
  catalogEntities,
  'AttributeSetAttribute',
  '@endora-commerce/mod-catalog/backend',
);
const AdminRole = entityNamed<AdminRoleRow>(
  adminRolesEntities,
  'AdminRole',
  '@endora-commerce/mod-admin-roles/backend',
);
const AdminUser = entityNamed<AdminUserRow>(
  adminUsersEntities,
  'AdminUser',
  '@endora-commerce/mod-admin-users/backend',
);
const CreditLimit = entityNamed<CreditLimitRow>(
  creditLimitsEntities,
  'CreditLimit',
  '@endora-commerce/mod-credit-limits/backend',
);
const Organization = entityNamed<OrganizationRow>(
  organizationsEntities,
  'Organization',
  '@endora-commerce/mod-organizations/backend',
);

/**
 * The demo administrator's sign-in details, on the **reference** path.
 *
 * `dev-catalog-seed.ts` prints them, and it imports them from here rather than
 * from `demo-host-residue.ts` because this is where the block that creates the
 * account now lives on that path. On the composed path `admin_users` reports
 * the same pair as a `DemoCredential` and the runner formats it (§3.7); these
 * two constants are the frozen copy and go with the file at T226.
 */
export const DEMO_ADMIN_EMAIL = 'admin@demo.local';
export const DEMO_ADMIN_PASSWORD = 'ChangeMe!123';

/** The demo organisation's own two literals, frozen with the block below. */
const DEMO_ORG_NAME = 'Acme B2B (demo)';
const DEMO_ORG_TAX_ID = 'PL5210000099';

/**
 * The sales representative's permission list, as the host block wrote it.
 *
 * A **literal copy** and not an import of
 * `@endora-commerce/mod-admin-roles/backend`'s exported constant, deliberately:
 * the two sides of the parity comparison have to be different code, and a
 * reference side that imported the module's own list could not see a change to
 * it. That is this whole file's reason, applied to the one value in it that has
 * a published twin.
 */
const SALES_REPRESENTATIVE_PERMISSIONS: readonly string[] = [
  'rfqs:handle',
  'organizations:read.assigned',
  'catalog:read',
  'price_lists:read',
];

/** What `dev-catalog-seed.ts` prints, now that the catalogue is frozen here. */
export interface RelocatedReferenceSummary {
  readonly categoryNodes: number;
  readonly products: number;
}

/**
 * The catalogue generators, frozen with the block that uses them (T224).
 *
 * `catalog` holds its own copies in `src/backend/demo/rows.ts` and the
 * composition holds the two that build an asset. These are the host's, byte for
 * byte, and the parity comparison is what says the three still produce one shop.
 */
const PRODUCT_COUNT = 200;
const COLOR_VALUES = ['red', 'green', 'blue', 'black', 'white'];
const MATERIAL_VALUES = ['steel', 'aluminium', 'plastic', 'wood', 'glass'];

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

/**
 * Line-art product glyphs (viewBox 0 0 100 100, fill none, stroke) mirroring
 * the Storefront UI reference project (`specs/b2b-platform-storefront-ui/
 * project/industria-icons.jsx` → `ProductGlyph`). Keyed by demo leaf slug; the
 * default `box` glyph covers anything else. These replace the old
 * `placehold.co` text tiles with the design's own minimalist product art.
 */
const LEAF_GLYPHS: Record<string, string> = {
  screws: `<ellipse cx="50" cy="16" rx="18" ry="6"/><line x1="40" y1="16" x2="60" y2="16"/><path d="M40 20 V64 L50 86 L60 64 V20"/><line x1="40" y1="30" x2="60" y2="26"/><line x1="40" y1="42" x2="60" y2="38"/><line x1="40" y1="54" x2="60" y2="50"/>`,
  bolts: `<polygon points="34 16 50 8 66 16 66 34 50 42 34 34"/><line x1="50" y1="8" x2="50" y2="42"/><rect x="42" y="42" width="16" height="46" rx="1"/><line x1="42" y1="52" x2="58" y2="52"/><line x1="42" y1="62" x2="58" y2="62"/><line x1="42" y1="72" x2="58" y2="72"/>`,
  wrenches: `<path d="M70 14 a16 16 0 0 1 14 22 l-44 44 a8 8 0 0 1 -12 -12 l44 -44 a16 16 0 0 1 -2 -10 z"/><circle cx="78" cy="22" r="3"/>`,
  drills: `<rect x="44" y="10" width="12" height="16"/><path d="M44 26 h12 v40 l-6 20 -6 -20 z"/><path d="M44 34 l12 6 M44 46 l12 6 M44 58 l12 6"/>`,
  cables: `<path d="M14 30 C 30 30, 30 70, 50 70 S 70 30, 86 30"/><path d="M14 38 C 30 38, 30 78, 50 78 S 70 38, 86 38"/><path d="M14 46 C 30 46, 30 86, 50 86 S 70 46, 86 46"/>`,
  sensors: `<circle cx="50" cy="50" r="14"/><rect x="36" y="50" width="28" height="30" rx="2" transform="rotate(-90 50 50)"/><line x1="76" y1="36" x2="86" y2="36"/><line x1="76" y1="50" x2="86" y2="50"/><line x1="76" y1="64" x2="86" y2="64"/><circle cx="50" cy="50" r="5"/>`,
  gloves: `<path d="M34 86 V50 c0 -4 6 -4 6 0 V34 c0 -5 7 -5 7 0 v14 M47 48 V26 c0 -5 7 -5 7 0 v22 M54 48 V30 c0 -5 7 -5 7 0 v18 M61 48 V40 c0 -6 8 -5 8 2 v14 c0 18 -8 30 -18 30 H44 c-6 0 -10 -4 -10 -10 Z"/><line x1="34" y1="70" x2="69" y2="70"/>`,
  helmets: `<path d="M20 64 a30 30 0 0 1 60 0 Z"/><path d="M40 36 q10 -6 20 0"/><line x1="50" y1="34" x2="50" y2="64"/><rect x="16" y="64" width="68" height="8" rx="4"/>`,
};
const DEFAULT_GLYPH = `<rect x="20" y="30" width="60" height="50" rx="4"/><line x1="20" y1="44" x2="80" y2="44"/>`;

/**
 * Build an `data:image/svg+xml` product placeholder: a soft category-tinted
 * panel with the leaf's line-art glyph centred (60% box, matching the
 * reference `.gallery__main` layout) and a small monospace position index so
 * the 2–3 gallery images of a product stay visually distinct.
 */
function productPlaceholderSvg(leafSlug: string, bgHex: string, index: number): string {
  const glyph = LEAF_GLYPHS[leafSlug] ?? DEFAULT_GLYPH;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="800" height="800">` +
    `<rect width="100" height="100" fill="#fbfbfc"/>` +
    `<circle cx="50" cy="50" r="30" fill="#${bgHex}" opacity="0.06"/>` +
    `<g fill="none" stroke="#9ca3af" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(20 20) scale(0.6)">${glyph}</g>` +
    `<text x="92" y="94" font-size="6" fill="#c7ccd1" text-anchor="end" font-family="monospace">${String(index + 1).padStart(2, '0')}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Create the rows the modules below now create for themselves.
 *
 * Called after `seedHostModuleResidue` and before the composition, which is
 * where `endora demo seed` runs the modules' own bodies (contract §5.5) — so
 * the two paths write in the same order as well as the same rows.
 */
export async function seedRelocatedDemoReference(
  em: EntityManager,
): Promise<RelocatedReferenceSummary> {
  const conn = em.getConnection();
  // ── T224, batch 5 ────────────────────────────────────────────────────────
  // `catalog`: the category tree, the 200 products, the three composites and
  // their structure — plus the three blocks that became **composition steps**
  // because each writes two modules' rows in one statement: the attributes
  // (`custom_fields` + `catalog`), the placeholder images and the sample
  // attachments (`assets_library` + `catalog`). Verbatim from
  // `demo-host-residue.ts`, including the in-memory `products`/`productLeaves`
  // handoff between them, which is exactly what the composed path cannot have
  // and what makes the two sides different code.
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
  const sections: CategoryRow[] = [];
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
  const leaves: CategoryRow[] = [];
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

  // --- Product attributes ---------------------------------------------
  // Feature 061 — a product attribute is a product-host Custom Field
  // definition + a catalog extension row; the fixture helper creates the pair.
  const optionsFromValues = (values: readonly string[]) =>
    values.map((v, i) => ({ value: v, labelDefault: v, sortOrder: i }));
  const { extension: attrColor } = await createAttributeFixture(em, {
    key: 'color',
    label: { 'en-US': 'Color' },
    labelDefault: 'Color',
    valueType: 'enum',
    isSearchable: true,
    isFilterable: true,
    sortOrder: 0,
    options: optionsFromValues(COLOR_VALUES),
  });
  const { extension: attrMaterial } = await createAttributeFixture(em, {
    key: 'material',
    label: { 'en-US': 'Material' },
    labelDefault: 'Material',
    valueType: 'enum',
    isFilterable: true,
    sortOrder: 1,
    options: optionsFromValues(MATERIAL_VALUES),
  });
  const { extension: attrWeight } = await createAttributeFixture(em, {
    key: 'weight_kg',
    label: { 'en-US': 'Weight (kg)' },
    labelDefault: 'Weight (kg)',
    valueType: 'number',
    isFilterable: true,
    sortOrder: 2,
  });
  const { extension: attrCertification } = await createAttributeFixture(em, {
    key: 'certification',
    label: { 'en-US': 'Certification' },
    labelDefault: 'Certification',
    valueType: 'string',
    isSearchable: true,
    sortOrder: 3,
  });
  const { extension: attrInternalNotes } = await createAttributeFixture(em, {
    key: 'internal_sku_notes',
    label: { 'en-US': 'Internal SKU notes' },
    labelDefault: 'Internal SKU notes',
    valueType: 'string',
    isSearchable: true,
    sortOrder: 4,
  });
  // Feature 002 — sample attributes of the new API-form types so the
  // admin UI editor can demonstrate `multiselect` and `price` paths.
  const { extension: attrCompatibleSystems } = await createAttributeFixture(em, {
    key: 'compatible_systems',
    label: { 'en-US': 'Compatible systems' },
    labelDefault: 'Compatible systems',
    valueType: 'multiselect',
    isSearchable: true,
    isFilterable: true,
    sortOrder: 5,
    options: optionsFromValues(['windows', 'macos', 'linux']),
  });
  const { extension: attrManufacturerPrice } = await createAttributeFixture(em, {
    key: 'manufacturer_price',
    label: { 'en-US': 'Manufacturer price' },
    labelDefault: 'Manufacturer price',
    valueType: 'price',
    isFilterable: true,
    displayAsSlider: true,
    sortOrder: 6,
  });

  // Feature 002 — assign every seeded attribute to the system Default
  // Attribute Set so the admin Product editor lists them out of the box.
  // The Default set itself is created/preserved by migration 017 with
  // a deterministic UUID; membership is definition-keyed (feature 061).
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
      customFieldDefinitionId: attr.customFieldDefinitionId,
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
  const products: ProductRow[] = [];
  const productLeaves: CategoryRow[] = [];
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

  // --- Product images (demo) ------------------------------------------
  // Attach 2-3 image Assets to every simple product so storefront cards and
  // the PDP render real <img> tags out of the box. Images are inline
  // `data:image/svg+xml` placeholders built from the Storefront UI reference
  // glyphs (`productPlaceholderSvg`), so re-seeding is stable, fully offline
  // (no external `placehold.co` fetch at render time), and visually matches
  // the design. `position` drives ordering and the resolved `primaryAssetUrl`
  // (position 0 = hero image).
  const imageAssetRows: string[] = [];
  const imageAssetParams: unknown[] = [];
  const productImageRows: string[] = [];
  const productImageParams: unknown[] = [];
  // Mirror every seeded image into the new Gallery model (`gallery_items` +
  // `gallery_item_labels`) so seeded products look identical to products whose
  // photos were added by a user through the Assets Library. Without this, the
  // Admin Product card Gallery table reads `gallery_items` (empty for seeded
  // products) and renders "no photos", even though the Storefront falls back to
  // the legacy `product_assets` rows. Labels demonstrate the label feature:
  // position 0 → base_image, 1 → small_image, 2 → thumbnail (when present).
  const galleryItemRows: string[] = [];
  const galleryItemParams: unknown[] = [];
  const galleryLabelRows: string[] = [];
  const galleryLabelParams: unknown[] = [];
  const positionLabels = ['base_image', 'small_image', 'thumbnail'];
  for (const [idx, p] of products.entries()) {
    const leaf = productLeaves[idx]!;
    const bg = leafImageColor(leaf.slug);
    const imageCount = 2 + (idx % 2); // 2 or 3 images per product
    for (let n = 0; n < imageCount; n++) {
      const assetId = crypto.randomUUID();
      const url = productPlaceholderSvg(leaf.slug, bg, n);
      imageAssetRows.push(`(?, 'image', ?, 'image/svg+xml', ?, ?, now(), now())`);
      imageAssetParams.push(assetId, `${p.slug}-${n + 1}.svg`, Buffer.byteLength(url), url);
      productImageRows.push('(?, ?, ?)');
      productImageParams.push(p.id, assetId, n);

      const galleryItemId = crypto.randomUUID();
      galleryItemRows.push('(?, ?, ?, ?, now(), now())');
      galleryItemParams.push(galleryItemId, p.id, assetId, n);
      const label = positionLabels[n];
      if (label) {
        galleryLabelRows.push('(?, ?, ?)');
        galleryLabelParams.push(galleryItemId, p.id, label);
      }
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
  await conn.execute(
    `insert into gallery_items (id, product_id, asset_id, position, created_at, updated_at)
     values ${galleryItemRows.join(', ')}`,
    galleryItemParams,
  );
  await conn.execute(
    `insert into gallery_item_labels (gallery_item_id, product_id, label) values ${galleryLabelRows.join(', ')}`,
    galleryLabelParams,
  );

  // --- Composite product wiring (T133, US5) ---------------------------
  // The composites' own structure. Their category and channel membership left
  // with the bridges above: both are join tables no single module owns, and a
  // composite is bridged by exactly the rule every other demo product is.
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

  // ── T220, batch 1 ────────────────────────────────────────────────────────
  // `delivery_methods`, `payment_methods` and `taxes`. Verbatim from
  // `demo-host-residue.ts`, less the granted credit limit that sat between the
  // payment methods and the warehouses: that row is `credit_limits`' against
  // the demo organisation, so it is two modules' and stays in the residue until
  // it becomes a composition step.

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
    // Feature 085 (FR-003) — the shipped default; a declined payment holds the
    // order rather than ending it.
    statusOnFailure: 'on_hold',
  });
  await em.persistAndFlush(bankTransfer);

  // The platform's headline B2B payment path, seeded so a fresh dev environment
  // shows it (feature 080, D5). `credit_limit` has been a first-class
  // `paymentMethodKindSchema` member and a registered adapter all along, and
  // checkout already offers it — but only when an operator has created the row,
  // which no seed did, so the capability read as missing.
  //
  // `statusOnSuccess: 'paid'` is what a settled deferred payment means; the
  // reservation itself is opened inside the placement transaction and the order
  // waits in `new` until the proforma is settled.
  const creditLimitMethod = em.create(PaymentMethod, {
    code: 'credit_limit',
    name: { 'en-US': 'Credit limit', 'pl-PL': 'Limit kupiecki' },
    kind: 'credit_limit',
    adapter: 'credit_limit',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'on_hold',
  });
  await em.persistAndFlush(creditLimitMethod);

  // --- Polish VAT Tax (T166) ------------------------------------------
  em.create(Tax, {
    code: 'pl_vat_23',
    name: 'PL VAT 23%',
    rate: '0.23',
    country: 'PL',
    isDefault: true,
  });
  await em.flush();
  // ── T223, batch 2 ────────────────────────────────────────────────────────
  // `inventory`. Verbatim from `demo-host-residue.ts` **but for two string
  // values**, and the deviation is the batch's one deliberate content change:
  // `Magazyn Kraków` and `Demo secondary warehouse — Kraków, PL` are Polish
  // prose in a scalar column, so on the move they became
  // `check:default-language-prose` findings — measured, two of them — and
  // neither of that check's two answers was available. A per-language map has
  // nowhere to go (`Warehouse.name` is a `varchar(160)`), and a ledger entry is
  // what T223's own obligation forbids. So the value is English on both sides,
  // and the parity comparison holds over the changed value rather than hiding
  // the change.

  // --- Feature 010 — multi-warehouse demo data (T085) ----------------
  // Add a second warehouse and spread stock between it and the seeded
  // `default` warehouse so the inventory landing, per-product roster, and
  // channel-binding panels all have real data to render. The existing channels
  // keep `default` as their default warehouse (the boot-time
  // WarehouseChannelReconciler handled that) and gain a second non-default
  // assignment for the demo warehouse.
  const krakowWarehouseId = '00000000-0000-4000-8000-00000000d0c0';
  let krakow = await em.findOne(Warehouse, { id: krakowWarehouseId });
  if (!krakow) {
    krakow = em.create(Warehouse, {
      id: krakowWarehouseId,
      name: 'Krakow warehouse',
      code: 'pl-krk',
      active: true,
      description: 'Demo secondary warehouse — Krakow, PL',
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

  // ── T222, batch 3 ────────────────────────────────────────────────────────
  // `admin_roles`, `admin_users` and `organizations`, plus the two links that
  // are the composition's on the composed path: the role each administrator
  // holds, and the credit limit granted to the demo organisation. Verbatim from
  // `demo-host-residue.ts`.
  //
  // **The links are written inline here and are steps 6 and 7 there**, and that
  // asymmetry is the freeze working rather than a divergence: this file is one
  // program with every row in hand, so it assigns a role id in the same
  // statement that creates the account, exactly as the host block did. The
  // composed path cannot — `admin_users` may not write `admin_roles`' id and
  // `admin_roles` may not create an account — so it creates the two sides
  // separately and joins them afterwards. The comparison is over the database
  // both produce, which is what makes the two shapes checkable against each
  // other at all.

  // --- Demo Organization + buyer --------------------------------------
  const adminPasswordHash = await hashPassword(DEMO_ADMIN_PASSWORD);

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
    permissions: [...SALES_REPRESENTATIVE_PERMISSIONS],
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

  // --- The granted credit limit (T166) --------------------------------
  //
  // On the composed path it is step 7 of `demo-composition.ts` — `credit_limits`
  // owns the row and `organizations` owns the party it is granted to, so it is
  // two modules' rows in one statement and no module's demo data (§5.1).
  //
  // It is what makes `payment_methods`' `credit_limit` method visible at all:
  // checkout hides that method from a buyer whose organization holds no grant,
  // and again when the cart exceeds what is available. Without this row the
  // demo would offer an option no seeded buyer can ever see, which is the same
  // "capability reads as missing" the method was seeded to fix.
  const demoCreditLimit = em.create(CreditLimit, {
    organizationId: demoOrg.id,
    grantedAmount: '50000.00',
    currency: 'PLN',
  });
  await em.persistAndFlush(demoCreditLimit);

  return { categoryNodes: 1 + sections.length + leaves.length, products: PRODUCT_COUNT };
}
