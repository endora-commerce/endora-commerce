import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  BasePricesForCurrency,
  PriceBookRowInput,
  PriceBookType,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  Category,
  CustomerAccount,
  CustomerGroup,
  Organization,
  Product,
  ProductVariant,
  type ProductRow,
} from './package-entities.js';
import type { BackendServerHandle } from './test-server.js';
import { findAttributeExtensionByKey } from './seed-catalog.js';
import { withSystemScope } from '../../src/tenancy/escape-hatch.js';
import type { PricingService } from '../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import type { PriceBookService } from '../../../packages/modules/price_lists/src/backend/services/price-book-service.js';
import type { PricingLineResult } from '../../../packages/modules/price_lists/src/backend/services/pricing-service.interface.js';

/**
 * Feature 160 — the shared pricing fixture of `specs/pricing/worked-examples.md`
 * §10.1, §10.12 and §10.14, written against price books.
 *
 * - Channels **CH1** "B2B PL" [PLN] (the §10.1 `CH`), **CH2** "B2C PL"
 *   [PLN, EUR], **CH3** "EU" [EUR].
 * - Categories **Screws** and **Bolts**; the seeded `color` attribute (a
 *   choice attribute) flagged *Price list rules*.
 * - Products **P1** *Screws 0200* {Screws} red, **P2** *Screws 0300* {Screws}
 *   blue, **P3** *Bolt 10* {Bolts} red, **P4** in Screws with **no** base
 *   price (and a legacy `defaultPrice`, which is not a price — FR-018), and the
 *   configurable **P5** *Screws 0500* {Screws} with variants **P5r** (red) and
 *   **P5b** (blue).
 * - Base book PLN: P1 100, P2 50, P3 30, P5 80 with P5r +10 %.
 * - Customer groups **VIP**, **Gold**, **Silver**; organizations **Acme**
 *   (VIP), **Beta** (VIP), **Gamma** (no group) and **AcmeW** (a child of
 *   Acme, VIP); customer accounts **Ola** of Gamma with her own group Gold, a
 *   Beta customer with her own group Silver and one with none.
 *
 * Every price is asked through the batched entry point the consumers use
 * (`resolveLinePrices`) on the composed `PricingService` (price books),
 * and every book is written through `PriceBookService` — the audited write path
 * — inside a system scope, as a worker would.
 */

export interface ChannelRef {
  id: string;
  code: string;
  defaultCurrency: string;
}

export type Buyer =
  | 'guest'
  | { organization: OrganizationRef; customerAccountId?: string | null };

export interface OrganizationRef {
  id: string;
  customerGroupId?: string | null;
}

export type Audience =
  | 'everyone'
  | { organizations: readonly OrganizationRef[] }
  | { groups: readonly string[] };

/** A row in the vectors' shorthand: one selection, one window, one price. */
export interface RowSpec {
  product?: { id: string };
  variant?: string;
  category?: string;
  attribute?: readonly [string, string];
  min?: number;
  max?: number | null;
  fixed?: string;
  percent?: string;
  amount?: string;
}

export interface BookSpec {
  name?: string;
  type?: PriceBookType;
  currency?: string;
  channels?: readonly ChannelRef[];
  audience: Audience;
  priority?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  rows?: readonly RowSpec[];
  /** Default `true`. */
  activate?: boolean;
}

export interface PricingFixture {
  h: BackendServerHandle;
  channels: { CH1: ChannelRef; CH2: ChannelRef; CH3: ChannelRef };
  categories: { screws: string; bolts: string };
  products: { P1: ProductRow; P2: ProductRow; P3: ProductRow; P4: ProductRow; P5: ProductRow };
  variants: { P5r: string; P5b: string };
  groups: { VIP: string; Gold: string; Silver: string };
  orgs: { Acme: OrganizationRef; Beta: OrganizationRef; Gamma: OrganizationRef; AcmeW: OrganizationRef };
  accounts: { ola: string; betaSilver: string; betaPlain: string };
  pricing: PricingService;
  books: PriceBookService;
  system<T>(work: () => Promise<T>): Promise<T>;
  /** Replace a product's PLN base price (tiers and variant rows). */
  setBase(product: { id: string }, prices: BasePricesForCurrency, currency?: string): Promise<void>;
  /** Create a book with rows, activated unless told otherwise; returns its id and its rows' ids in order. */
  book(spec: BookSpec): Promise<{ id: string; rowIds: string[] }>;
  /** The line price, through `resolveLinePrices`. */
  price(
    buyer: Buyer,
    product: ProductRow,
    options?: { quantity?: number; variantId?: string | null; channel?: ChannelRef; currency?: string },
  ): Promise<PricingLineResult | null>;
  /** The line amount (4 dp) or `null` for unpriced. */
  amount(
    buyer: Buyer,
    product: ProductRow,
    options?: { quantity?: number; variantId?: string | null; channel?: ChannelRef; currency?: string },
  ): Promise<string | null>;
  /** Drop every non-system book (rows, members and channel rows cascade). */
  clearBooks(): Promise<void>;
  /** Restore the fixture's base prices. */
  resetBase(): Promise<void>;
}

const DEFAULT_BASE: Record<'P1' | 'P2' | 'P3' | 'P5', string> = { P1: '100', P2: '50', P3: '30', P5: '80' };

export function rowInput(spec: RowSpec): PriceBookRowInput {
  const price: PriceBookRowInput['price'] =
    spec.fixed !== undefined
      ? { type: 'fixed', amount: spec.fixed }
      : spec.percent !== undefined
        ? { type: 'percent', percent: spec.percent }
        : { type: 'amount', amount: spec.amount ?? '0' };
  return {
    selection: {
      ...(spec.variant ? { variantId: spec.variant } : {}),
      ...(spec.product ? { productId: spec.product.id } : {}),
      ...(spec.category ? { categoryId: spec.category } : {}),
      ...(spec.attribute ? { attribute: { key: spec.attribute[0], value: spec.attribute[1] } } : {}),
    },
    minQuantity: spec.min ?? 1,
    maxQuantity: spec.max ?? null,
    price,
  };
}

export async function setupPricingFixture(h: BackendServerHandle): Promise<PricingFixture> {
  const em: EntityManager = h.em();
  const stamp = randomUUID().slice(0, 8);
  const system = <T>(work: () => Promise<T>) => withSystemScope(`feature 160 pricing fixture ${stamp}`, work);

  // --- Channels (§10.12) ---------------------------------------------------
  const channel = (code: string, currencies: string[]) =>
    em.create(SalesChannel, {
      code: `${code}-${stamp}`,
      name: { 'en-US': code, 'pl-PL': code },
      defaultLanguage: 'pl-PL',
      languages: ['pl-PL'],
      defaultCurrency: currencies[0]!,
      currencies,
    });
  const ch1 = channel('ch1', ['PLN']);
  const ch2 = channel('ch2', ['PLN', 'EUR']);
  const ch3 = channel('ch3', ['EUR']);
  await em.persistAndFlush([ch1, ch2, ch3]);
  const ref = (c: SalesChannel): ChannelRef => ({ id: c.id, code: c.code, defaultCurrency: c.defaultCurrency });

  // --- Categories and the price-rule attribute ------------------------------
  const screws = em.create(Category, { name: { 'en-US': 'Screws' }, slug: `screws-${stamp}` });
  const bolts = em.create(Category, { name: { 'en-US': 'Bolts' }, slug: `bolts-${stamp}` });
  await em.persistAndFlush([screws, bolts]);
  const color = await findAttributeExtensionByKey(em, 'color');
  if (!color) throw new Error('pricing fixture: the seeded `color` attribute is missing.');
  color.isPriceRule = true;
  await em.flush();

  // --- Products --------------------------------------------------------------
  const product = (sku: string, name: string, attributeValues: Record<string, unknown>, type: 'simple' | 'configurable' = 'simple') =>
    em.create(Product, {
      sku: `${sku}-${stamp}`,
      slug: `${sku.toLowerCase()}-${stamp}`,
      type,
      status: 'active',
      name: { 'en-US': name },
      description: { 'en-US': name },
      visibility: 'public',
      attributeValues,
    });
  const P1 = product('P1', 'Screws 0200', { color: 'red' });
  const P2 = product('P2', 'Screws 0300', { color: 'blue' });
  const P3 = product('P3', 'Bolt 10', { color: 'red' });
  const P4 = product('P4', 'Screws 0400', { color: 'red', defaultPrice: 55 });
  const P5 = product('P5', 'Screws 0500', {}, 'configurable');
  await em.persistAndFlush([P1, P2, P3, P4, P5]);
  const P5r = em.create(ProductVariant, {
    parentProductId: P5.id,
    sku: `P5R-${stamp}`,
    variantAttributeValues: { color: 'red' },
  });
  const P5b = em.create(ProductVariant, {
    parentProductId: P5.id,
    sku: `P5B-${stamp}`,
    variantAttributeValues: { color: 'blue' },
  });
  await em.persistAndFlush([P5r, P5b]);
  await em
    .getConnection()
    .execute(
      `insert into "product_categories" ("product_id", "category_id") values (?, ?), (?, ?), (?, ?), (?, ?), (?, ?)`,
      [P1.id, screws.id, P2.id, screws.id, P3.id, bolts.id, P4.id, screws.id, P5.id, screws.id],
    );

  // --- Buyers ----------------------------------------------------------------
  const group = (code: string) => em.create(CustomerGroup, { code: `${code}-${stamp}`, name: code });
  const VIP = group('vip');
  const Gold = group('gold');
  const Silver = group('silver');
  await em.persistAndFlush([VIP, Gold, Silver]);
  let tax = 0;
  const organization = (name: string, customerGroupId: string | null, parent?: Organization) => {
    tax += 1;
    const id = randomUUID();
    return em.create(Organization, {
      id,
      name: `${name} ${stamp}`,
      taxId: `PL160${stamp}${tax}`,
      vatStatus: 'vat_payer',
      status: 'active',
      customerGroupId,
      registeredAddress: { street: 'Test 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
      ...(parent ? { parentId: parent.id, path: `${parent.path}${id}/` } : {}),
    });
  };
  const Acme = organization('Acme B2B (demo)', VIP.id);
  const Beta = organization('Beta', VIP.id);
  const Gamma = organization('Gamma', null);
  await em.persistAndFlush([Acme, Beta, Gamma]);
  const AcmeW = organization('AcmeW', VIP.id, Acme);
  await em.persistAndFlush(AcmeW);
  const account = (organizationId: string, name: string, customerGroupId: string | null) =>
    em.create(CustomerAccount, {
      organizationId,
      email: `${name}-${stamp}@pricing.test`,
      passwordHash: 'x'.repeat(60),
      firstName: name,
      lastName: 'Fixture',
      customerGroupId,
    });
  const ola = account(Gamma.id, 'ola', Gold.id);
  const betaSilver = account(Beta.id, 'beta-silver', Silver.id);
  const betaPlain = account(Beta.id, 'beta-plain', null);
  await em.persistAndFlush([ola, betaSilver, betaPlain]);

  // --- The engine and the write path ----------------------------------------
  const container = h.container as unknown as { resolve<T>(name: string): T };
  // The composed engine and write service (`price_lists` composes the price-book
  // engine since the consumer phase), so every surface the fixture prices
  // through — and the price surface its writes mark stale — is the platform's.
  const handle = container.resolve<{
    handle: { pricingEngine: PricingService; priceBookService: PriceBookService };
  }>('priceLists').handle;
  const pricing = handle.pricingEngine;
  const books = handle.priceBookService;

  const fixture: PricingFixture = {
    h,
    channels: { CH1: ref(ch1), CH2: ref(ch2), CH3: ref(ch3) },
    categories: { screws: screws.id, bolts: bolts.id },
    products: { P1, P2, P3, P4, P5 },
    variants: { P5r: P5r.id, P5b: P5b.id },
    groups: { VIP: VIP.id, Gold: Gold.id, Silver: Silver.id },
    orgs: {
      Acme: { id: Acme.id, customerGroupId: VIP.id },
      Beta: { id: Beta.id, customerGroupId: VIP.id },
      Gamma: { id: Gamma.id, customerGroupId: null },
      AcmeW: { id: AcmeW.id, customerGroupId: VIP.id },
    },
    accounts: { ola: ola.id, betaSilver: betaSilver.id, betaPlain: betaPlain.id },
    pricing,
    books,
    system,

    async setBase(target, prices, currency = 'PLN') {
      await system(() => books.setBasePrices(target.id, { byCurrency: { [currency]: prices } }));
    },

    async book(spec) {
      return system(async () => {
        const audience =
          spec.audience === 'everyone'
            ? { kind: 'everyone' as const, memberIds: [] }
            : 'organizations' in spec.audience
              ? { kind: 'organizations' as const, memberIds: spec.audience.organizations.map((o) => o.id) }
              : { kind: 'customer_groups' as const, memberIds: [...spec.audience.groups] };
        const created = await books.createBook({
          name: spec.name ?? `Book ${randomUUID().slice(0, 6)}`,
          type: spec.type ?? 'regular',
          currencyCode: spec.currency ?? 'PLN',
          channelIds: (spec.channels ?? [fixture.channels.CH1]).map((c) => c.id),
          audience,
          priority: spec.priority ?? 0,
          ...(spec.startsAt !== undefined ? { startsAt: spec.startsAt?.toISOString() ?? null } : {}),
          ...(spec.endsAt !== undefined ? { endsAt: spec.endsAt?.toISOString() ?? null } : {}),
        });
        const written = await books.replaceRows(created.id, {
          upsert: (spec.rows ?? []).map(rowInput),
          delete: [],
        });
        if (spec.activate !== false) await books.activate(created.id);
        return { id: created.id, rowIds: written.rows.map((r: { id: string }) => r.id) };
      });
    },

    async price(buyer, target, options = {}) {
      const channel = options.channel ?? fixture.channels.CH1;
      const context =
        buyer === 'guest'
          ? {}
          : {
              organization: buyer.organization,
              ...(buyer.customerAccountId ? { customerAccountId: buyer.customerAccountId } : {}),
            };
      const answer = await pricing.resolveLinePrices({
        lines: [{ key: 'k', product: target, variantId: options.variantId ?? null, quantity: options.quantity ?? 1 }],
        context: {
          ...context,
          salesChannel: { id: channel.id, defaultCurrency: channel.defaultCurrency },
          ...(options.currency ? { currencyCode: options.currency } : {}),
        },
      });
      return answer.get('k') ?? null;
    },

    async amount(buyer, target, options) {
      return (await fixture.price(buyer, target, options))?.amount ?? null;
    },

    async clearBooks() {
      await h
        .em()
        .getConnection()
        .execute(`delete from "price_lists" where "is_system" = false`);
      // A raw delete is no write the price surface hears of: tell it, as a
      // write that says nothing about itself does (every profile stale).
      await pricing.priceSurface.markStale();
    },

    async resetBase() {
      for (const [key, amount] of Object.entries(DEFAULT_BASE) as Array<[keyof typeof DEFAULT_BASE, string]>) {
        await fixture.setBase(fixture.products[key], {
          product: [{ minQuantity: 1, maxQuantity: null, amount }],
          variants: key === 'P5' ? { [P5r.id]: { type: 'percent', percent: '10' }, [P5b.id]: null } : {},
        });
      }
      await fixture.setBase(fixture.products.P4, { product: [], variants: {} });
    },
  };
  await fixture.resetBase();
  return fixture;
}
