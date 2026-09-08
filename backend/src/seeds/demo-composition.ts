/**
 * This instance's demo composition (feature 113, T211;
 * `specs/113-module-owned-demo-data/contracts/module-demo-data-layer.md` §5).
 *
 * **§5.1** — *"any demo wiring that touches more than one module's rows is a
 * composition step and MUST NOT live in any module."* These are those steps,
 * lifted out of `dev-catalog-seed.ts`' 887-line `main()`, which was one
 * function holding both a dozen modules' demo rows and the wiring between them.
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
 * `effectiveState.isPresent`; `dev-catalog-seed.ts`, which composes no platform
 * and has no registry cache to ask, passes its own — see the note at its call
 * site. A cold cache answers `false` for everything (fail-closed, correctly),
 * so a script that never composed must not consult one.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DemoComposition, DemoCompositionResult } from '../demo/index.js';
import { SalesChannel } from '../kernel/sales-channels/sales-channel.entity.js';
import { hashPassword } from '../kernel/crypto/password-hasher.js';
import { entityNamed } from '../packages/package-entity-lookup.js';
import { entities as catalogEntities } from '@endora-commerce/mod-catalog/backend';
import { entities as megamenuEntities } from '@endora-commerce/mod-megamenu/backend';
import {
  entities as inventoryEntities,
  DEFAULT_WAREHOUSE_ID,
} from '@endora-commerce/mod-inventory/backend';
import { entities as customerAccountsEntities } from '@endora-commerce/mod-customer-accounts/backend';
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
 * The buyer's credentials are here because step 5 creates the account;
 * `dev-catalog-seed.ts` imports them for the sign-in block it prints.
 */
export const DEMO_BUYER_EMAIL = 'buyer@demo-org.example';
export const DEMO_BUYER_PASSWORD = 'ChangeMe!123';
const DEMO_ORG_TAX_ID = 'PL5210000099';
const DEMO_MENU_NAME = 'Main navigation';
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
  apply(em: EntityManager): Promise<void>;
  withdraw(em: EntityManager): Promise<void>;
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
      if (categoryRows.length > 0) {
        await conn.execute(
          `insert into product_categories (product_id, category_id)
            values ${categoryRows.join(', ')}`,
          categoryParams,
        );
      }
      if (channelRows.length > 0) {
        await conn.execute(
          `insert into sales_channel_products (sales_channel_id, product_id)
            values ${channelRows.join(', ')}`,
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
  ): Promise<DemoCompositionResult> => {
    const applied: string[] = [];
    const skipped: { step: string; reason: string }[] = [];
    // `withdraw` unwinds in the reverse of the order `apply` built (§5.5's
    // shape, one level down): the bridges and the stock hang off rows the
    // steps above them assume.
    const ordered = direction === 'apply' ? STEPS : [...STEPS].reverse();
    for (const step of ordered) {
      const absent = step.modules.filter((moduleId) => !deps.isPresent(moduleId));
      if (absent.length > 0) {
        skipped.push({ step: step.name, reason: absenceReason(absent) });
        continue;
      }
      await step[direction](deps.em);
      applied.push(step.name);
    }
    return { applied, skipped };
  };

  return {
    apply: () => runSteps('apply'),
    withdraw: () => runSteps('withdraw'),
  };
}

/** The step names, for a test that asserts the composition's shape. */
export const DEMO_COMPOSITION_STEP_NAMES: readonly string[] = STEPS.map((step) => step.name);
