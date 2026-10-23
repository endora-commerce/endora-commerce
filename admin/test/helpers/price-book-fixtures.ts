import {
  priceBookRowSchema,
  priceBookSchema,
  priceBookSummarySchema,
  type PriceBook,
  type PriceBookRow,
  type PriceBookRowPrice,
  type PriceBookSummary,
} from '@endora-commerce/contracts';
import type { AdminMe } from '@endora-commerce/admin-kit/lib';
import { adminSession } from './render-with-session';

/**
 * Feature 161 (T002) — the price books of `specs/pricing/worked-examples.md`
 * §10.1–§10.4 as the admin API answers them, for the editor's screen tests.
 *
 * Every object is parsed through the contracts' own schema when this module
 * loads, so a fixture that drifts from the API shape fails at import rather
 * than rendering a screen over data the server could never send.
 *
 * Picker answers are shaped as the API sends them: category and channel names
 * are maps keyed by language tag (`priceBookTarget*Schema`), held by
 * `price-book-fixtures.test.ts`.
 *
 * - §10.1: channel **CH** "B2B PL" (PLN); categories **Screws**, **Bolts**;
 *   the `color` price-rule attribute; products **P1** *Screws 0200* (red),
 *   **P2** *Screws 0300* (blue), **P3** *Bolt 10* (red); the PLN base book
 *   (P1 100, P2 50, P3 30); group **VIP**; organizations **Acme**, **Beta**,
 *   **Gamma**, **AcmeW**.
 * - §10.2 E1: **L1** everyone, row e1 Screws ∩ red, fixed 120.
 * - §10.3 E2: **L2** organization Acme, e2a Screws −10 %, e2b P1 −20 %.
 * - §10.4 E3: **L3** *VIP prices* (group VIP), e3a P1 −10 %; **L4**
 *   *Acme contract* (organization Acme), e4a P1 −5 %, e4b Screws −15 %.
 *
 * Two sessions: a platform administrator, and a sales representative holding
 * the pricing codes. The representative's scope ({Acme}) is the server's to
 * apply; what reaches the browser is the books' `writable` flags (G11).
 */

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const IDS = {
  channel: uuid(0x161c01),
  categories: { screws: uuid(0x161ca1), bolts: uuid(0x161ca2) },
  products: { P1: uuid(0x161b01), P2: uuid(0x161b02), P3: uuid(0x161b03) },
  group: { VIP: uuid(0x161a01) },
  orgs: { Acme: uuid(0x161e01), Beta: uuid(0x161e02), Gamma: uuid(0x161e03), AcmeW: uuid(0x161e04) },
  books: { base: '00000000-0000-4000-8000-00000000d51b', L1: uuid(0x161d01), L2: uuid(0x161d02), L3: uuid(0x161d03), L4: uuid(0x161d04) },
} as const;

export const CATALOG = {
  channel: { id: IDS.channel, code: 'b2b_pl', name: { 'en-US': 'B2B PL', 'pl-PL': 'B2B PL' }, currencies: ['PLN'], defaultCurrency: 'PLN' },
  categories: [
    { id: IDS.categories.screws, slug: 'screws', name: { 'en-US': 'Screws', 'pl-PL': 'Wkręty' }, parentCategoryId: null, sortOrder: 0 },
    { id: IDS.categories.bolts, slug: 'bolts', name: { 'en-US': 'Bolts', 'pl-PL': 'Śruby' }, parentCategoryId: null, sortOrder: 1 },
  ],
  attributes: [
    {
      key: 'color',
      label: 'Color',
      valueType: 'select',
      options: [
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' },
      ],
    },
  ],
  products: [
    { id: IDS.products.P1, sku: 'P1', name: 'Screws 0200' },
    { id: IDS.products.P2, sku: 'P2', name: 'Screws 0300' },
    { id: IDS.products.P3, sku: 'P3', name: 'Bolt 10' },
  ],
  organizations: [
    { id: IDS.orgs.Acme, name: 'Acme B2B (demo)', taxId: 'PL1610000001' },
    { id: IDS.orgs.Beta, name: 'Beta', taxId: 'PL1610000002' },
    { id: IDS.orgs.Gamma, name: 'Gamma', taxId: 'PL1610000003' },
    { id: IDS.orgs.AcmeW, name: 'AcmeW', taxId: 'PL1610000004' },
  ],
  customerGroups: [{ id: IDS.group.VIP, code: 'vip', name: 'VIP' }],
} as const;

const NO_LABELS = {
  productName: null,
  productSku: null,
  variantLabel: null,
  variantSku: null,
  categoryPath: null,
  attributeLabel: null,
  attributeValueLabel: null,
};

let rowSeq = 0;
function row(spec: {
  product?: keyof typeof IDS.products;
  category?: keyof typeof IDS.categories;
  color?: 'red' | 'blue';
  min?: number;
  max?: number | null;
  price: PriceBookRowPrice;
}): PriceBookRow {
  rowSeq += 1;
  const product = spec.product ? CATALOG.products.find((p) => p.id === IDS.products[spec.product!])! : null;
  const category = spec.category ? CATALOG.categories.find((c) => c.id === IDS.categories[spec.category!])! : null;
  const selectionKind = product ? 'product' : category && spec.color ? 'category_attribute' : category ? 'category' : spec.color ? 'attribute' : 'all';
  return priceBookRowSchema.parse({
    id: uuid(0x1610000 + rowSeq),
    selectionKind,
    selection: {
      variantId: null,
      productId: product?.id ?? null,
      categoryId: category?.id ?? null,
      attribute: spec.color ? { key: 'color', value: spec.color } : null,
    },
    minQuantity: spec.min ?? 1,
    maxQuantity: spec.max ?? null,
    price: spec.price,
    inactiveReason: null,
    targetDeleted: false,
    labels: {
      ...NO_LABELS,
      productName: product?.name ?? null,
      productSku: product?.sku ?? null,
      // The API resolves the row's category path in the admin language (G2).
      categoryPath: category?.name['en-US'] ?? null,
      attributeLabel: spec.color ? 'Color' : null,
      attributeValueLabel: spec.color ? (spec.color === 'red' ? 'Red' : 'Blue') : null,
    },
    naturalKey: {
      ...(product ? { productSku: product.sku } : {}),
      ...(category ? { categoryPath: category.slug } : {}),
      ...(spec.color ? { attribute: { key: 'color', valueCode: spec.color } } : {}),
    },
  });
}

export const ROWS = {
  base: [
    row({ product: 'P1', price: { type: 'fixed', amount: '100.0000' } }),
    row({ product: 'P2', price: { type: 'fixed', amount: '50.0000' } }),
    row({ product: 'P3', price: { type: 'fixed', amount: '30.0000' } }),
  ],
  L1: [row({ category: 'screws', color: 'red', price: { type: 'fixed', amount: '120.0000' } })],
  L2: [
    row({ category: 'screws', price: { type: 'percent', percent: '-10.00' } }),
    row({ product: 'P1', price: { type: 'percent', percent: '-20.00' } }),
  ],
  L3: [row({ product: 'P1', price: { type: 'percent', percent: '-10.00' } })],
  L4: [
    row({ category: 'screws', price: { type: 'percent', percent: '-15.00' } }),
    row({ product: 'P1', price: { type: 'percent', percent: '-5.00' } }),
  ],
} as const;

function book(spec: {
  id: string;
  name: string;
  audience: PriceBook['audience'];
  rows: readonly PriceBookRow[];
  isSystem?: boolean;
  status?: PriceBook['status'];
}): PriceBook {
  return priceBookSchema.parse({
    id: spec.id,
    name: spec.name,
    type: 'regular',
    status: spec.status ?? 'active',
    currencyCode: 'PLN',
    audience: spec.audience,
    priority: 0,
    startsAt: null,
    endsAt: null,
    isSystem: spec.isSystem ?? false,
    everActivated: (spec.status ?? 'active') !== 'draft',
    version: 1,
    tierStarts: [...new Set(spec.rows.map((r) => r.minQuantity))].sort((a, b) => a - b),
    channels: spec.isSystem ? [] : [{ channelId: IDS.channel, dormant: false }],
    rowCount: spec.rows.length,
    writable: true,
  });
}

/**
 * A book as a sales representative scoped to {Acme} reads it (G11): writable
 * only when it is an organization book whose every member is Acme.
 */
export function asSeenByAcmeRep(b: PriceBook): PriceBook {
  const writable = !b.isSystem && b.audience.kind === 'organizations' && b.audience.memberIds.every((id) => id === IDS.orgs.Acme);
  return priceBookSchema.parse({ ...b, writable });
}

export const BOOKS = {
  base: book({ id: IDS.books.base, name: 'Base prices PLN', audience: { kind: 'everyone', memberIds: [] }, rows: ROWS.base, isSystem: true }),
  L1: book({ id: IDS.books.L1, name: 'Screws red for everyone', audience: { kind: 'everyone', memberIds: [] }, rows: ROWS.L1 }),
  L2: book({ id: IDS.books.L2, name: 'Acme screws', audience: { kind: 'organizations', memberIds: [IDS.orgs.Acme] }, rows: ROWS.L2 }),
  L3: book({ id: IDS.books.L3, name: 'VIP prices', audience: { kind: 'customer_groups', memberIds: [IDS.group.VIP] }, rows: ROWS.L3 }),
  L4: book({ id: IDS.books.L4, name: 'Acme contract', audience: { kind: 'organizations', memberIds: [IDS.orgs.Acme] }, rows: ROWS.L4 }),
} as const;

/** A book as one line of `GET /api/v1/admin/price-books`. */
export function summaryOf(b: PriceBook): PriceBookSummary {
  return priceBookSummarySchema.parse({
    id: b.id,
    name: b.name,
    type: b.type,
    status: b.status,
    currencyCode: b.currencyCode,
    audienceKind: b.audience.kind,
    priority: b.priority,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    isSystem: b.isSystem,
    version: b.version,
    tierStarts: b.tierStarts,
    channelCount: b.channels.length,
    memberCount: b.audience.memberIds.length,
    rowCount: b.rowCount,
    appliesToNoOne: b.audience.kind !== 'everyone' && b.audience.memberIds.length === 0,
    appliesNowhere: !b.isSystem && !b.channels.some((c) => !c.dormant),
    writable: b.writable,
  });
}

/** A platform administrator holding the pricing codes. */
export const PLATFORM_ADMIN: AdminMe = adminSession({
  permissions: ['price_lists:read', 'price_lists:write', 'catalog:read'],
  roleName: 'Platform admin',
});

/** A sales representative holding the pricing codes; the server scopes them to {Acme}. */
export const SALES_REP_ACME: AdminMe = adminSession({
  id: uuid(0x161ad1),
  permissions: ['price_lists:read', 'price_lists:write'],
  roleName: 'Sales Representative',
  firstName: 'Rita',
  lastName: 'Rep',
});

/** A read-only operator. */
export const PRICING_READER: AdminMe = adminSession({ permissions: ['price_lists:read'], roleName: 'Pricing reader' });
