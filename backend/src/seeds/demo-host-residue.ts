/**
 * The demo rows that have not reached their own modules yet (feature 113,
 * T211/T213 — `specs/113-module-owned-demo-data/` §2 and §3).
 *
 * This is `dev-catalog-seed.ts`' 887-line `main()` with two things taken out of
 * it: the cross-module **wiring**, which went to `demo-composition.ts` because a
 * step that touches more than one module's rows may live in no module (§5.1),
 * and the entry point, which stayed behind as a script. What is left is the
 * corpus — categories, attributes, 200 products, composites, images,
 * attachments, the identities, the delivery and payment methods, the second
 * warehouse and the Polish VAT rate — every block of which writes exactly one
 * module's tables from literals.
 *
 * **It is a residue, and its size is the measure of the work left.** Phase 2
 * empties it batch by batch: each module declares its demo data in its own
 * `manifest.ts` and creates it from its own `src/backend/demo/`, and the
 * corresponding block leaves this file in the same merge request. When the last
 * one goes, this file goes with it (T226) — it is not a home, it is a queue.
 *
 * It is a **module** rather than a script so that both entry points can run it:
 * `dev-catalog-seed.ts` (`seed:dev`, the developer bootstrap) and
 * `endora demo seed`, which runs it where a module's own `seed` would run —
 * before the composition is applied. Two callers, one corpus; a residue that
 * only one of them could reach would make the two seeds different shops, which
 * is exactly what `test/integration/demo/demo-parity.test.ts` refuses.
 *
 * Nothing here opens a database, opens a scope or checks the guard. All three
 * are the entry point's (§3.3, §3.4), which is what lets this file be called
 * from a composed CLI and from a bare script without either of them deciding
 * something the other has already decided.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { SALES_REPRESENTATIVE_PERMISSIONS } from './seeded-role-permissions.js';
import { entities as catalogEntities } from '@endora-commerce/mod-catalog/backend';
import type { Product as ProductRow } from '../../../packages/modules/catalog/dist/backend/entities/product.entity.js';
import type { Category as CategoryRow } from '../../../packages/modules/catalog/dist/backend/entities/category.entity.js';
import type { AttributeSetAttribute as AttributeSetAttributeRow } from '../../../packages/modules/catalog/dist/backend/entities/attribute-set-attribute.entity.js';
import { createAttributeFixture } from './attribute-fixtures.js';
import { SalesChannel } from '../kernel/sales-channels/sales-channel.entity.js';
import { entities as creditLimitsEntities } from '@endora-commerce/mod-credit-limits/backend';
import { entities as organizationsEntities } from '@endora-commerce/mod-organizations/backend';
import { entities as adminUsersEntities } from '@endora-commerce/mod-admin-users/backend';
import { entities as adminRolesEntities } from '@endora-commerce/mod-admin-roles/backend';
import { entityNamed } from '../packages/package-entity-lookup.js';
// The row shapes for the three classes above. A module package publishes its
// entities as one array and no class by name (D-168), so the *value* comes off
// the array and the *type* comes from the entity's declaration inside the
// package's built artefact — the emitted `.d.ts`, because this file is in a
// build whose `rootDir` is `src/` and a `.ts` outside it is TS6059 even for an
// `import type`. Nothing is constructed: `import type` erases, so there is no
// second copy of anything (D-160.6.1). See `src/packages/package-entity-lookup.ts`.
import type { CreditLimit as CreditLimitRow } from '../../../packages/modules/credit_limits/dist/backend/entities/credit-limit.entity.js';
import type { Organization as OrganizationRow } from '../../../packages/modules/organizations/dist/backend/entities/organization.entity.js';
import type { AdminUser as AdminUserRow } from '../../../packages/modules/admin_users/dist/backend/entities/admin-user.entity.js';
import type { AdminRole as AdminRoleRow } from '../../../packages/modules/admin_roles/dist/backend/entities/admin-role.entity.js';
import type { Warehouse as WarehouseRow } from '../../../packages/modules/inventory/dist/backend/entities/warehouse.entity.js';
import type { WarehouseChannelAssignment as WarehouseChannelAssignmentRow } from '../../../packages/modules/inventory/dist/backend/entities/warehouse-channel-assignment.entity.js';
import { hashPassword } from '../kernel/crypto/password-hasher.js';
import {
  entities as inventoryEntities,
  WarehouseChannelReconciler,
} from '@endora-commerce/mod-inventory/backend';

/**
 * `catalog`'s three entity classes, taken off the package's published `entities`
 * array by name (D-168, feature 080 T040b — criterion 7).
 *
 * At module scope rather than inside `seedDevCatalog` because the category loop
 * constructs a `Category` two hundred lines above the block below, which is
 * where the other packages' classes are resolved. The row types come from an
 * `import type` of the declaration inside the package's **built** artefact —
 * `dist` and not `src`, because `backend/tsconfig.build.json` sets
 * `rootDir: ./src` and a `.ts` outside it is TS6059 even for a type-only import.
 * With eighteen classes in the array the row type is what stops `em.create`
 * checking a product payload against whichever constituent of the union
 * TypeScript picks.
 */
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

export const DEMO_ADMIN_EMAIL = 'admin@demo.local';
export const DEMO_ADMIN_PASSWORD = 'ChangeMe!123';
const DEMO_ORG_NAME = 'Acme B2B (demo)';
const DEMO_ORG_TAX_ID = 'PL5210000099';

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


/** What the caller prints. Counted here because only this file knows. */
export interface HostResidueSummary {
  readonly categoryNodes: number;
  readonly products: number;
}

/**
 * Withdraw the residue's rows (T213).
 *
 * This is the `truncate table ... cascade` that used to open the seed, moved
 * to where a withdrawal belongs. It stays one statement over one list while
 * the rows it removes are one file's; every module that takes its block back
 * in Phase 2 takes its tables out of this list with it, and the list is empty
 * on the day the file is deleted.
 *
 * **Moving it is a repair and not only a tidy-up.** At the head of `seed` it
 * ran on a freshly migrated database and destroyed rows four migrations had
 * seeded — 15 payment methods, 4 delivery methods and 15 adapter rule rows,
 * measured — so a developer's `seed:dev` silently took the platform's own
 * data away. A withdrawal that an operator asks for by name may do that; a
 * seed may not.
 *
 * **T220 took `taxes`, `delivery_methods` and `payment_methods` off the list**,
 * and that is the second half of the same repair. Each of those modules now
 * withdraws its own demo rows by the fixed codes its `seed` assigns (contract
 * §2.5), so the reset stops taking the rows this file never created: the five
 * gateway modules' migration-seeded methods, their adapter rules, and whatever
 * the operator added. A truncate cannot tell a demo row from an operator's, and
 * that is exactly why it may not be the withdrawal for a table this file has
 * stopped writing.
 */
export async function resetHostModuleResidue(em: EntityManager): Promise<void> {
  const conn = em.getConnection();
  // In dependency order.
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
      price_lists
    cascade
  `);
  // Feature 061 — product attributes are backed by product-host custom-field
  // definitions; clear them so re-seeding never hits the duplicate-key guard.
  // Other hosts' definitions are left untouched.
  await conn.execute(
    `delete from custom_field_options cfo
      using custom_field_definitions cfd
      where cfd.id = cfo.definition_id and cfd.entity_type = 'product'`,
  );
  await conn.execute(`delete from custom_field_definitions where entity_type = 'product'`);

}

/**
 * Create the residue's rows.
 *
 * The caller has opened the database, entered a system scope and passed the
 * production guard. Runs before the composition, which is where a module's own
 * `seed` runs (§5.5).
 */
export async function seedHostModuleResidue(em: EntityManager): Promise<HostResidueSummary> {
  const conn = em.getConnection();

  // --- Sales Channels --------------------------------------------------
  //
  // The retail channel **adopts the instance's system-default channel if there
  // already is one**, and creates it otherwise. Both branches are reached in
  // practice and the difference is the entry point, not the database:
  // `endora demo seed` composes the platform first, and one of the boot
  // reconcilers inserts a `default` system-default channel into an empty table
  // (D-47…D-51 — exactly one always exists, and the platform is what
  // guarantees it). `seed:dev` boots nothing, so it finds none.
  //
  // Creating a second one is not an option: `sales_channels_one_system_default`
  // is a real unique index and the insert fails outright — measured, on the
  // first composed run of this file. Nor is leaving the platform's placeholder
  // beside the demo's own channel: `sales_channel_id` is what every
  // channel-scoped setting, warehouse assignment and product binding is keyed
  // on, so a demo that ignores the incumbent leaves the instance's *actual*
  // default channel selling nothing.
  //
  // The public channel doubles as the system default so header-less requests
  // (anonymous storefront, direct API hits) resolve here instead of tripping
  // the resolver's "registry empty" guard. Without it the reconciler would
  // promote the lexically-first channel — `pl_b2b_vip`, logged-in only, the
  // wrong default for a storefront.
  const incumbent = await em.findOne(SalesChannel, { systemDefault: true });
  const retail =
    incumbent ??
    em.create(SalesChannel, {
      code: 'pl_retail',
      systemDefault: true,
      defaultLanguage: 'pl-PL',
      defaultCurrency: 'PLN',
    });
  retail.code = 'pl_retail';
  retail.name = { 'en-US': 'PL Retail', 'pl-PL': 'PL Retail' };
  retail.isPublic = true;
  retail.languages = ['pl-PL', 'en-US'];
  retail.defaultLanguage = 'pl-PL';
  retail.currencies = ['PLN', 'EUR'];
  retail.defaultCurrency = 'PLN';
  retail.active = true;
  retail.status = 'active';
  em.persist(retail);
  const b2bVip = em.create(SalesChannel, {
    code: 'pl_b2b_vip',
    name: { 'en-US': 'PL B2B VIP', 'pl-PL': 'PL B2B VIP' },
    isPublic: false,
    languages: ['pl-PL', 'en-US'],
    defaultLanguage: 'pl-PL',
    currencies: ['PLN', 'EUR'],
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

  // The remaining entity classes come from packages, and a module package publishes
  // one `entities` array and no class by name (D-168). `entityNamed` takes each
  // off the array the ORM itself registered — `entities-registry.generated.ts`
  // imports the same export — under the row type imported above, so the payloads
  // below are checked against the entity actually being created rather than
  // against whichever constituent of the array's union TypeScript picks.
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
  const AdminUser = entityNamed<AdminUserRow>(
    adminUsersEntities,
    'AdminUser',
    '@endora-commerce/mod-admin-users/backend',
  );
  const AdminRole = entityNamed<AdminRoleRow>(
    adminRolesEntities,
    'AdminRole',
    '@endora-commerce/mod-admin-roles/backend',
  );
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

  // The demo buyer's account is the **composition's** and not this block's,
  // and the schema is what forces it: `customer_accounts.organization_id` is
  // `NOT NULL` (Principle XI), so there is no "create the account, then join
  // it" to lift — the account and its organisation are created together, and
  // the composition is the only place that holds both. See step 5 of
  // `demo-composition.ts`.

  // --- The granted credit limit (T166) --------------------------------
  //
  // The delivery method and the two payment methods that used to open this
  // block are `delivery_methods`' and `payment_methods`' own demo data now
  // (feature 113, T220): each module declares it in its `manifest.ts` and
  // creates it from its own `src/backend/demo/`.
  //
  // The grant stays, and it is not a leftover. `credit_limits` owns the row and
  // `organizations` owns the party it is granted to, so it is two modules' rows
  // in one statement — a composition step (contract §5.1) and no module's demo
  // data. It sits here beside the organisation it needs until batch 3 decides
  // where it goes.
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

  // `taxes`' Polish VAT rule is that module's own demo data now (T220).

  return { categoryNodes: 1 + sections.length + leaves.length, products: PRODUCT_COUNT };
}
