/**
 * The demo's prices (feature 160, FR-044, N12; `contracts/conversion-and-removal.md` §4).
 *
 * One place holding the data, imported by the bodies in `seed.ts`: the base
 * price of every demo product in the PLN base book, and the price books of
 * `specs/pricing/worked-examples.md` §10.2–§10.4. The prices are this
 * module's own data now — the catalogue demo no longer writes a
 * `defaultPrice` (FR-042) — and each is keyed by the demo product's SKU, which
 * is the catalogue demo's natural key.
 *
 * ## The base prices
 *
 * The demo catalogue's generated product *n* (`DEMO-<LEAF>-<nnnn>`) keeps the
 * price it always had, `9.99 + (n mod 100) × 1.5`, so the shop looks as it did.
 * Three products are priced as the vectors' fixture is: *Screws 0200* (red, in
 * Screws) is P1 at 100.00, *Screws 0032* (blue, in Screws) is P2 at 50.00 and
 * *Bolts 0025* (red, in Bolts) is P3 at 30.00, so every E1–E3 vector reads its
 * literal number on the demo.
 *
 * ## The books
 *
 * The scenarios are alternatives (owner, 2026-10-21, answer A): E3's two books
 * are seeded **active**, E1's and E2's as **drafts**, every one of them bound
 * to the demo channel and complete, so activating one scenario's books alone
 * shows that scenario. Each book has a fixed id, which is what makes a second
 * seed a no-op and lets `withdraw` remove exactly these books.
 */

/** The currency of the demo's books and base prices. */
export const DEMO_PRICE_CURRENCY = 'PLN';

/**
 * The currencies the demo's base prices are written in: PLN only. A base price
 * is per currency and is never converted (K1.3), so an EUR view of the demo
 * shows its products unpriced — the old Default list copied one amount into
 * every currency a channel offered, which no operator would mean. An EUR base
 * book would also be a system book the demo created and a reset could not
 * tell from the operator's own.
 */
export const DEMO_BASE_CURRENCIES = [DEMO_PRICE_CURRENCY] as const;

/** The vectors' products, by the catalogue demo's SKU. */
export const DEMO_VECTOR_SKUS = {
  P1: 'DEMO-SCREWS-0200',
  P2: 'DEMO-SCREWS-0032',
  P3: 'DEMO-BOLTS-0025',
} as const;

const VECTOR_BASE_PRICES: Readonly<Record<string, string>> = {
  [DEMO_VECTOR_SKUS.P1]: '100.0000',
  [DEMO_VECTOR_SKUS.P2]: '50.0000',
  [DEMO_VECTOR_SKUS.P3]: '30.0000',
};

/** The three composite products, priced as the catalogue demo used to price them. */
const COMPOSITE_BASE_PRICES: Readonly<Record<string, string>> = {
  'DEMO-GROUPED-0001': '49.9900',
  'DEMO-BUNDLE-0001': '99.9900',
  'DEMO-VIRTUAL-0001': '19.9900',
};

/** A generated demo product's SKU: `DEMO-<LEAF>-<nnnn>`. */
const GENERATED_SKU = /^DEMO-[A-Z]+-(\d{4})$/;

/**
 * The base price (4 dp) of a demo product in each of
 * {@link DEMO_BASE_CURRENCIES}, or `null` for a SKU the demo does not price.
 */
export function demoBasePrice(sku: string): string | null {
  const vector = VECTOR_BASE_PRICES[sku];
  if (vector !== undefined) return vector;
  const composite = COMPOSITE_BASE_PRICES[sku];
  if (composite !== undefined) return composite;
  const generated = GENERATED_SKU.exec(sku);
  if (!generated) return null;
  const n = Number(generated[1]);
  // In hundredths, so 9.99 + 1.5 k is exact.
  const hundredths = 999 + (n % 100) * 150;
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}00`;
}

/** What a demo book row selects, by the demo's natural keys. */
export type DemoRowSelection =
  | { readonly product: string }
  | { readonly category: 'screws' }
  | { readonly category: 'screws'; readonly attribute: readonly ['color', 'red'] };

export interface DemoBookRow {
  readonly selection: DemoRowSelection;
  readonly price: { readonly type: 'fixed'; readonly amount: string } | { readonly type: 'percent'; readonly percent: string };
}

export interface DemoBook {
  readonly id: string;
  readonly name: string;
  readonly scenario: 'E1' | 'E2' | 'E3';
  readonly audience: 'everyone' | { readonly organizations: readonly ['acme'] } | { readonly customerGroups: readonly ['vip'] };
  readonly status: 'active' | 'draft';
  readonly rows: readonly DemoBookRow[];
}

/** The books of `worked-examples.md` §10.2–§10.4, as the demo seeds them. */
export const DEMO_PRICE_BOOKS = {
  /** E1 — L1: red screws at 120 for everyone (category ∩ attribute). */
  e1: {
    id: '00000000-0000-4000-8000-0000000de101',
    name: 'E1 — red screws for everyone (demo)',
    scenario: 'E1',
    audience: 'everyone',
    status: 'draft',
    rows: [{ selection: { category: 'screws', attribute: ['color', 'red'] }, price: { type: 'fixed', amount: '120.0000' } }],
  },
  /** E2 — L2: Acme's contract, Screws −10 % and Screws 0200 −20 %. */
  e2: {
    id: '00000000-0000-4000-8000-0000000de201',
    name: 'E2 — Acme B2B contract (demo)',
    scenario: 'E2',
    audience: { organizations: ['acme'] },
    status: 'draft',
    rows: [
      { selection: { category: 'screws' }, price: { type: 'percent', percent: '-10.00' } },
      { selection: { product: DEMO_VECTOR_SKUS.P1 }, price: { type: 'percent', percent: '-20.00' } },
    ],
  },
  /** E3 — L3: the VIP group, Screws 0200 −10 %. */
  e3Vip: {
    id: '00000000-0000-4000-8000-0000000de301',
    name: 'E3 — VIP customers (demo)',
    scenario: 'E3',
    audience: { customerGroups: ['vip'] },
    status: 'active',
    rows: [{ selection: { product: DEMO_VECTOR_SKUS.P1 }, price: { type: 'percent', percent: '-10.00' } }],
  },
  /** E3 — L4: Acme's terms, Screws 0200 −5 % and Screws −15 %. */
  e3Acme: {
    id: '00000000-0000-4000-8000-0000000de302',
    name: 'E3 — Acme B2B terms (demo)',
    scenario: 'E3',
    audience: { organizations: ['acme'] },
    status: 'active',
    rows: [
      { selection: { product: DEMO_VECTOR_SKUS.P1 }, price: { type: 'percent', percent: '-5.00' } },
      { selection: { category: 'screws' }, price: { type: 'percent', percent: '-15.00' } },
    ],
  },
} as const satisfies Record<string, DemoBook>;

/** Every demo book id, for the withdrawal. */
export const DEMO_PRICE_BOOK_IDS: readonly string[] = Object.values(DEMO_PRICE_BOOKS).map((book) => book.id);
