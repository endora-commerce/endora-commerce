/**
 * This instance's demo composition (feature 113, T211;
 * `specs/113-module-owned-demo-data/contracts/module-demo-data-layer.md` §5).
 *
 * **§5.1** — *"any demo wiring that touches more than one module's rows is a
 * composition step and MUST NOT live in any module."* These are those steps,
 * lifted out of the developer seed script's 887-line `main()`, which was one
 * function holding both a dozen modules' demo rows and the wiring between them.
 *
 * ## Two phases, and one of them is narrow on purpose (§5.5a)
 *
 * `STEPS` is the wiring and runs **after** every module's `seed`; it can only
 * run there, because a step that joins two modules' rows needs both to exist.
 * `FOUNDATION_STEPS` runs **before** the first `seed` and holds exactly what a
 * module's own body **reads** and no module may own — today the demo's two
 * sales channels, which are the kernel's table and which `inventory`'s body
 * enumerates to place its warehouse. The withdrawals are the exact reverse:
 * the wiring first, the foundation last.
 *
 * ## Why this had to come out before any module moved
 *
 * The wiring did not read the database; it read `main()`'s **locals**. The
 * megamenu block held `sections` and `leaves`, produced 120 lines above by the
 * category block; the bridge block held `products` and `productLeaves`. Nothing
 * about an in-memory handoff survives a split into independent seeders, because
 * there is no process in which both halves are in memory — so a module block
 * that left first would strand the local a later step reads. Every step below
 * is therefore rewritten as a **query-shaped read** (`research.md` § R3(b)):
 * it asks the database for what it needs, which is the only thing a
 * composition can do once each module seeds itself.
 *
 * ## Why it is not `megamenu`'s demo data, and not the platform's
 *
 * `megamenu` does not declare `catalog` in its `dependencies` and is right not
 * to — a menu item's target is a `{ categoryId }` JSON blob and there is no
 * runtime edge. Making the demo create one would be a **lifecycle** edge
 * created by a demo: it would change the migration order and make `catalog`'s
 * activation control partly `megamenu`'s problem (R3.1, D-3). And this file
 * cannot live in `@endora-commerce/platform` either: a platform root naming
 * `megamenu` and `catalog` is D-52/D-53's one rule with an exception (§5.3).
 * It lives with whoever owns the instance, which in this repository is the host
 * tree (§5.2).
 *
 * ## The guard is per step and per module (§5.4)
 *
 * *"Every composition step MUST be guarded by an effective-presence question
 * about **every** module it touches, and a step whose modules are not all
 * present MUST be a reported skip carrying the reason."* Never a throw and
 * never a silence: an instance without `megamenu` is an ordinary instance whose
 * shop has no menu, and the operator reads why.
 *
 * The presence oracle is a **parameter**. The composed CLI passes
 * `effectiveState.isPresent`, which is the conjunction of both presence axes.
 * A caller that composed no platform has no registry cache to ask, and a cold
 * cache answers `false` for everything (fail-closed, correctly), so such a
 * caller must pass its own oracle rather than consult one.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DemoComposition, DemoCompositionResult } from '../demo/index.js';
import type { DemoCredential } from '@endora-commerce/contracts';
import { SalesChannel } from '../kernel/sales-channels/sales-channel.entity.js';
import { hashPassword } from '../kernel/crypto/password-hasher.js';
import { entityNamed } from '../packages/package-entity-lookup.js';
import { createAttributeFixture, findAttributeDefinitionByKey } from './attribute-fixtures.js';
import { entities as catalogEntities } from '@endora-commerce/mod-catalog/backend';
import { entities as megamenuEntities } from '@endora-commerce/mod-megamenu/backend';
import {
  entities as inventoryEntities,
  DEFAULT_WAREHOUSE_ID,
} from '@endora-commerce/mod-inventory/backend';
import { entities as customerAccountsEntities } from '@endora-commerce/mod-customer-accounts/backend';
import { entities as adminRolesEntities } from '@endora-commerce/mod-admin-roles/backend';
import { entities as adminUsersEntities } from '@endora-commerce/mod-admin-users/backend';
import { entities as creditLimitsEntities } from '@endora-commerce/mod-credit-limits/backend';
import { entities as organizationsEntities } from '@endora-commerce/mod-organizations/backend';
import { DefaultPriceListMigrator } from '@endora-commerce/mod-price-lists/backend';
import { CatalogProductReadService } from '@endora-commerce/mod-catalog/backend';
// The row shapes for the classes taken off those arrays. A module package
// publishes its entities as one array and no class by name (D-168), so the
// *value* comes off the array and the *type* comes from the entity's
// declaration inside the package's built artefact — the emitted `.d.ts`,
// because this file is in a build whose `rootDir` is `src/` and a `.ts` outside
// it is TS6059 even for an `import type`. Nothing is constructed from these:
// `import type` erases, so there is no second copy of anything (D-160.6.1).
import type { Category as CategoryRow } from '../../../packages/modules/catalog/dist/backend/entities/category.entity.js';
import type { Product as ProductRow } from '../../../packages/modules/catalog/dist/backend/entities/product.entity.js';
import type { Megamenu as MegamenuRow } from '../../../packages/modules/megamenu/dist/backend/entities/megamenu.entity.js';
import type { MegamenuItem as MegamenuItemRow } from '../../../packages/modules/megamenu/dist/backend/entities/megamenu-item.entity.js';
import type { MegamenuBinding as MegamenuBindingRow } from '../../../packages/modules/megamenu/dist/backend/entities/megamenu-binding.entity.js';
import type { StockLevel as StockLevelRow } from '../../../packages/modules/inventory/dist/backend/entities/stock-level.entity.js';
import type { Warehouse as WarehouseRow } from '../../../packages/modules/inventory/dist/backend/entities/warehouse.entity.js';
import type { CustomerAccount as CustomerAccountRow } from '../../../packages/modules/customer_accounts/dist/backend/entities/customer-account.entity.js';
import type { Organization as OrganizationRow } from '../../../packages/modules/organizations/dist/backend/entities/organization.entity.js';
import type { AdminRole as AdminRoleRow } from '../../../packages/modules/admin_roles/dist/backend/entities/admin-role.entity.js';
import type { AdminUser as AdminUserRow } from '../../../packages/modules/admin_users/dist/backend/entities/admin-user.entity.js';
import type { CreditLimit as CreditLimitRow } from '../../../packages/modules/credit_limits/dist/backend/entities/credit-limit.entity.js';
import type { AttributeSetAttribute as AttributeSetAttributeRow } from '../../../packages/modules/catalog/dist/backend/entities/attribute-set-attribute.entity.js';
import type { CustomFieldDefinition as CustomFieldDefinitionRow } from '../../../packages/modules/custom_fields/dist/backend/entities/custom-field-definition.entity.js';

const Category = entityNamed<CategoryRow>(
  catalogEntities,
  'Category',
  '@endora-commerce/mod-catalog/backend',
);
const Product = entityNamed<ProductRow>(
  catalogEntities,
  'Product',
  '@endora-commerce/mod-catalog/backend',
);
const Megamenu = entityNamed<MegamenuRow>(
  megamenuEntities,
  'Megamenu',
  '@endora-commerce/mod-megamenu/backend',
);
const MegamenuItem = entityNamed<MegamenuItemRow>(
  megamenuEntities,
  'MegamenuItem',
  '@endora-commerce/mod-megamenu/backend',
);
const MegamenuBinding = entityNamed<MegamenuBindingRow>(
  megamenuEntities,
  'MegamenuBinding',
  '@endora-commerce/mod-megamenu/backend',
);
const StockLevel = entityNamed<StockLevelRow>(
  inventoryEntities,
  'StockLevel',
  '@endora-commerce/mod-inventory/backend',
);
const Warehouse = entityNamed<WarehouseRow>(
  inventoryEntities,
  'Warehouse',
  '@endora-commerce/mod-inventory/backend',
);
const CustomerAccount = entityNamed<CustomerAccountRow>(
  customerAccountsEntities,
  'CustomerAccount',
  '@endora-commerce/mod-customer-accounts/backend',
);
const Organization = entityNamed<OrganizationRow>(
  organizationsEntities,
  'Organization',
  '@endora-commerce/mod-organizations/backend',
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
const AttributeSetAttribute = entityNamed<AttributeSetAttributeRow>(
  catalogEntities,
  'AttributeSetAttribute',
  '@endora-commerce/mod-catalog/backend',
);

/**
 * The demo shop's own vocabulary, which is this file's to hold.
 *
 * A composition describes *its* shop, so naming the demo's category slugs below
 * is not the "deterministic-id convention" R3.1 refuses — that one was a
 * *module* computing another module's ids behind the platform's back. This is
 * the instance's own file saying which categories its menu mirrors, in which
 * order, under which labels. The order matters and cannot be recovered from the
 * database: the seeded categories carry no `sort_order` and their ids are
 * random, so "read them back sorted" would silently reorder the menu.
 *
 * The buyer's credentials are here because step 5 creates the account, and
 * that step declares them so the runner prints them beside the modules' own
 * (`DemoCompositionResult.credentials`, feature 113 T226).
 */
export const DEMO_BUYER_EMAIL = 'buyer@demo-org.example';
export const DEMO_BUYER_PASSWORD = 'ChangeMe!123';
const DEMO_ORG_TAX_ID = 'PL5210000099';
/** The demo's two sales channels, by the codes the foundation step assigns. */
const DEMO_RETAIL_CHANNEL_CODE = 'pl_retail';
const DEMO_VIP_CHANNEL_CODE = 'pl_b2b_vip';
const DEMO_MENU_NAME = 'Main navigation';

/**
 * Which demo administrator holds which role (feature 113, T222).
 *
 * The instance's own statement about its shop, in the file that holds every
 * other one: `admin_users` creates the accounts and `admin_roles` creates the
 * roles, and neither may write the other's table, so the pairing has nowhere
 * else to live (§5.1). Keyed on the natural keys both modules assign — an
 * e-mail address and a role code — because ids are minted per run.
 */
const DEMO_ADMIN_ROLE_ASSIGNMENTS: readonly { readonly email: string; readonly roleCode: string }[] =
  [
    { email: 'admin@demo.local', roleCode: 'platform_admin' },
    { email: 'sales-rep@demo.local', roleCode: 'sales_representative' },
    { email: 'sales-rep-other@demo.local', roleCode: 'sales_representative' },
  ];

/** What the demo organisation may buy on account, and in which currency. */
const DEMO_CREDIT_LIMIT = { grantedAmount: '50000.00', currency: 'PLN' } as const;

/**
 * The demo's product attributes (feature 113, T224).
 *
 * Each one is a `custom_field_definitions` row paired 1:1 with a
 * `product_attributes` extension row — `custom_fields`' table and `catalog`'s,
 * written in one call — so the whole vocabulary is the composition's (§5.1).
 * That is a **correction to §3.3**, which proposed splitting the pair between
 * the two modules with an advisory `after` edge: `catalog` would have had to
 * read `custom_field_definitions` to find the id its extension row references,
 * and §2.2 forbids a demo body reading another module's table. The split has no
 * implementation, and the pair has always been composition — `attribute-
 * fixtures.ts` says so in its own header, and calling it from here is what keeps
 * FR-019's one copy of the helper.
 *
 * The set membership below is `catalog`'s `attribute_set_attributes`, which
 * references the same definition and is therefore the same step's.
 */
const DEMO_PRODUCT_ATTRIBUTES: readonly Parameters<typeof createAttributeFixture>[1][] = [
  {
    key: 'color',
    label: { 'en-US': 'Color' },
    labelDefault: 'Color',
    valueType: 'enum',
    isSearchable: true,
    isFilterable: true,
    sortOrder: 0,
    options: ['red', 'green', 'blue', 'black', 'white'].map((value, index) => ({
      value,
      labelDefault: value,
      sortOrder: index,
    })),
  },
  {
    key: 'material',
    label: { 'en-US': 'Material' },
    labelDefault: 'Material',
    valueType: 'enum',
    isFilterable: true,
    sortOrder: 1,
    options: ['steel', 'aluminium', 'plastic', 'wood', 'glass'].map((value, index) => ({
      value,
      labelDefault: value,
      sortOrder: index,
    })),
  },
  {
    key: 'weight_kg',
    label: { 'en-US': 'Weight (kg)' },
    labelDefault: 'Weight (kg)',
    valueType: 'number',
    isFilterable: true,
    sortOrder: 2,
  },
  {
    key: 'certification',
    label: { 'en-US': 'Certification' },
    labelDefault: 'Certification',
    valueType: 'string',
    isSearchable: true,
    sortOrder: 3,
  },
  {
    key: 'internal_sku_notes',
    label: { 'en-US': 'Internal SKU notes' },
    labelDefault: 'Internal SKU notes',
    valueType: 'string',
    isSearchable: true,
    sortOrder: 4,
  },
  // Feature 002 — sample attributes of the new API-form types so the admin UI
  // editor can demonstrate `multiselect` and `price` paths.
  {
    key: 'compatible_systems',
    label: { 'en-US': 'Compatible systems' },
    labelDefault: 'Compatible systems',
    valueType: 'multiselect',
    isSearchable: true,
    isFilterable: true,
    sortOrder: 5,
    options: ['windows', 'macos', 'linux'].map((value, index) => ({
      value,
      labelDefault: value,
      sortOrder: index,
    })),
  },
  {
    key: 'manufacturer_price',
    label: { 'en-US': 'Manufacturer price' },
    labelDefault: 'Manufacturer price',
    valueType: 'price',
    isFilterable: true,
    displayAsSlider: true,
    sortOrder: 6,
  },
];

/**
 * The system Default Attribute Set, created by a migration with a fixed id.
 *
 * Membership is definition-keyed (feature 061), so assigning to it is the same
 * two-module write as the attribute itself.
 */
const DEFAULT_ATTRIBUTE_SET_ID = 'defa0017-0000-4000-8000-000000000000';

/**
 * `?, ?, ?` for a list bound one value at a time.
 *
 * Written out rather than `= any(?)`: MikroORM's connection binds an array by
 * **expanding** it into a comma-separated list, so `any(?)` becomes
 * `any('a', 'b')` and Postgres refuses it — measured on the first composed run
 * of the attachment step.
 */
function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

/** The label each gallery position carries, in the order the demo mints them. */
const GALLERY_POSITION_LABELS = ['base_image', 'small_image', 'thumbnail'];

/** The two documents the demo attaches to its first three products. */
const DEMO_ATTACHMENT_ASSETS = [
  {
    filename: 'sample-certificate.pdf',
    typeCode: 'certificate',
    sizeBytes: 102400,
    url: 'https://example.test/sample-certificate.pdf',
    name: 'CE Marking',
    description: 'Manufacturer-issued conformity statement.',
  },
  {
    filename: 'sample-tech-spec.pdf',
    typeCode: 'tech_spec',
    sizeBytes: 204800,
    url: 'https://example.test/sample-tech-spec.pdf',
    name: 'Datasheet',
    description: null,
  },
] as const;

/**
 * A demo product's creation index, read back off its own slug.
 *
 * The host block held the products in an array and used the array index for the
 * image count and for the first three attachments' numbering. Once each module
 * seeds itself there is no such array, so the index is recovered from the slug
 * the demo mints — `demo-<leaf>-<i padded to 4>` — which is the same
 * query-shaped read the bridge step already makes for the leaf (§ R3(b)).
 * `null` for a slug that does not carry one, which is every composite.
 */
function demoProductOrdinal(slug: string): number | null {
  const tail = slug.slice(DEMO_PRODUCT_SLUG_PREFIX.length).split('-')[1];
  if (tail === undefined || !/^[0-9]{4}$/.test(tail)) return null;
  const parsed = Number(tail);
  return Number.isNaN(parsed) || parsed < 1 ? null : parsed;
}

/** The demo's simple products, in the order the host block created them. */
async function demoSimpleProducts(em: EntityManager): Promise<ProductRow[]> {
  const products = await em.find(Product, {
    slug: { $like: `${DEMO_PRODUCT_SLUG_PREFIX}%` },
  });
  return products
    .filter((product) => demoProductOrdinal(product.slug) !== null)
    .sort((left, right) => demoProductOrdinal(left.slug)! - demoProductOrdinal(right.slug)!);
}
const KRAKOW_WAREHOUSE_CODE = 'pl-krk';
/** Every product the demo seeds slugs itself `demo-<leaf>-<index>`. */
const DEMO_PRODUCT_SLUG_PREFIX = 'demo-';

const MENU_SECTIONS: readonly { readonly slug: string; readonly leaves: readonly string[] }[] = [
  { slug: 'fasteners', leaves: ['screws', 'bolts'] },
  { slug: 'tools', leaves: ['wrenches', 'drills'] },
  { slug: 'electronics', leaves: ['cables', 'sensors'] },
  { slug: 'safety', leaves: ['gloves', 'helmets'] },
];

const MENU_LABELS: Readonly<Record<string, Record<string, string>>> = {
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

const MENU_LANGUAGES: readonly string[] = ['pl-PL', 'en-US'];

export interface DemoCompositionDeps {
  /** A forked EntityManager, inside the caller's system scope. */
  readonly em: EntityManager;
  /**
   * Effective presence, per §5.4 — the conjunction of both axes, never one of
   * them, and never re-derived here.
   */
  readonly isPresent: (moduleId: string) => boolean;
}

/**
 * One step: what it is called, whose rows it touches, and the two directions.
 *
 * `modules` is the guard's whole input. It lists the modules whose **rows** the
 * step writes or joins, and deliberately not the kernel: sales channels are the
 * kernel's table and the kernel has no activation control to ask about.
 */
interface CompositionStep {
  readonly name: string;
  readonly modules: readonly string[];
  /**
   * Sign-in details this step creates, reported when — and only when — it runs.
   *
   * Declared rather than returned: they are constants of this instance's demo,
   * so a step that was skipped for an absent module must not advertise an
   * account nobody can sign in with, and that falls out of collecting them at
   * the same place the step is applied.
   */
  readonly credentials?: readonly DemoCredential[];
  apply(em: EntityManager): Promise<void>;
  withdraw(em: EntityManager): Promise<void>;
}

/**
 * The demo's placeholder product art (feature 113, T224).
 *
 * Moved here from the developer seed script with the block that uses it, and
 * the block is a **composition step**: every image mints an `assets` row —
 * `assets_library`'s table — and hands its id to four of `catalog`'s, so it is
 * two modules' rows in one statement (§5.1). T224's task text expected all four
 * content helpers to move into `catalog`; two of them describe an asset rather
 * than a product, and they went where the rows go.
 *
 * The images are inline `data:image/svg+xml`, built in-process: re-seeding is
 * stable, nothing is fetched at render time, and a generated catalogue costs the
 * same shipped bytes at 200 products as at 10 000 — which is the property the
 * Phase 3 budget assumes.
 */
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

/** The categories the menu names, by slug, from the database. */
async function categoriesBySlug(em: EntityManager): Promise<Map<string, CategoryRow>> {
  const wanted = MENU_SECTIONS.flatMap((section) => [section.slug, ...section.leaves]);
  const found = await em.find(Category, { slug: { $in: wanted } });
  return new Map(found.map((category) => [category.slug, category]));
}

function labelFor(slug: string, category: CategoryRow): Record<string, string> {
  const declared = MENU_LABELS[slug];
  if (declared) return declared;
  const english = category.name['en-US'];
  return { 'en-US': english === undefined ? slug : english };
}

/**
 * The channel every demo product is sold through.
 *
 * The system-default channel, resolved as such and not by code: exactly one
 * always exists (the install creates it and the boot reconciler keeps it), so
 * a "no channel" branch here would be a defect rather than a fallback.
 */
async function systemDefaultChannel(em: EntityManager): Promise<SalesChannel> {
  const channel = await em.findOne(SalesChannel, { systemDefault: true });
  if (channel === null) {
    throw new Error(
      'demo composition: no system-default sales channel. Exactly one always exists — ' +
        'the install creates it and the boot reconciler promotes one if it is missing — ' +
        'so this is a broken database rather than an instance without a channel.',
    );
  }
  return channel;
}

/**
 * The **foundation** (§5.5a, feature 113 T226): rows every module's demo body
 * already assumes, created before the first `seed` and withdrawn after the last
 * `reset`.
 *
 * One step, and the population is not expected to grow: a step belongs here
 * only when a module's own body **reads** what it creates and no module may own
 * it. Everything else is wiring and belongs after the modules, where it can see
 * the rows they wrote.
 *
 * This block was `backend/src/seeds/demo-host-residue.ts` — the last of the
 * 887-line `main()` — and it stayed there through four batches because it had
 * nowhere to go: `sales_channels` is the kernel's table, so §2.1 admits no
 * module declaration and the kernel carries no `demo` field, and the
 * composition's only position was *after* every module's `seed` while
 * `inventory`'s body reads every channel. The platform's runner grew the phase
 * (§5.5a) and the block moved here, which is where every other ownerless demo
 * write in this feature already lives.
 */
const FOUNDATION_STEPS: readonly CompositionStep[] = [
  {
    // ── 0. the demo's two sales channels ──────────────────────────────────
    //
    // The public retail channel doubles as the system default so header-less
    // requests (anonymous storefront, direct API hits) resolve here instead of
    // tripping the resolver's "registry empty" guard. Without it the reconciler
    // would promote the lexically-first channel — `pl_b2b_vip`, logged-in only,
    // the wrong default for a storefront.
    name: "the demo's two sales channels",
    // No module. `sales_channels` is the kernel's table and the kernel has no
    // activation control to ask about, so this step's guard has nothing to
    // guard and the empty list says so — `absent` is empty, the step always
    // runs. That is the same statement `CompositionStep`'s own doc block makes
    // about `modules` deliberately not listing the kernel.
    modules: [],
    async apply(em) {
      // The retail channel **adopts the instance's system-default channel if
      // there already is one**, and creates it otherwise. Both branches are
      // reached in practice and the difference is the database, not the entry
      // point: one of the boot reconcilers inserts a `default` system-default
      // channel into an empty table (D-47…D-51 — exactly one always exists, and
      // the platform is what guarantees it), so a composed run finds one.
      //
      // Creating a second one is not an option: `sales_channels_one_system_default`
      // is a real unique index and the insert fails outright. Nor is leaving the
      // platform's placeholder beside the demo's own channel: `sales_channel_id`
      // is what every channel-scoped setting, warehouse assignment and product
      // binding is keyed on, so a demo that ignores the incumbent leaves the
      // instance's *actual* default channel selling nothing.
      const incumbent = await em.findOne(SalesChannel, { systemDefault: true });
      const retail =
        incumbent ??
        em.create(SalesChannel, {
          code: DEMO_RETAIL_CHANNEL_CODE,
          systemDefault: true,
          defaultLanguage: 'pl-PL',
          defaultCurrency: 'PLN',
        });
      retail.code = DEMO_RETAIL_CHANNEL_CODE;
      retail.name = { 'en-US': 'PL Retail', 'pl-PL': 'PL Retail' };
      retail.isPublic = true;
      retail.languages = ['pl-PL', 'en-US'];
      retail.defaultLanguage = 'pl-PL';
      retail.currencies = ['PLN', 'EUR'];
      retail.defaultCurrency = 'PLN';
      retail.active = true;
      retail.status = 'active';
      em.persist(retail);
      // Probed rather than created outright — contract §2.4's idempotence
      // applied to a composition step. Until T224 this line was the *only*
      // thing in a demo seed a second run could not survive.
      const existingVip = await em.findOne(SalesChannel, { code: DEMO_VIP_CHANNEL_CODE });
      const b2bVip =
        existingVip ??
        em.create(SalesChannel, {
          code: DEMO_VIP_CHANNEL_CODE,
          name: { 'en-US': 'PL B2B VIP', 'pl-PL': 'PL B2B VIP' },
          isPublic: false,
          languages: ['pl-PL', 'en-US'],
          defaultLanguage: 'pl-PL',
          currencies: ['PLN', 'EUR'],
          defaultCurrency: 'PLN',
        });
      await em.persistAndFlush([retail, b2bVip]);
    },
    async withdraw(em) {
      // **The VIP channel only, and the asymmetry is the adoption above.**
      // `pl_retail` is the instance's own system-default channel wearing the
      // demo's name: the demo did not create it and must not delete it —
      // exactly one system-default channel always exists (D-47…D-51), so a
      // withdrawal that removed it would take the platform's own invariant
      // away and leave every channel-scoped setting pointing at nothing.
      //
      // This replaces a `truncate sales_channels cascade`, which did remove it,
      // and the repair is the same one T213, T222 and T224 each made one table
      // at a time. Measured on a throwaway database before this landed: a
      // `demo reset` left `sales_channels` at 0 and `price_lists` at 0 — the
      // second being the platform's own `default` list, created by a migration
      // and destroyed by the same statement.
      const conn = em.getConnection();
      // The assignment rows first, and by hand rather than by cascade: there is
      // **no foreign key** on `warehouse_channel_assignments.sales_channel_id`,
      // so the truncate this replaces left them dangling — measured, three
      // orphan rows pointing at channels that no longer existed. `inventory`'s
      // own `reset` has already removed the demo warehouse's; these are the
      // *system* warehouse's, made by that module's reconciler for a channel
      // this step created, and they go with the channel that caused them.
      await conn.execute(
        `delete from warehouse_channel_assignments where sales_channel_id in
           (select id from sales_channels where code = ?)`,
        [DEMO_VIP_CHANNEL_CODE],
      );
      await conn.execute(`delete from sales_channels where code = ?`, [
        DEMO_VIP_CHANNEL_CODE,
      ]);
    },
  },
];

const STEPS: readonly CompositionStep[] = [
  {
    // ── 1. the megamenu over the category tree ────────────────────────────
    // A predefined navigation mirroring the seeded tree, so the storefront
    // <Megamenu> renders real, clickable links out of the box: top level is
    // the sections, children are their leaves, bound active for every
    // (channel, language) pair so the resolver always finds a menu whichever
    // scope the storefront asks for.
    name: 'megamenu over the category tree',
    modules: ['megamenu', 'catalog'],
    async apply(em) {
      // Idempotent by the name this step creates the menu under, on contract
      // §2.4's terms — a composition step is as re-runnable as a module body or
      // it is the one thing that stops a second `endora demo seed` (SC-007).
      const held = await em.findOne(Megamenu, { name: DEMO_MENU_NAME });
      if (held !== null) return;
      const categories = await categoriesBySlug(em);
      const menu = em.create(Megamenu, {
        name: DEMO_MENU_NAME,
        description: 'Predefined dev megamenu — mirrors the seeded category tree.',
      });
      await em.persistAndFlush(menu);

      const topItems: MegamenuItemRow[] = [];
      for (const [index, section] of MENU_SECTIONS.entries()) {
        const category = categories.get(section.slug);
        if (category === undefined) continue;
        topItems.push(
          em.create(MegamenuItem, {
            megamenuId: menu.id,
            parentId: null,
            position: index,
            kind: 'category-link',
            labels: labelFor(section.slug, category),
            target: { categoryId: category.id },
          }),
        );
      }
      await em.persistAndFlush(topItems);

      const childItems: MegamenuItemRow[] = [];
      let topIndex = 0;
      for (const section of MENU_SECTIONS) {
        if (categories.get(section.slug) === undefined) continue;
        const parentItem = topItems[topIndex]!;
        topIndex += 1;
        let position = 0;
        for (const leafSlug of section.leaves) {
          const leaf = categories.get(leafSlug);
          if (leaf === undefined) continue;
          childItems.push(
            em.create(MegamenuItem, {
              megamenuId: menu.id,
              parentId: parentItem.id,
              position,
              kind: 'category-link',
              labels: labelFor(leafSlug, leaf),
              target: { categoryId: leaf.id },
            }),
          );
          position += 1;
        }
      }
      await em.persistAndFlush(childItems);

      const channels = await em.find(SalesChannel, {});
      for (const channel of channels) {
        for (const language of MENU_LANGUAGES) {
          em.create(MegamenuBinding, {
            megamenuId: menu.id,
            salesChannelId: channel.id,
            language,
            active: true,
          });
        }
      }
      await em.flush();
    },
    async withdraw(em) {
      // The menu this step created, by the name it created it under. An
      // operator's own menu is a different row and is left alone.
      const conn = em.getConnection();
      await conn.execute(
        `delete from megamenu_bindings where megamenu_id in
           (select id from megamenus where name = ?)`,
        [DEMO_MENU_NAME],
      );
      await conn.execute(
        `delete from megamenu_items where megamenu_id in
           (select id from megamenus where name = ?)`,
        [DEMO_MENU_NAME],
      );
      await conn.execute(`delete from megamenus where name = ?`, [DEMO_MENU_NAME]);
    },
  },
  {
    // ── 2. the product↔category and channel↔product bridges ───────────────
    // Two join tables, neither of which either module owns alone. The leaf a
    // product belongs to is read off the product's **own slug**, which the
    // demo mints as `demo-<leaf>-<index>`: the previous shape kept a parallel
    // `productLeaves` array in memory beside the products, and an off-by-one
    // between the naming loop and the category loop once filed every product
    // under its neighbouring category.
    name: 'product↔category and channel↔product bridges',
    modules: ['catalog'],
    async apply(em) {
      const conn = em.getConnection();
      const channel = await systemDefaultChannel(em);
      const products = await em.find(Product, {
        slug: { $like: `${DEMO_PRODUCT_SLUG_PREFIX}%` },
      });
      const leafSlugs = new Set(MENU_SECTIONS.flatMap((section) => section.leaves));
      const categories = await categoriesBySlug(em);
      const firstLeaf = categories.get(MENU_SECTIONS[0]!.leaves[0]!);

      const categoryRows: string[] = [];
      const categoryParams: unknown[] = [];
      const channelRows: string[] = [];
      const channelParams: unknown[] = [];
      for (const product of products) {
        const segment = product.slug.slice(DEMO_PRODUCT_SLUG_PREFIX.length).split('-')[0];
        // A composite (`demo-grouped-set-0001`) names no leaf, and joins the
        // first one — which is what the previous shape did with `leaves[0]`.
        const leaf =
          segment !== undefined && leafSlugs.has(segment) ? categories.get(segment) : firstLeaf;
        if (leaf !== undefined) {
          categoryRows.push('(?, ?)');
          categoryParams.push(product.id, leaf.id);
        }
        channelRows.push('(?, ?)');
        channelParams.push(channel.id, product.id);
      }
      // `on conflict do nothing` rather than a probe, and the difference
      // matters here: both of these are pure join tables with a composite
      // primary key, so a **partially** bridged catalogue — a product added
      // after the last run — finishes bridging on the next one, which a
      // whole-table probe would skip.
      if (categoryRows.length > 0) {
        await conn.execute(
          `insert into product_categories (product_id, category_id)
            values ${categoryRows.join(', ')}
            on conflict do nothing`,
          categoryParams,
        );
      }
      if (channelRows.length > 0) {
        await conn.execute(
          `insert into sales_channel_products (sales_channel_id, product_id)
            values ${channelRows.join(', ')}
            on conflict do nothing`,
          channelParams,
        );
      }
    },
    async withdraw(em) {
      const conn = em.getConnection();
      await conn.execute(
        `delete from product_categories where product_id in
           (select id from products where slug like ?)`,
        [`${DEMO_PRODUCT_SLUG_PREFIX}%`],
      );
      await conn.execute(
        `delete from sales_channel_products where product_id in
           (select id from products where slug like ?)`,
        [`${DEMO_PRODUCT_SLUG_PREFIX}%`],
      );
    },
  },
  {
    // ── 3. the price-list backfill ────────────────────────────────────────
    // The Default price list is created by a migration and gets a bracket per
    // currency from each product's `attributeValues.defaultPrice`. Re-running
    // the migrator picks up whatever the demo just created, so the storefront
    // resolver always finds a Base bracket. It is idempotent, and it asks
    // `catalog` for its products over the published read port rather than
    // importing the entity.
    name: 'price-list backfill over the demo catalogue',
    modules: ['price_lists', 'catalog'],
    async apply(em) {
      await new DefaultPriceListMigrator(() => em).run(new CatalogProductReadService(() => em));
    },
    async withdraw(em) {
      const conn = em.getConnection();
      await conn.execute(
        `delete from price_list_price_brackets where product_id in
           (select id from products where slug like ?)`,
        [`${DEMO_PRODUCT_SLUG_PREFIX}%`],
      );
      await conn.execute(
        `delete from price_list_products where product_id in
           (select id from products where slug like ?)`,
        [`${DEMO_PRODUCT_SLUG_PREFIX}%`],
      );
    },
  },
  {
    // ── 4. the stock spread ───────────────────────────────────────────────
    // 60% of a deterministic per-product quantity in the system warehouse and
    // 40% in the demo's second one, so the inventory landing, the per-product
    // roster and the channel-binding panels all have real data. A product that
    // already carries stock is skipped, so a re-run doubles nothing.
    name: 'stock spread across the demo warehouses',
    modules: ['inventory', 'catalog'],
    async apply(em) {
      const krakow = await em.findOne(Warehouse, { code: KRAKOW_WAREHOUSE_CODE });
      const products = await em.find(Product, {});
      let created = 0;
      for (const product of products) {
        const existing = await em.find(StockLevel, { productId: product.id });
        if (existing.length > 0) continue;
        const baseQuantity = 50 + (parseInt(product.id.replace(/-/g, '').slice(0, 8), 16) % 200);
        const defaultQuantity = Math.floor(baseQuantity * 0.6);
        em.persist(
          em.create(StockLevel, {
            productId: product.id,
            warehouseId: DEFAULT_WAREHOUSE_ID,
            onHand: defaultQuantity,
          }),
        );
        created += 1;
        // The second warehouse is `inventory`'s own demo row. Without it the
        // spread is simply the whole quantity in the default warehouse, which
        // is a coherent shop rather than a broken one.
        if (krakow !== null) {
          em.persist(
            em.create(StockLevel, {
              productId: product.id,
              warehouseId: krakow.id,
              onHand: baseQuantity - defaultQuantity,
            }),
          );
          created += 1;
        }
      }
      if (created > 0) await em.flush();
    },
    async withdraw(em) {
      await em.getConnection().execute(
        `delete from stock_levels where product_id in
           (select id from products where slug like ?)`,
        [`${DEMO_PRODUCT_SLUG_PREFIX}%`],
      );
    },
  },
  {
    // ── 5. the buyer↔organisation membership ──────────────────────────────
    // Principle XI: the Organization is the one tenant concept and every
    // transacting customer has one. Which organisation the demo buyer belongs
    // to is a statement about the shop, not about `customer_accounts` — so it
    // is the composition's.
    //
    // **It is the account's *creation* and not an update, because the schema
    // leaves no other shape.** `customer_accounts.organization_id` is
    // `NOT NULL`: the column was nullable for a year, three write paths
    // produced NULLs, and Principle XI closed it, because MikroORM applies its
    // tenant filter to `SELECT`/`UPDATE`/`DELETE` and not to `INSERT`, so a
    // `NOT NULL` column is the only refusal available for a tenant-less row.
    // So "create the buyer, then join it" cannot be written, and the entity's
    // own doc block says the account and its organisation are created in one
    // transaction. The composition is the only place that holds both.
    name: 'demo buyer joins the demo organisation',
    // The one sign-in the composed report could not print until T226 opened the
    // platform: the buyer is created here and by nothing else, because
    // `customer_accounts.organization_id` is `NOT NULL` (Principle XI).
    credentials: [
      { label: 'Organization Admin', value: `${DEMO_BUYER_EMAIL} / ${DEMO_BUYER_PASSWORD}` },
    ],
    modules: ['customer_accounts', 'organizations'],
    async apply(em) {
      const organization = await em.findOne(Organization, { taxId: DEMO_ORG_TAX_ID });
      if (organization === null) return;
      const existing = await em.findOne(CustomerAccount, { email: DEMO_BUYER_EMAIL });
      if (existing !== null) {
        existing.organizationId = organization.id;
        await em.flush();
        return;
      }
      const buyer = em.create(CustomerAccount, {
        organizationId: organization.id,
        email: DEMO_BUYER_EMAIL,
        passwordHash: await hashPassword(DEMO_BUYER_PASSWORD),
        // Issue #222 — the demo password is a real one, printed by the seed
        // and used to sign in with. An unstamped row would make the demo
        // database the one place where a usable password reads as "none on
        // record".
        passwordSetAt: new Date(),
        firstName: 'Demo',
        lastName: 'Buyer',
        role: 'organization_admin',
        emailVerifiedAt: new Date(),
      });
      await em.persistAndFlush(buyer);
    },
    async withdraw(em) {
      const buyer = await em.findOne(CustomerAccount, { email: DEMO_BUYER_EMAIL });
      if (buyer === null) return;
      await em.removeAndFlush(buyer);
    },
  },
  {
    // ── 6. the product attributes and their Default-set membership ────────
    // A product attribute is a `custom_field_definitions` row paired 1:1 with a
    // `product_attributes` extension row (feature 061), created in one call, so
    // it is two modules' rows in one statement and no module's demo data
    // (§5.1). `attribute-fixtures.ts` is that call and is the one copy of it
    // (FR-019); its own header says a file writing both tables is composition.
    //
    // It runs after `catalog`'s products rather than before them, which the
    // host block did the other way round. Nothing depends on the order:
    // `products.attributeValues` is a JSONB blob naming these attributes by key
    // with no reference to them at all.
    name: 'product attributes over the demo catalogue',
    modules: ['catalog', 'custom_fields'],
    async apply(em) {
      const definitions: CustomFieldDefinitionRow[] = [];
      for (const attribute of DEMO_PRODUCT_ATTRIBUTES) {
        const existing = await findAttributeDefinitionByKey(em, attribute.key);
        if (existing !== null) {
          definitions.push(existing);
          continue;
        }
        const { definition } = await createAttributeFixture(em, attribute);
        definitions.push(definition);
      }

      // Feature 002 — every seeded attribute joins the system Default set, so
      // the admin Product editor lists them out of the box.
      for (const [index, definition] of definitions.entries()) {
        const existing = await em.findOne(AttributeSetAttribute, {
          attributeSetId: DEFAULT_ATTRIBUTE_SET_ID,
          customFieldDefinitionId: definition.id,
        });
        if (existing !== null) continue;
        em.persist(
          em.create(AttributeSetAttribute, {
            attributeSetId: DEFAULT_ATTRIBUTE_SET_ID,
            customFieldDefinitionId: definition.id,
            position: index,
          }),
        );
      }
      await em.flush();
    },
    async withdraw(em) {
      // By the seven keys this step created, and in the order the references
      // run. The host's reset deleted **every** product-host definition, which
      // took an operator's own attributes with it.
      const conn = em.getConnection();
      const keys = DEMO_PRODUCT_ATTRIBUTES.map((attribute) => attribute.key);
      await conn.execute(
        `delete from attribute_set_attributes where custom_field_definition_id in
           (select id from custom_field_definitions
             where entity_type = 'product' and key in (${placeholders(keys.length)}))`,
        keys,
      );
      await conn.execute(
        `delete from product_attributes where custom_field_definition_id in
           (select id from custom_field_definitions
             where entity_type = 'product' and key in (${placeholders(keys.length)}))`,
        keys,
      );
      await conn.execute(
        `delete from custom_field_options where definition_id in
           (select id from custom_field_definitions
             where entity_type = 'product' and key in (${placeholders(keys.length)}))`,
        keys,
      );
      await conn.execute(
        `delete from custom_field_definitions where entity_type = 'product'
            and key in (${placeholders(keys.length)})`,
        keys,
      );
    },
  },
  {
    // ── 7. the product images ─────────────────────────────────────────────
    // Two or three placeholder images per simple product, so storefront cards
    // and the PDP render real `<img>` tags out of the box. Each mints an
    // `assets` row — `assets_library`'s table — and hands its id to
    // `product_assets`, `gallery_items` and `gallery_item_labels`, all
    // `catalog`'s: two modules' rows in one statement (§5.1).
    //
    // The gallery rows mirror the legacy `product_assets` ones so a seeded
    // product looks identical to one whose photos an operator uploaded through
    // the Assets Library — without them the admin Product card's Gallery table
    // reads empty while the storefront falls back to the legacy rows.
    name: 'placeholder images for the demo catalogue',
    modules: ['catalog', 'assets_library'],
    async apply(em) {
      const conn = em.getConnection();
      const products = await demoSimpleProducts(em);
      const held = await conn.execute<{ n: string }[]>(
        `select count(*)::text as n from product_assets where product_id in
           (select id from products where slug like ?)`,
        [`${DEMO_PRODUCT_SLUG_PREFIX}%`],
      );
      // Idempotent by a probe on the join rather than per product: the images
      // are one deterministic batch, so either the demo has them or it has not.
      if (Number(held[0]?.n ?? '0') > 0 || products.length === 0) return;

      const assetRows: string[] = [];
      const assetParams: unknown[] = [];
      const productAssetRows: string[] = [];
      const productAssetParams: unknown[] = [];
      const galleryRows: string[] = [];
      const galleryParams: unknown[] = [];
      const labelRows: string[] = [];
      const labelParams: unknown[] = [];
      for (const [index, product] of products.entries()) {
        const leafSlug = product.slug.slice(DEMO_PRODUCT_SLUG_PREFIX.length).split('-')[0]!;
        const background = leafImageColor(leafSlug);
        const imageCount = 2 + (index % 2); // 2 or 3 images per product
        for (let position = 0; position < imageCount; position++) {
          const assetId = crypto.randomUUID();
          const url = productPlaceholderSvg(leafSlug, background, position);
          assetRows.push(`(?, 'image', ?, 'image/svg+xml', ?, ?, now(), now())`);
          assetParams.push(
            assetId,
            `${product.slug}-${position + 1}.svg`,
            Buffer.byteLength(url),
            url,
          );
          productAssetRows.push('(?, ?, ?)');
          productAssetParams.push(product.id, assetId, position);

          const galleryItemId = crypto.randomUUID();
          galleryRows.push('(?, ?, ?, ?, now(), now())');
          galleryParams.push(galleryItemId, product.id, assetId, position);
          const label = GALLERY_POSITION_LABELS[position];
          if (label) {
            labelRows.push('(?, ?, ?)');
            labelParams.push(galleryItemId, product.id, label);
          }
        }
      }
      await conn.execute(
        `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
         values ${assetRows.join(', ')}`,
        assetParams,
      );
      await conn.execute(
        `insert into product_assets (product_id, asset_id, position) values ${productAssetRows.join(', ')}`,
        productAssetParams,
      );
      await conn.execute(
        `insert into gallery_items (id, product_id, asset_id, position, created_at, updated_at)
         values ${galleryRows.join(', ')}`,
        galleryParams,
      );
      await conn.execute(
        `insert into gallery_item_labels (gallery_item_id, product_id, label) values ${labelRows.join(', ')}`,
        labelParams,
      );
    },
    async withdraw(em) {
      // The asset ids are collected before the joins that name them go, because
      // afterwards nothing in the database says which `assets` rows were the
      // demo's. An operator's own upload against a demo product is a different
      // row and survives: only assets this step created carry both a demo
      // product's slug in their filename and the `.svg` the generator writes.
      const conn = em.getConnection();
      const like = `${DEMO_PRODUCT_SLUG_PREFIX}%`;
      const assets = await conn.execute<{ id: string }[]>(
        `select a.id from assets a
           join product_assets pa on pa.asset_id = a.id
           join products p on p.id = pa.product_id
          where p.slug like ? and a.filename = p.slug || '-' || (pa.position + 1) || '.svg'`,
        [like],
      );
      const ids = assets.map((row) => row.id);
      await conn.execute(
        `delete from gallery_item_labels where product_id in
           (select id from products where slug like ?)`,
        [like],
      );
      await conn.execute(
        `delete from gallery_items where product_id in
           (select id from products where slug like ?)`,
        [like],
      );
      await conn.execute(
        `delete from product_assets where product_id in
           (select id from products where slug like ?)`,
        [like],
      );
      if (ids.length > 0) {
        await conn.execute(
          `delete from assets where id in (${placeholders(ids.length)})`,
          ids,
        );
      }
    },
  },
  {
    // ── 8. the sample attachments ─────────────────────────────────────────
    // Two PDF assets attached to the first three simple products as a
    // certificate and a tech spec, so the storefront PDP renders its
    // AttachmentsList without an operator uploading anything. Same two modules
    // as the images, and the same reason it is a step (§5.1).
    //
    // The attachment **types** are `catalog`'s own, created by a migration; a
    // deployment that removed one gets the other's attachments and no error,
    // which is the degrade the host block already took.
    name: 'sample attachments for the demo catalogue',
    modules: ['catalog', 'assets_library'],
    async apply(em) {
      const conn = em.getConnection();
      const products = (await demoSimpleProducts(em)).slice(0, 3);
      if (products.length === 0) return;
      const productIds = products.map((product) => product.id);
      const held = await conn.execute<{ n: string }[]>(
        `select count(*)::text as n from product_attachments
          where product_id in (${placeholders(productIds.length)})`,
        productIds,
      );
      if (Number(held[0]?.n ?? '0') > 0) return;

      const assetIdByFilename = new Map<string, string>();
      const assetRows: string[] = [];
      const assetParams: unknown[] = [];
      for (const asset of DEMO_ATTACHMENT_ASSETS) {
        const assetId = crypto.randomUUID();
        assetIdByFilename.set(asset.filename, assetId);
        assetRows.push(`(?, 'pdf', ?, 'application/pdf', ?, ?, now(), now())`);
        assetParams.push(assetId, asset.filename, asset.sizeBytes, asset.url);
      }
      await conn.execute(
        `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
         values ${assetRows.join(', ')}`,
        assetParams,
      );

      const typeCodes = DEMO_ATTACHMENT_ASSETS.map((asset) => asset.typeCode);
      const types = await conn.execute<{ id: string; code: string }[]>(
        `select id, code from attachment_types where code in (${placeholders(typeCodes.length)})`,
        typeCodes,
      );
      const typeIdByCode = new Map(types.map((row) => [row.code, row.id]));
      for (const [index, product] of products.entries()) {
        for (const [position, asset] of DEMO_ATTACHMENT_ASSETS.entries()) {
          const typeId = typeIdByCode.get(asset.typeCode);
          if (typeId === undefined) continue;
          await conn.execute(
            `insert into product_attachments (id, product_id, asset_id, attachment_type_id, name, description, position, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, now(), now())`,
            [
              crypto.randomUUID(),
              product.id,
              assetIdByFilename.get(asset.filename),
              typeId,
              `${asset.name} ${index + 1}`,
              asset.description,
              position,
            ],
          );
        }
      }
    },
    async withdraw(em) {
      const conn = em.getConnection();
      await conn.execute(
        `delete from product_attachments where product_id in
           (select id from products where slug like ?)`,
        [`${DEMO_PRODUCT_SLUG_PREFIX}%`],
      );
      const filenames = DEMO_ATTACHMENT_ASSETS.map((asset) => asset.filename);
      await conn.execute(
        `delete from assets where kind = 'pdf'
           and filename in (${placeholders(filenames.length)})`,
        filenames,
      );
    },
  },
  {
    // ── 6. the demo administrators take their roles ───────────────────────
    // An `admin_users` row carrying an `admin_roles` id is two modules' rows
    // in one statement, so which account holds which role is the instance's
    // statement and not either module's (§5.1). `admin_users` creates the
    // three accounts with no role, `admin_roles` creates the two roles, and
    // this step joins them by the natural keys both assign.
    //
    // **It is an update and not a creation, which is the difference from step
    // 5.** `AdminUser.adminRoleId` is nullable, so the account exists before
    // it has a role and the split is available;
    // `customer_accounts.organization_id` is `NOT NULL`, so there the
    // composition has to create the row outright. The schema decides which
    // shape a link takes, not a preference.
    name: 'demo administrators take their roles',
    modules: ['admin_users', 'admin_roles'],
    async apply(em) {
      const roles = await em.find(AdminRole, {
        code: { $in: DEMO_ADMIN_ROLE_ASSIGNMENTS.map((row) => row.roleCode) },
      });
      const byCode = new Map(roles.map((role) => [role.code, role]));
      for (const assignment of DEMO_ADMIN_ROLE_ASSIGNMENTS) {
        const role = byCode.get(assignment.roleCode);
        const account = await em.findOne(AdminUser, { email: assignment.email });
        // A role the demo did not create, or an account it did not create, is
        // an instance the operator has already changed. Skipped rather than
        // repaired: this step joins what is there and creates neither side.
        if (role === undefined || account === null) continue;
        account.adminRoleId = role.id;
      }
      await em.flush();
    },
    async withdraw(em) {
      // The link and only the link. The accounts are `admin_users`' to remove
      // and the roles are `admin_roles`' — and unassigning first is what
      // leaves no row referencing a role either of them is about to delete.
      const accounts = await em.find(AdminUser, {
        email: { $in: DEMO_ADMIN_ROLE_ASSIGNMENTS.map((row) => row.email) },
      });
      for (const account of accounts) account.adminRoleId = null;
      await em.flush();
    },
  },
  {
    // ── 7. the credit limit granted to the demo organisation ──────────────
    // `credit_limits` owns the row and `organizations` owns the party it is
    // granted to, so the grant is two modules' rows in one statement and no
    // module's demo data (§5.1).
    //
    // It is what makes `payment_methods`' `credit_limit` method visible at
    // all: checkout hides that method from a buyer whose organisation holds no
    // grant, and again when the cart exceeds what is available. Without this
    // row the demo would offer an option no seeded buyer can ever see.
    name: 'credit limit granted to the demo organisation',
    modules: ['credit_limits', 'organizations'],
    async apply(em) {
      const organization = await em.findOne(Organization, { taxId: DEMO_ORG_TAX_ID });
      if (organization === null) return;
      const existing = await em.findOne(CreditLimit, { organizationId: organization.id });
      // One row per organisation is a unique index on that table, so a second
      // run must probe rather than insert.
      if (existing !== null) return;
      em.create(CreditLimit, {
        organizationId: organization.id,
        grantedAmount: DEMO_CREDIT_LIMIT.grantedAmount,
        currency: DEMO_CREDIT_LIMIT.currency,
      });
      await em.flush();
    },
    async withdraw(em) {
      // By the organisation the demo created, in SQL rather than through the
      // ORM: `CreditLimit` is `@OrgScoped`, and a withdrawal that depended on
      // the ambient tenant would remove a different set on a different scope.
      await em.getConnection().execute(
        `delete from credit_limits where organization_id in
           (select id from organizations where tax_id = ?)`,
        [DEMO_ORG_TAX_ID],
      );
    },
  },
];

/**
 * The reason an operator reads for a step that did not run.
 *
 * It names **which** module is absent, because "one of two modules is missing"
 * is not something anybody can act on.
 */
function absenceReason(absent: readonly string[]): string {
  const list = absent.join(', ');
  return absent.length === 1
    ? `'${list}' is not present in this instance, and this step writes its rows`
    : `these modules are not present in this instance: ${list}`;
}

/**
 * Build this instance's composition.
 *
 * Both directions run every step's guard afresh: `withdraw` over a module that
 * has since been switched off is the same reported skip `apply` would be, and
 * not a half-executed withdrawal.
 */
export function createDemoComposition(deps: DemoCompositionDeps): DemoComposition {
  const runSteps = async (
    direction: 'apply' | 'withdraw',
    steps: readonly CompositionStep[],
  ): Promise<DemoCompositionResult> => {
    const applied: string[] = [];
    const skipped: { step: string; reason: string }[] = [];
    const credentials: DemoCredential[] = [];
    // `withdraw` unwinds in the reverse of the order `apply` built (§5.5's
    // shape, one level down): the bridges and the stock hang off rows the
    // steps above them assume.
    const ordered = direction === 'apply' ? steps : [...steps].reverse();
    for (const step of ordered) {
      const absent = step.modules.filter((moduleId) => !deps.isPresent(moduleId));
      if (absent.length > 0) {
        skipped.push({ step: step.name, reason: absenceReason(absent) });
        continue;
      }
      await step[direction](deps.em);
      applied.push(step.name);
      // Only on the way in: a withdrawal that advertised a sign-in has just
      // deleted the account behind it.
      if (direction === 'apply' && step.credentials) credentials.push(...step.credentials);
    }
    return { applied, skipped, ...(credentials.length === 0 ? {} : { credentials }) };
  };

  return {
    apply: () => runSteps('apply', STEPS),
    withdraw: () => runSteps('withdraw', STEPS),
    // §5.5a. Declared rather than omitted even though `FOUNDATION_STEPS` holds
    // one step: the phase is what the runner calls, and an instance that grows
    // a second foundation step must not also have to remember to wire it.
    applyFoundation: () => runSteps('apply', FOUNDATION_STEPS),
    withdrawFoundation: () => runSteps('withdraw', FOUNDATION_STEPS),
  };
}

/** The step names, for a test that asserts the composition's shape. */
export const DEMO_COMPOSITION_STEP_NAMES: readonly string[] = STEPS.map((step) => step.name);

/** The foundation's step names (§5.5a), in the order they run. */
export const DEMO_FOUNDATION_STEP_NAMES: readonly string[] = FOUNDATION_STEPS.map(
  (step) => step.name,
);
