import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  isProductVisibleTo,
  type CatalogPackagingUnitRecord,
  type CatalogProductAvailabilityPort,
  type ProductAvailabilityScope,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type LinePricePort,
  type LinePricesPort,
  type OrganizationDetailsPort,
  type ProductDisplayModePort,
} from '@endora-commerce/contracts';
import { ModuleDisabledError, SalesChannel } from '@endora-commerce/platform/kernel';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { CART_MAX_LINES, CartService, type CustomerContext } from './cart-service.js';

/**
 * The request channel `basketScopeLanguage` resolves against — none (outside a request)
 * unless a case sets one (feature 163, T138).
 */
const requestChannel = vi.hoisted(() => ({
  current: null as { id: string; languages: string[]; defaultLanguage: string } | null,
}));
vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/platform/kernel')>()),
  currentSalesChannel: () => requestChannel.current,
}));

/**
 * Feature 155, Phase 7 (T048) — `CartService.addItems`, the one batch every batch
 * path into a cart goes through (`specs/155-catalog-order-constraints/research.md`
 * R8, `contracts/cart-and-checkout-api.md` §4).
 *
 * 1. **Resolution first** (threat F1): every line meets exactly `addItem`'s
 *    preconditions; a line that fails gets the unknown-id answer, never a name or
 *    a minimum, and counts toward no total.
 * 2. **Two passes** with the cart (D1): unit minimums, then pieces minimums over
 *    the survivors. Existing cart lines are never rejected.
 * 3. The accepted lines are added through `addItem`'s own write.
 *
 * The `EntityManager` is an in-memory double holding this module's two tables and
 * answering the system-default channel; `catalog`, `price_lists` and the channel
 * bridge are port doubles.
 */

const CUSTOMER: CustomerContext = { customerAccountId: 'cust-1', organizationId: 'org-1', salesChannelId: 'channel-1' };
const ACTOR = { customer: CUSTOMER };
const DEFAULT_CHANNEL = { id: 'ch-default', systemDefault: true };

// ── products ────────────────────────────────────────────────────────────────

const A = 'prod-a'; // pieces minimum 10, two variants
const B = 'prod-b'; // no minimum
const C = 'prod-c'; // pieces minimum 10, Pallet of 64 with a minimum of 2 units
const H = 'prod-h'; // minimum 10, restricted to another organisation — hidden
const Q = 'prod-q'; // quote-only
const D = 'prod-d'; // a member switched off — feature 163: not acquirable
const UNKNOWN = 'prod-unknown';
const PALLET = 'unit-pallet';
const RED = 'var-red';
const BLUE = 'var-blue';

function product(
  id: string,
  overrides: Partial<CatalogProductRecord> = {},
): CatalogProductRecord {
  return {
    id,
    type: 'simple',
    status: 'active',
    name: { en: `Name of ${id}`, pl: `Nazwa ${id}` },
    visibility: 'public',
    allowedOrganizationIds: [],
    attributeValues: { defaultPrice: 10 },
    minOrderQuantity: null,
    ...overrides,
  } as unknown as CatalogProductRecord;
}

const PRODUCTS = new Map<string, CatalogProductRecord>([
  [A, product(A, { type: 'configurable', minOrderQuantity: 10, name: { en: 'Anchor', pl: 'Kotwa' } })],
  [B, product(B)],
  [C, product(C, { minOrderQuantity: 10, name: { en: 'Cement', pl: 'Cement PL' } })],
  [H, product(H, { minOrderQuantity: 10, allowedOrganizationIds: ['org-other'] })],
  [Q, product(Q)],
  [D, product(D, { status: 'inactive' })],
]);

const UNITS: CatalogPackagingUnitRecord[] = [
  {
    id: PALLET,
    productId: C,
    name: 'Pallet',
    // Feature 163 (FR-079) — the name per language; the line snapshots it in the basket language.
    nameTranslations: { 'pl-PL': 'Paleta' },
    baseQuantity: 64,
    minOrderUnits: 2,
    position: 0,
    isDefault: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
];

// ── the rig ─────────────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { id: string };

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (row[key] ?? null) === (value ?? null));
}

interface Rig {
  service: CartService;
  carts: Row[];
  items: Row[];
  writes: { flushes: number; created: number };
  catalog: {
    findById: ReturnType<typeof vi.fn>;
    listPackagingUnitsByProductIds: ReturnType<typeof vi.fn>;
  };
  audits: unknown[];
  availability: CatalogProductAvailabilityPort;
  channelReads: { getById: ReturnType<typeof vi.fn> };
}

function rig(
  options: {
    carts?: Row[];
    items?: Row[];
    products?: Map<string, CatalogProductRecord>;
    findById?: (id: string) => Promise<CatalogProductRecord | null>;
    resolveLinePrice?: LinePricePort['resolveLinePrice'];
    /** Products each named channel publishes. */
    channels?: Record<string, string[]>;
    /** Feature 163 (FR-100) — channel id → product id → that channel's minimum. */
    channelMinimums?: Record<string, Record<string, number | null>>;
    /** Feature 163 (N2) — channel id → its default language, as the channel accessor answers. */
    channelDefaultLanguages?: Record<string, string>;
  } = {},
): Rig {
  const carts: Row[] = options.carts ?? [];
  const items: Row[] = options.items ?? [];
  const writes = { flushes: 0, created: 0 };
  const products = options.products ?? PRODUCTS;
  const tableOf = (entity: unknown): Row[] => {
    if (entity === Cart) return carts;
    if (entity === CartItem) return items;
    throw new Error(`carts queried an entity it does not own: ${String(entity)}`);
  };
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === SalesChannel) return DEFAULT_CHANNEL;
      return tableOf(entity).find((row) => matches(row, where)) ?? null;
    },
    find: async (entity: unknown, where: Record<string, unknown>) =>
      tableOf(entity).filter((row) => matches(row, where)),
    count: async (entity: unknown, where: Record<string, unknown>) =>
      tableOf(entity).filter((row) => matches(row, where)).length,
    create: (entity: unknown, data: Record<string, unknown>) => {
      writes.created += 1;
      const row: Row = { id: randomUUID(), ...data };
      if (entity === Cart) row['sourceQuoteRequestId'] ??= null;
      return row;
    },
    persist: (row: Row) => {
      const table = 'cartId' in row ? items : carts;
      if (!table.includes(row)) table.push(row);
    },
    persistAndFlush: async (row: Row) => {
      writes.flushes += 1;
      const table = 'cartId' in row ? items : carts;
      if (!table.includes(row)) table.push(row);
    },
    flush: async () => {
      writes.flushes += 1;
    },
    nativeDelete: async (entity: unknown, where: Record<string, unknown>) => {
      const table = tableOf(entity);
      const kept = table.filter((row) => !matches(row, where));
      const deleted = table.length - kept.length;
      table.splice(0, table.length, ...kept);
      return deleted;
    },
  } as unknown as EntityManager;

  const catalog = {
    findById: vi.fn(options.findById ?? (async (id: string) => products.get(id) ?? null)),
    findPackagingUnitInProduct: async (productId: string, unitId: string) =>
      UNITS.find((u) => u.id === unitId && u.productId === productId) ?? null,
    listPackagingUnitsByProductIds: vi.fn(async (ids: readonly string[]) =>
      UNITS.filter((u) => ids.includes(u.productId)),
    ),
  };
  const single: LinePricePort['resolveLinePrice'] =
    options.resolveLinePrice ??
    (async ({ product: p }) => ({
      amount: '10.00',
      currency: 'PLN',
      priceListId: 'pl-1',
      isSale: false,
      bracketStartQuantity: 1,
      displayMode: p.id === Q ? 'none' : 'gross_only',
    }));
  // D-287 P0 — the cart prices through the batched slice; each line is
  // answered by the single-line function a case supplies.
  const pricing: LinePricesPort = {
    resolveLinePrices: async ({ lines, context }) => {
      const out = new Map();
      for (const line of lines) {
        out.set(
          line.key,
          await single({
            product: line.product,
            variantId: line.variantId ?? null,
            context: { ...context, quantity: line.quantity },
          }),
        );
      }
      return out;
    },
  };
  const organizations = { findById: async () => null } as unknown as OrganizationDetailsPort;
  // Feature 163 — `catalog`'s availability answer, stubbed as the rule over the
  // fixture: a member of the channel, globally `active`, visible to the buyer.
  const availability = {
    filterAvailable: vi.fn(async (ids: readonly string[], scope: ProductAvailabilityScope) =>
      new Set(
        ids.filter((id) => {
          const p = products.get(id);
          return (
            p !== undefined &&
            p.status === 'active' &&
            isProductVisibleTo(p, scope.audience) &&
            // The basket's own channel publishes every fixture product unless a
            // case says otherwise.
            (options.channels?.[scope.channelId] ?? (scope.channelId === CUSTOMER.salesChannelId ? [...products.keys()] : [])).includes(id)
          );
        }),
      ),
    ),
    // No override in this rig: the caller's baseline pick names the product.
    effectiveNames: vi.fn(async () => new Map<string, string>()),
    // Feature 163 (FR-100) — the channel's minimum where a case names one, else the record's.
    effectiveOrderRules: vi.fn(async (ids: readonly string[], channelId: string) => {
      const byProduct = options.channelMinimums?.[channelId] ?? {};
      return new Map(
        ids.flatMap((id) => {
          const p = products.get(id);
          if (!p) return [];
          const minOrderQuantity = id in byProduct ? (byProduct[id] ?? null) : p.minOrderQuantity;
          return [[id, { minOrderQuantity, returnable: p.returnable }] as const];
        }),
      );
    }),
  } as unknown as CatalogProductAvailabilityPort;
  // Asked only when no price list holds the product (issue #236).
  const displayModes: ProductDisplayModePort = { resolveDisplayMode: async () => 'gross_only' };
  const audits: unknown[] = [];
  const auditService = { record: async (entry: unknown) => void audits.push(entry) };
  const channelReads = {
    getById: vi.fn(async (id: string) => {
      const defaultLanguage = options.channelDefaultLanguages?.[id];
      return defaultLanguage === undefined ? null : { id, defaultLanguage };
    }),
  };

  const service = new CartService(
    () => em,
    pricing,
    catalog as unknown as CatalogProductReadPort,
    organizations,
    displayModes,
    availability,
    undefined,
    auditService as never,
    undefined,
    channelReads as never,
  );
  return { service, carts, items, writes, catalog, audits, availability, channelReads };
}

function existingCart(overrides: Partial<Row> = {}): Row {
  return {
    id: 'cart-1',
    customerAccountId: CUSTOMER.customerAccountId,
    organizationId: CUSTOMER.organizationId,
    salesChannelId: CUSTOMER.salesChannelId,
    status: 'active',
    sourceQuoteRequestId: null,
    ...overrides,
  };
}

function cartLine(overrides: Partial<Row> & { productId: string; quantity: number }): Row {
  return {
    id: randomUUID(),
    cartId: 'cart-1',
    variantId: null,
    packagingUnitId: null,
    packagingUnitBaseQuantity: null,
    agreedQuantity: null,
    unitPrice: '10.00',
    currency: 'PLN',
    ...overrides,
  };
}

const NOT_FOUND = { status: 404, code: ERROR_CODES.PRODUCT_NOT_FOUND, message: 'Product not found.' };

// ── 1. resolution first ─────────────────────────────────────────────────────

describe('addItems — resolution first (F1, FR-035)', () => {
  it('a hidden, an out-of-channel and an unknown product each get the unknown-id 404, with no name or minimum', async () => {
    const r = rig({ carts: [existingCart()], channels: { 'ch-x': [B] } });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: H, quantity: 5 },
        { productId: UNKNOWN, quantity: 5 },
        { productId: A, quantity: 5, salesChannelId: 'ch-x' },
        { productId: B, quantity: 1 },
      ],
      { onLineError: 'report' },
    );

    expect(result.outcomes).toEqual([
      { index: 0, status: 'failed', error: NOT_FOUND },
      { index: 1, status: 'failed', error: NOT_FOUND },
      { index: 2, status: 'failed', error: NOT_FOUND },
      { index: 3, status: 'added' },
    ]);
    // A hidden product's outcome is the unknown id's, byte for byte, but for its index.
    const { index: _h, ...hidden } = result.outcomes[0]!;
    const { index: _u, ...unknown } = result.outcomes[1]!;
    expect(JSON.stringify(hidden)).toBe(JSON.stringify(unknown));
    // F12 — the unit read only ever sees vetted ids.
    for (const [ids] of r.catalog.listPackagingUnitsByProductIds.mock.calls as [string[]][]) {
      expect(ids).not.toContain(H);
      expect(ids).not.toContain(UNKNOWN);
      expect(ids).not.toContain(A);
    }
    expect(r.items.map((i) => i.productId)).toEqual([B]);
  });

  it('feature 163 (F1, FR-004) — a member product that is not available in the channel gets the same 404', async () => {
    const r = rig({
      carts: [existingCart()],
      channels: { 'ch-x': [B, D] },
    });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: D, quantity: 1, salesChannelId: 'ch-x' },
        { productId: B, quantity: 1, salesChannelId: 'ch-x' },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes).toEqual([
      { index: 0, status: 'failed', error: NOT_FOUND },
      { index: 1, status: 'added' },
    ]);
    // An operator naming the channel is answered in the channel's default language (N2).
    const scopes = (r.availability.filterAvailable as unknown as { mock: { calls: [string[], ProductAvailabilityScope][] } }).mock.calls.map(
      ([, scope]) => scope,
    );
    expect(scopes.every((scope) => scope.channelId === 'ch-x' && scope.languageCode === null)).toBe(true);
    expect(r.items.map((i) => i.productId)).toEqual([B]);
  });

  it('security review (checkpoint B) — a buyer add with no request scope is asked at the basket’s channel, never by audience alone', async () => {
    const r = rig({ carts: [existingCart()], channels: { [CUSTOMER.salesChannelId]: [B] } });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: D, quantity: 1 },
        { productId: B, quantity: 1 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes).toEqual([
      { index: 0, status: 'failed', error: NOT_FOUND },
      { index: 1, status: 'added' },
    ]);
    const scopes = (r.availability.filterAvailable as unknown as { mock: { calls: [string[], ProductAvailabilityScope][] } }).mock.calls.map(
      ([, scope]) => scope,
    );
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.every((scope) => scope.channelId === CUSTOMER.salesChannelId)).toBe(true);
  });

  it('an unknown packaging unit is the unit 404 and its line counts toward no total', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: A, variantId: RED, quantity: 5, packagingUnitId: 'unit-gone' },
        { productId: A, variantId: BLUE, quantity: 5 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes[0]).toEqual({
      index: 0,
      status: 'failed',
      error: {
        status: 404,
        code: ERROR_CODES.PACKAGING_UNIT_NOT_FOUND,
        message: 'Packaging unit not found for this product.',
      },
    });
    // Had the unresolved line counted, A's total would be 10 and the line admitted.
    expect(result.outcomes[1]).toMatchObject({ index: 1, status: 'below_minimum', minimum: 10 });
    expect(r.items).toHaveLength(0);
  });

  it("'throw' throws the first resolution failure before anything is written", async () => {
    const r = rig();
    await expect(
      r.service.addItems(
        ACTOR,
        [
          { productId: B, quantity: 1 },
          { productId: H, quantity: 5 },
          { productId: UNKNOWN, quantity: 1 },
        ],
        { onLineError: 'throw' },
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.PRODUCT_NOT_FOUND });
    expect(r.carts).toHaveLength(0);
    expect(r.items).toHaveLength(0);
    expect(r.writes).toEqual({ flushes: 0, created: 0 });
  });

  it('a quantity below one is a resolution failure like addItem\'s', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(ACTOR, [{ productId: B, quantity: 0 }], { onLineError: 'report' });
    expect(result.outcomes).toEqual([
      {
        index: 0,
        status: 'failed',
        error: {
          status: 422,
          code: ERROR_CODES.CART_QUANTITY_INVALID,
          message: 'Quantity must be at least 1.',
          details: { quantity: 0, minimum: 1 },
        },
      },
    ]);
  });
});

// ── 2. two passes with the cart ─────────────────────────────────────────────

describe('addItems — the basket channel’s minimum (spec 163, FR-100)', () => {
  it('a channel minimum of 1 lifts the global minimum; a channel minimum of 10 applies where the global has none', async () => {
    const lifted = rig({ carts: [existingCart()], channelMinimums: { [CUSTOMER.salesChannelId]: { [A]: 1 } } });
    const ok = await lifted.service.addItems(ACTOR, [{ productId: A, variantId: RED, quantity: 3 }], { onLineError: 'report' });
    expect(ok.outcomes).toEqual([{ index: 0, status: 'added' }]);

    const raised = rig({ carts: [existingCart()], channelMinimums: { [CUSTOMER.salesChannelId]: { [A]: 20 } } });
    const refused = await raised.service.addItems(ACTOR, [{ productId: A, variantId: RED, quantity: 12 }], {
      onLineError: 'report',
    });
    expect(refused.outcomes[0]).toMatchObject({ index: 0, status: 'below_minimum' });
    expect(raised.items).toEqual([]);
  });
});

describe('addItems — two passes with the cart (D1, FR-006a)', () => {
  it('split variants A-red 5 + A-blue 5 against a minimum of 10 are both added', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: A, variantId: RED, quantity: 5 },
        { productId: A, variantId: BLUE, quantity: 5 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes).toEqual([
      { index: 0, status: 'added' },
      { index: 1, status: 'added' },
    ]);
    expect(r.items.map((i) => [i.variantId, i.quantity])).toEqual([
      [RED, 5],
      [BLUE, 5],
    ]);
    expect(result.items).toHaveLength(2);
  });

  it('A-red 5 + A-blue 3 are both below the minimum, named in the request language, and nothing is added', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: A, variantId: RED, quantity: 5 },
        { productId: A, variantId: BLUE, quantity: 3 },
      ],
      { onLineError: 'report', language: 'pl' },
    );
    expect(result.outcomes).toEqual([
      { index: 0, status: 'below_minimum', productId: A, productName: 'Kotwa', kind: 'pieces', minimum: 10 },
      { index: 1, status: 'below_minimum', productId: A, productName: 'Kotwa', kind: 'pieces', minimum: 10 },
    ]);
    expect(r.items).toHaveLength(0);
  });

  it('a rejected pallet line lowers the pieces total, and pass 2 rejects the piece line too', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: C, quantity: 1, packagingUnitId: PALLET },
        { productId: C, quantity: 3 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes).toEqual([
      {
        index: 0,
        status: 'below_minimum',
        productId: C,
        productName: 'Cement',
        kind: 'packaging_unit',
        minimum: 2,
        packagingUnitName: 'Pallet',
      },
      { index: 1, status: 'below_minimum', productId: C, productName: 'Cement', kind: 'pieces', minimum: 10 },
    ]);
    expect(r.items).toHaveLength(0);
  });

  it('two pallets and three pieces of the same product are both added', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: C, quantity: 2, packagingUnitId: PALLET },
        { productId: C, quantity: 3 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes.map((o) => o.status)).toEqual(['added', 'added']);
    expect(r.items.map((i) => i.quantity)).toEqual([128, 3]);
  });

  it('a line already in the cart below its minimum is never rejected; the batch is judged with it', async () => {
    const existingA = cartLine({ productId: A, quantity: 3 });
    const r = rig({ carts: [existingCart()], items: [existingA] });

    const unrelated = await r.service.addItems(ACTOR, [{ productId: B, quantity: 1 }], { onLineError: 'report' });
    expect(unrelated.outcomes).toEqual([{ index: 0, status: 'added' }]);

    const short = await r.service.addItems(ACTOR, [{ productId: A, variantId: RED, quantity: 4 }], {
      onLineError: 'report',
    });
    expect(short.outcomes[0]).toMatchObject({ status: 'below_minimum', kind: 'pieces', minimum: 10 });

    const enough = await r.service.addItems(ACTOR, [{ productId: A, variantId: RED, quantity: 7 }], {
      onLineError: 'report',
    });
    expect(enough.outcomes).toEqual([{ index: 0, status: 'added' }]);
    expect(existingA.quantity).toBe(3);
  });

  it('an exempt quote-seeded line counts toward its product total', async () => {
    const seeded = cartLine({ productId: A, quantity: 5, agreedQuantity: 5 });
    const r = rig({ carts: [existingCart({ sourceQuoteRequestId: 'qr-1' })], items: [seeded] });

    const short = await r.service.addItems(ACTOR, [{ productId: A, variantId: BLUE, quantity: 3 }], {
      onLineError: 'report',
    });
    expect(short.outcomes[0]).toMatchObject({ status: 'below_minimum', minimum: 10 });

    const enough = await r.service.addItems(ACTOR, [{ productId: A, variantId: BLUE, quantity: 5 }], {
      onLineError: 'report',
    });
    expect(enough.outcomes).toEqual([{ index: 0, status: 'added' }]);
  });

  it('outcomes are in input order across every status', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: B, quantity: 1 },
        { productId: A, quantity: 2 },
        { productId: UNKNOWN, quantity: 1 },
        { productId: B, quantity: 2 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes.map((o) => [o.index, o.status])).toEqual([
      [0, 'added'],
      [1, 'below_minimum'],
      [2, 'failed'],
      [3, 'added'],
    ]);
    // The two B lines share (product, variant, unit) and so one cart line, as addItem bumps.
    expect(r.items.map((i) => [i.productId, i.quantity])).toEqual([[B, 3]]);
    expect(r.audits).toHaveLength(2);
  });
});

// ── 3. adding, and the error modes ──────────────────────────────────────────

describe('addItems — the add step and the error modes', () => {
  it("'throw' rethrows a step-3 refusal with the earlier lines added", async () => {
    const r = rig({ carts: [existingCart()] });
    await expect(
      r.service.addItems(
        ACTOR,
        [
          { productId: B, quantity: 1 },
          { productId: Q, quantity: 1 },
          { productId: B, quantity: 1, variantId: RED },
        ],
        { onLineError: 'throw' },
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.CART_PRODUCT_QUOTE_ONLY });
    expect(r.items.map((i) => i.productId)).toEqual([B]);
  });

  it("'report' returns a step-3 refusal as failed and goes on", async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: B, quantity: 1 },
        { productId: Q, quantity: 1 },
        { productId: B, quantity: 1, variantId: RED },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes).toEqual([
      { index: 0, status: 'added' },
      {
        index: 1,
        status: 'failed',
        error: {
          status: 400,
          code: ERROR_CODES.CART_PRODUCT_QUOTE_ONLY,
          message: 'This product is sold on request only and cannot be added to the cart.',
          // The refusal's own details travel with it, so a caller re-raising it
          // answers exactly what `addItem` would have.
          details: { productId: Q },
        },
      },
      { index: 2, status: 'added' },
    ]);
  });

  it('a switched-off catalogue is rethrown in either mode, never reported as a line', async () => {
    for (const onLineError of ['report', 'throw'] as const) {
      const r = rig({
        carts: [existingCart()],
        findById: async () => {
          throw new ModuleDisabledError('catalog');
        },
      });
      await expect(
        r.service.addItems(ACTOR, [{ productId: B, quantity: 1 }], { onLineError }),
      ).rejects.toMatchObject({ statusCode: 503, code: ERROR_CODES.MODULE_DISABLED });
    }
  });

  it('a switched-off pricing engine in the add step is rethrown in report mode', async () => {
    const r = rig({
      carts: [existingCart()],
      resolveLinePrice: async () => {
        throw new ModuleDisabledError('price_lists');
      },
    });
    await expect(
      r.service.addItems(ACTOR, [{ productId: B, quantity: 1 }], { onLineError: 'report' }),
    ).rejects.toMatchObject({ statusCode: 503, code: ERROR_CODES.MODULE_DISABLED });
  });

  it(`refuses more than CART_MAX_LINES lines before resolving any`, async () => {
    const r = rig({ carts: [existingCart()] });
    const lines = Array.from({ length: CART_MAX_LINES + 1 }, () => ({ productId: B, quantity: 1 }));
    await expect(r.service.addItems(ACTOR, lines, { onLineError: 'report' })).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.CART_LINE_CAP_EXCEEDED,
    });
    expect(r.catalog.findById).not.toHaveBeenCalled();
  });

  it('an empty batch answers the cart with no outcomes', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(ACTOR, [], { onLineError: 'throw' });
    expect(result.outcomes).toEqual([]);
    expect(result.cart.id).toBe('cart-1');
  });

  it('refuses a batch with neither a customer nor an anonymous token', async () => {
    const r = rig();
    await expect(
      r.service.addItems({}, [{ productId: B, quantity: 1 }], { onLineError: 'report' }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(r.catalog.findById).not.toHaveBeenCalled();
  });
});

// ── a whole-request refusal (D1, admin create and API intake) ──────────────

describe("addItems — onBelowMinimum: 'throw' writes nothing (D1)", () => {
  it('refuses the whole batch with the minimum code, every offending line keyed by its index, the product named in the language', async () => {
    const r = rig({ carts: [existingCart()], items: [cartLine({ productId: B, quantity: 3 })] });
    const before = r.items.map((row) => ({ ...row }));
    const error = await r.service
      .addItems(
        ACTOR,
        [
          { productId: B, quantity: 2 },
          { productId: A, variantId: RED, quantity: 3 },
          { productId: A, variantId: BLUE, quantity: 4 },
        ],
        { onLineError: 'throw', onBelowMinimum: 'throw', language: 'pl' },
      )
      .catch((err: unknown) => err);
    expect(error).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY,
      details: {
        productId: A,
        productName: 'Kotwa',
        minimum: 10,
        total: 7,
        lines: [
          { index: 1, productId: A, productName: 'Kotwa', kind: 'pieces', minimum: 10 },
          { index: 2, productId: A, productName: 'Kotwa', kind: 'pieces', minimum: 10 },
        ],
      },
    });
    expect(r.items).toEqual(before);
    expect(r.audits).toEqual([]);
  });

  it('a packaging-unit refusal carries the unit and the units the batch holds', async () => {
    const r = rig();
    const error = await r.service
      .addItems(ACTOR, [{ productId: C, packagingUnitId: PALLET, quantity: 1 }], {
        onLineError: 'throw',
        onBelowMinimum: 'throw',
        language: 'en',
      })
      .catch((err: unknown) => err);
    expect(error).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY,
      details: { productId: C, productName: 'Cement', packagingUnitId: PALLET, minimum: 2, units: 1 },
    });
    expect(r.items).toEqual([]);
  });

  it("'report' stays the default: the same batch adds what passes and reports the rest", async () => {
    const r = rig();
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: B, quantity: 2 },
        { productId: A, variantId: RED, quantity: 3 },
      ],
      { onLineError: 'throw' },
    );
    expect(result.outcomes.map((o) => o.status)).toEqual(['added', 'below_minimum']);
  });
});

describe('addItems — replaceExisting judges the request alone and clears only once it passes (D1)', () => {
  it('a refused request leaves the existing basket exactly as it was', async () => {
    const r = rig({ carts: [existingCart()], items: [cartLine({ productId: B, quantity: 3 })] });
    const cartsBefore = r.carts.map((row) => ({ ...row }));
    const itemsBefore = r.items.map((row) => ({ ...row }));
    await expect(
      r.service.addItems(ACTOR, [{ productId: A, variantId: RED, quantity: 5 }], {
        onLineError: 'throw',
        onBelowMinimum: 'throw',
        replaceExisting: true,
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(r.carts).toEqual(cartsBefore);
    expect(r.items).toEqual(itemsBefore);
  });

  it('a line that fails resolution leaves the existing basket exactly as it was', async () => {
    const r = rig({ carts: [existingCart()], items: [cartLine({ productId: B, quantity: 3 })] });
    const itemsBefore = r.items.map((row) => ({ ...row }));
    await expect(
      r.service.addItems(ACTOR, [{ productId: UNKNOWN, quantity: 5 }], {
        onLineError: 'throw',
        onBelowMinimum: 'throw',
        replaceExisting: true,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(r.carts[0]).toMatchObject({ status: 'active' });
    expect(r.items).toEqual(itemsBefore);
  });

  it('the basket being replaced does not count toward the request: A × 7 in the cart does not carry A × 5', async () => {
    const r = rig({ carts: [existingCart()], items: [cartLine({ productId: A, variantId: RED, quantity: 7 })] });
    await expect(
      r.service.addItems(ACTOR, [{ productId: A, variantId: RED, quantity: 5 }], {
        onLineError: 'throw',
        onBelowMinimum: 'throw',
        replaceExisting: true,
      }),
    ).rejects.toMatchObject({ statusCode: 422, details: { total: 5 } });
    expect(r.items).toHaveLength(1);
  });

  it('a request that passes replaces the basket: the old cart is completed, the new one holds the request', async () => {
    const r = rig({ carts: [existingCart()], items: [cartLine({ productId: B, quantity: 3 })] });
    const result = await r.service.addItems(ACTOR, [{ productId: A, variantId: RED, quantity: 10 }], {
      onLineError: 'throw',
      onBelowMinimum: 'throw',
      replaceExisting: true,
    });
    expect(r.carts.find((c) => c.id === 'cart-1')).toMatchObject({ status: 'completed' });
    expect(result.cart.id).not.toBe('cart-1');
    expect(result.items.map((i) => [i.productId, i.quantity])).toEqual([[A, 10]]);
  });

  /**
   * Feature 159 (research N-31) — the admin order creation places one product on
   * lines of several groups, so its seed keeps a repeated line a line of its own,
   * in request order, each priced at its own quantity.
   */
  it('keepRepeatedLines: a repeated product stays two lines, in request order, each priced at its own quantity', async () => {
    const r = rig({
      carts: [existingCart()],
      items: [cartLine({ productId: B, quantity: 3 })],
      // From 8 pieces a cheaper bracket: a merged B × 8 would reach it.
      resolveLinePrice: async ({ context }) => ({
        amount: context.quantity >= 8 ? '8.00' : '10.00',
        currency: 'PLN',
        priceListId: 'pl-1',
        isSale: false,
        bracketStartQuantity: 1,
        displayMode: 'gross_only',
      }),
    });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: B, quantity: 5 },
        { productId: C, quantity: 10 },
        { productId: B, quantity: 3 },
      ],
      { onLineError: 'throw', onBelowMinimum: 'throw', replaceExisting: true, keepRepeatedLines: true },
    );
    const lines = result.items.filter((item) => item.cartId === result.cart.id);
    expect(lines.map((item) => [item.productId, item.quantity, item.unitPrice])).toEqual([
      [B, 5, '10.0000'],
      [C, 10, '8.0000'],
      [B, 3, '10.0000'],
    ]);
    // Distinct, increasing creation times: the basket reads back in request order.
    const times = lines.map((item) => (item.createdAt as Date).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(3);
  });

  it('keepRepeatedLines still judges a minimum on the product total across its lines (feature 155, D1)', async () => {
    const r = rig();
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: A, variantId: RED, quantity: 5 },
        { productId: A, variantId: RED, quantity: 5 },
      ],
      { onLineError: 'throw', onBelowMinimum: 'throw', replaceExisting: true, keepRepeatedLines: true },
    );
    expect(result.items.map((item) => item.quantity)).toEqual([5, 5]);
  });

  it('without keepRepeatedLines a repeated product is merged into one line, as before', async () => {
    const r = rig();
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: B, quantity: 5 },
        { productId: B, quantity: 3 },
      ],
      { onLineError: 'throw', replaceExisting: true },
    );
    expect(result.items.map((item) => [item.productId, item.quantity])).toEqual([[B, 8]]);
  });

  it('keepRepeatedLines is refused without replaceExisting — it describes a fresh basket', async () => {
    const r = rig();
    await expect(
      r.service.addItems(ACTOR, [{ productId: B, quantity: 1 }], { onLineError: 'throw', keepRepeatedLines: true }),
    ).rejects.toThrow(/keepRepeatedLines/);
  });

  it('is refused for an anonymous actor — only a customer has a basket to replace', async () => {
    const r = rig();
    await expect(
      r.service.addItems({ anonymousToken: 'anon-1' }, [{ productId: B, quantity: 1 }], {
        onLineError: 'throw',
        replaceExisting: true,
      }),
    ).rejects.toThrow(/replaceExisting/);
  });

  /**
   * Round C (item 2) — with `'report'` a line the write step refuses is an
   * outcome rather than a refusal, so the basket would already be cleared when
   * it is met: the combination is refused before anything is read or written.
   */
  it("is refused with onLineError 'report' — a reported failure would arrive after the basket is cleared", async () => {
    const r = rig({ carts: [existingCart()], items: [cartLine({ productId: B, quantity: 3 })] });
    const cartsBefore = r.carts.map((row) => ({ ...row }));
    const itemsBefore = r.items.map((row) => ({ ...row }));
    await expect(
      r.service.addItems(ACTOR, [{ productId: B, quantity: 1 }], {
        onLineError: 'report',
        replaceExisting: true,
      }),
    ).rejects.toThrow(/replaceExisting.*'throw'/);
    expect(r.carts).toEqual(cartsBefore);
    expect(r.items).toEqual(itemsBefore);
  });
});

// ── performance (F4) ────────────────────────────────────────────────────────

describe('addItems — bounded work (F4, R20)', () => {
  it('200 batch lines against a 200-line cart read the packaging units once', async () => {
    const ids = Array.from({ length: CART_MAX_LINES }, (_, i) => `perf-${i}`);
    const products = new Map(ids.map((id) => [id, product(id, { minOrderQuantity: 10 })]));
    const r = rig({
      carts: [existingCart()],
      items: ids.map((id) => cartLine({ productId: id, quantity: 10 })),
      products,
    });
    const result = await r.service.addItems(
      ACTOR,
      ids.map((id) => ({ productId: id, quantity: 1 })),
      { onLineError: 'report' },
    );
    expect(result.outcomes.every((o) => o.status === 'added')).toBe(true);
    // One unit read for the whole batch, not one per line.
    expect(r.catalog.listPackagingUnitsByProductIds).toHaveBeenCalledTimes(1);
  });
});

/**
 * Feature 163 (FR-079, T138; owner decision 2026-10-26) — a line ordered by a packaging
 * unit snapshots the unit's name in the basket's scope language (the request tag resolved
 * against the basket's channel), else the global name. The minimum refusal keeps naming
 * the global unit (feature 155's sentence, unchanged here).
 */
describe('CartService — the packaging-unit name snapshot in the basket language', () => {
  const pallets = [{ productId: C, quantity: 2, packagingUnitId: PALLET }];

  it('takes the translation at the request language on the basket channel', async () => {
    requestChannel.current = { id: CUSTOMER.salesChannelId!, languages: ['en-US', 'pl-PL'], defaultLanguage: 'en-US' };
    try {
      const r = rig({ carts: [existingCart()] });
      const result = await r.service.addItems({ ...ACTOR, languageTag: 'pl' }, pallets, { onLineError: 'report' });
      expect(result.outcomes.map((o) => o.status)).toEqual(['added']);
      expect(r.items.map((i) => i['packagingUnitName'])).toEqual(['Paleta']);
    } finally {
      requestChannel.current = null;
    }
  });

  it('takes the global name in a language with no translation', async () => {
    requestChannel.current = { id: CUSTOMER.salesChannelId!, languages: ['en-US', 'pl-PL'], defaultLanguage: 'en-US' };
    try {
      const r = rig({ carts: [existingCart()] });
      await r.service.addItems({ ...ACTOR, languageTag: 'en-US' }, pallets, { onLineError: 'report' });
      expect(r.items.map((i) => i['packagingUnitName'])).toEqual(['Pallet']);
    } finally {
      requestChannel.current = null;
    }
  });

  it('takes the global name outside a request (no scope language)', async () => {
    const r = rig({ carts: [existingCart()] });
    await r.service.addItems({ ...ACTOR, languageTag: 'pl' }, pallets, { onLineError: 'report' });
    expect(r.items.map((i) => i['packagingUnitName'])).toEqual(['Pallet']);
  });
});

/**
 * Feature 163, owner decision N2 = B (2026-10-26) — an operator naming the channel (the
 * order-on-behalf and quote-seeded basket paths) has no request language: the unit name
 * is snapshotted at that channel's default language, as the product name beside it is.
 * The channel is read only when a packaging unit is named.
 */
describe('CartService — the packaging-unit name when an operator names the channel (N2)', () => {
  const onBehalf = (channel: string) => [{ productId: C, quantity: 2, packagingUnitId: PALLET, salesChannelId: channel }];

  it("takes the translation at the named channel's default language", async () => {
    const r = rig({ carts: [existingCart()], channels: { 'ch-pl': [C] }, channelDefaultLanguages: { 'ch-pl': 'pl-PL' } });
    const result = await r.service.addItems(ACTOR, onBehalf('ch-pl'), { onLineError: 'report' });
    expect(result.outcomes.map((o) => o.status)).toEqual(['added']);
    expect(r.items.map((i) => i['packagingUnitName'])).toEqual(['Paleta']);
  });

  it('takes the global name when the default language has no translation', async () => {
    const r = rig({ carts: [existingCart()], channels: { 'ch-en': [C] }, channelDefaultLanguages: { 'ch-en': 'en-US' } });
    await r.service.addItems(ACTOR, onBehalf('ch-en'), { onLineError: 'report' });
    expect(r.items.map((i) => i['packagingUnitName'])).toEqual(['Pallet']);
  });

  it('does not read the channel for a line with no packaging unit', async () => {
    const r = rig({ carts: [existingCart()], channels: { 'ch-pl': [A] }, channelDefaultLanguages: { 'ch-pl': 'pl-PL' } });
    await r.service.addItems(ACTOR, [{ productId: A, quantity: 1, salesChannelId: 'ch-pl' }], { onLineError: 'report' });
    expect(r.channelReads.getById).not.toHaveBeenCalled();
  });
});
