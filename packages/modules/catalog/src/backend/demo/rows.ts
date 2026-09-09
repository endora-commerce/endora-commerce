/**
 * The catalogue this module's demo data creates (feature 113, T224).
 *
 * One place holding the data and the generators, imported by both bodies:
 * `seed.ts` creates these rows and `reset.ts` withdraws exactly them, by the
 * slugs and SKU prefix `seed` assigns (contract §2.5). The values are
 * `dev-catalog-seed.ts`' verbatim, moved rather than rewritten —
 * `backend/src/seeds/demo-relocated-reference.ts` holds the block this replaced
 * and `test/integration/demo/demo-parity.test.ts` compares the two databases row
 * for row while both exist.
 *
 * ## Why a generator rather than 200 literals
 *
 * `research.md` § R2.2: a generated catalogue costs the same shipped bytes at
 * 200 products as at 10 000, and the images are inline SVG built in-process. It
 * is what the Phase 3 budget assumes, and it is why this module ships no
 * non-`.ts` demo asset at all.
 *
 * ## What is deliberately not here
 *
 * **The images and the attachments.** Each mints an `assets` row —
 * `assets_library`'s table — and hands its id to one of this module's, so each
 * is two modules' rows in one statement and a composition step (§5.1). The
 * generators that build the placeholder art went with them.
 *
 * **The attributes.** A product attribute is a `custom_field_definitions` row
 * paired 1:1 with a `product_attributes` extension row, which is the same shape
 * one module further out; `attributeValues` below is a JSONB blob on this
 * module's own table and names those attributes by key, with no reference to
 * them.
 *
 * **Every join table.** A product's category, its sales channel, its price
 * bracket and its stock are all bridges the composition already owned before
 * this batch.
 */

/** How many simple products the demo catalogue holds. */
export const PRODUCT_COUNT = 200;

export const COLOR_VALUES = ['red', 'green', 'blue', 'black', 'white'];
export const MATERIAL_VALUES = ['steel', 'aluminium', 'plastic', 'wood', 'glass'];

/** The root of the demo's three-level tree. */
export const DEMO_ROOT_CATEGORY = {
  slug: 'catalog',
  name: { 'en-US': 'Catalog', 'pl-PL': 'Katalog' },
} as const;

export const DEMO_SECTION_CATEGORIES: readonly { slug: string; nameEn: string }[] = [
  { slug: 'fasteners', nameEn: 'Fasteners' },
  { slug: 'tools', nameEn: 'Tools' },
  { slug: 'electronics', nameEn: 'Electronics' },
  { slug: 'safety', nameEn: 'Safety equipment' },
];

export const DEMO_LEAF_CATEGORIES: readonly {
  parentSlug: string;
  slug: string;
  nameEn: string;
}[] = [
  { parentSlug: 'fasteners', slug: 'screws', nameEn: 'Screws' },
  { parentSlug: 'fasteners', slug: 'bolts', nameEn: 'Bolts' },
  { parentSlug: 'tools', slug: 'wrenches', nameEn: 'Wrenches' },
  { parentSlug: 'tools', slug: 'drills', nameEn: 'Drills' },
  { parentSlug: 'electronics', slug: 'cables', nameEn: 'Cables' },
  { parentSlug: 'electronics', slug: 'sensors', nameEn: 'Sensors' },
  { parentSlug: 'safety', slug: 'gloves', nameEn: 'Gloves' },
  { parentSlug: 'safety', slug: 'helmets', nameEn: 'Helmets' },
];

/** Every category slug the demo owns, deepest first — the order `reset` needs. */
export const DEMO_CATEGORY_SLUGS_DEEPEST_FIRST: readonly (readonly string[])[] = [
  DEMO_LEAF_CATEGORIES.map((leaf) => leaf.slug),
  DEMO_SECTION_CATEGORIES.map((section) => section.slug),
  [DEMO_ROOT_CATEGORY.slug],
];

/**
 * The prefix every demo product's slug carries.
 *
 * The instance composition resolves a product's leaf, its channel binding and
 * its stock by this prefix, so it is contract between the two rather than a
 * convenience: `reset` withdraws exactly what matches it.
 */
export const DEMO_PRODUCT_SLUG_PREFIX = 'demo-';

/** The three composite products, whose structure is this module's own. */
export const DEMO_COMPOSITE_SKUS = [
  'DEMO-GROUPED-0001',
  'DEMO-BUNDLE-0001',
  'DEMO-VIRTUAL-0001',
] as const;

/** Singularized, lower-cased leaf noun for prose (e.g. "Screws" → "screw"). */
export function leafNoun(leafNameEn: string): string {
  const lower = leafNameEn.toLowerCase();
  return lower.endsWith('s') ? lower.slice(0, -1) : lower;
}

/**
 * Build a richer, multi-paragraph product description (≥3 paragraphs, 3-4
 * sentences each) so the seeded catalog reads like real merchandising copy
 * rather than a one-line stub. Deterministic — derived purely from the
 * product's own attributes so re-seeding is stable.
 */
export function buildProductDescription(input: {
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

/** One generated simple product, in `Product`'s own field names. */
export interface DemoProductRow {
  readonly sku: string;
  readonly slug: string;
  readonly leafSlug: string;
  readonly nameEn: string;
  readonly descriptionEn: string;
  readonly attributeValues: Record<string, unknown>;
}

/**
 * The demo's simple products, derived from the leaf tree and nothing else.
 *
 * `leafSlug` is what the SKU, the slug and the name all agree on — the host
 * block kept a parallel `productLeaves` array in memory beside the products,
 * and an off-by-one between the naming loop and the category loop once filed
 * every product under its neighbouring category.
 */
export function demoProducts(
  leafNameBySlug: (slug: string) => string,
): DemoProductRow[] {
  const rows: DemoProductRow[] = [];
  for (let i = 1; i <= PRODUCT_COUNT; i++) {
    const idx = String(i).padStart(4, '0');
    const leaf = DEMO_LEAF_CATEGORIES[i % DEMO_LEAF_CATEGORIES.length]!;
    const color = COLOR_VALUES[i % COLOR_VALUES.length]!;
    const material = MATERIAL_VALUES[i % MATERIAL_VALUES.length]!;
    const weight = Number(((i % 50) / 10 + 0.1).toFixed(1));
    const price = 9.99 + (i % 100) * 1.5;
    const leafNameEn = leafNameBySlug(leaf.slug);
    const productName = `${leafNameEn} ${idx}`;
    const certification = i % 7 === 0 ? 'ISO9001' : null;
    rows.push({
      sku: `DEMO-${leaf.slug.toUpperCase()}-${idx}`,
      slug: `${DEMO_PRODUCT_SLUG_PREFIX}${leaf.slug}-${idx}`,
      leafSlug: leaf.slug,
      nameEn: productName,
      descriptionEn: buildProductDescription({
        productName,
        leafNameEn,
        color,
        material,
        weightKg: weight,
        certification,
      }),
      attributeValues: {
        color,
        material,
        weight_kg: weight,
        certification,
        defaultPrice: price,
      },
    });
  }
  return rows;
}
