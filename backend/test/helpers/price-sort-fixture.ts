import type { EntityManager } from '@mikro-orm/postgresql';
import { Organization, PriceList, PriceListPriceBracket, PriceListProduct } from './package-entities.js';
import { SalesChannel } from '../../src/kernel/sales-channels/sales-channel.entity.js';
import { Product } from './package-entities.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from './test-actors.js';

/**
 * The corpus feature 086's acceptance tests order.
 *
 * Built so that **the three viewers disagree about the order**, not merely
 * about the numbers: organisation A's list inverts organisation B's over the
 * same two products, so an implementation that ordered by any figure other than
 * the caller's own — the base attribute, the channel list, a cached answer from
 * whoever asked first — puts two of the three viewers in the wrong sequence and
 * fails.
 *
 * Four products, each carrying one of the four cases the specification
 * separates:
 *
 *  - `ALPHA` and `BETA` are priced by all three lists, at figures that invert
 *    between the two buyers;
 *  - `GAMMA` is priced by nobody. It carries the legacy `defaultPrice`
 *    attribute at a value that would place it first if the attribute ever
 *    reached the ordering — it must not, and it belongs in the tail (spec
 *    clarification 1);
 *  - `DELTA` is restricted to organisation A and priced by the channel list
 *    **between** the two anonymous figures, so a viewer outside A who could
 *    observe it would see a gap, a shifted position or a different page
 *    boundary. That is US5's disclosure, and it is the reason the middle is
 *    where it sits.
 */

export const PRICE_SORT_CHANNEL = { 'x-sales-channel': 'pl_retail' };
export const PRICE_SORT_ORG_A = { b2b_session: 'stub-customer-session' };
export const PRICE_SORT_ORG_B = { b2b_session: 'stub-customer-session-other-org' };

export const ALPHA = {
  id: '00000000-0000-4000-8000-0000000086a1',
  sku: 'PRICE-SORT-ALPHA',
  slug: 'price-sort-alpha',
};
export const BETA = {
  id: '00000000-0000-4000-8000-0000000086a2',
  sku: 'PRICE-SORT-BETA',
  slug: 'price-sort-beta',
};
export const GAMMA = {
  id: '00000000-0000-4000-8000-0000000086a3',
  sku: 'PRICE-SORT-GAMMA',
  slug: 'price-sort-gamma',
};
export const DELTA = {
  id: '00000000-0000-4000-8000-0000000086a4',
  sku: 'PRICE-SORT-DELTA',
  slug: 'price-sort-delta',
};

/** Channel (anonymous) figures. `DELTA` sits between the other two on purpose. */
export const CHANNEL_PRICES = { alpha: 50, beta: 60, delta: 55 };
/** Organisation A inverts the pair, and sees `DELTA`. */
export const ORG_A_PRICES = { alpha: 10, beta: 90 };
/** Organisation B inverts A. */
export const ORG_B_PRICES = { alpha: 90, beta: 10 };
/** `GAMMA`'s legacy attribute — low enough to lead the listing if it ever leaked in. */
export const GAMMA_ATTRIBUTE_PRICE = 1;

const CHANNEL_LIST_ID = '00000000-0000-4000-8000-0000000086b1';
const ORG_A_LIST_ID = '00000000-0000-4000-8000-0000000086b2';
const ORG_B_LIST_ID = '00000000-0000-4000-8000-0000000086b3';

async function seedProduct(
  em: EntityManager,
  channelId: string,
  input: {
    id: string;
    sku: string;
    slug: string;
    visibility: 'public' | 'organization_restricted';
    allowedOrganizationIds: string[];
    attributeValues: Record<string, unknown>;
    createdAt: Date;
  },
): Promise<void> {
  const product = em.create(Product, {
    id: input.id,
    sku: input.sku,
    slug: input.slug,
    type: 'simple',
    status: 'active',
    name: { 'en-US': input.sku },
    description: { 'en-US': input.sku },
    visibility: input.visibility,
    allowedOrganizationIds: input.allowedOrganizationIds,
    attributeValues: input.attributeValues,
    createdAt: input.createdAt,
  });
  await em.persistAndFlush(product);
  await em
    .getConnection()
    .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [
      channelId,
      input.id,
    ]);
}

async function seedList(
  em: EntityManager,
  input: {
    id: string;
    code: string;
    name: string;
    applicationRule: PriceList['applicationRule'];
    modifiedAt: Date;
    amounts: Record<string, string>;
  },
): Promise<void> {
  const list = em.create(PriceList, {
    id: input.id,
    code: input.code,
    name: input.name,
    currency: 'PLN',
    isDefault: false,
    priority: 0,
    type: 'base',
    status: 'active',
    startsAt: null,
    endsAt: null,
    applicationRule: input.applicationRule,
    isSystem: false,
    modifiedAt: input.modifiedAt,
  });
  await em.persistAndFlush(list);
  for (const productId of Object.keys(input.amounts)) {
    em.create(PriceListProduct, { priceListId: list.id, productId });
  }
  await em.flush();
  for (const [productId, amount] of Object.entries(input.amounts)) {
    em.create(PriceListPriceBracket, {
      priceListId: list.id,
      productId,
      currencyCode: 'PLN',
      minQuantity: 1,
      maxQuantity: null,
      amount,
    });
  }
  await em.flush();
}

export async function seedPriceSortFixture(em: EntityManager): Promise<void> {
  const existingOther = await em.findOne(Organization, { id: OTHER_TEST_ORGANIZATION_ID });
  if (!existingOther) {
    const other = em.create(Organization, {
      id: OTHER_TEST_ORGANIZATION_ID,
      name: 'Other Test Organization',
      taxId: 'PL0000000098',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Testowa 98',
        city: 'Warszawa',
        postalCode: '00-901',
        country: 'PL',
      },
    });
    await em.persistAndFlush(other);
  }

  const retail = await em.findOne(SalesChannel, { code: 'pl_retail' });
  if (!retail) throw new Error('the harness seeds pl_retail');

  // `createdAt` descending is the listing's default ordering and therefore the
  // tail's, so the fixture fixes it rather than letting one clock decide — and
  // fixes it **against** every price ordering. The default order is
  // `[GAMMA, DELTA, BETA, ALPHA]` and the ascending price order is
  // `[ALPHA, DELTA, BETA, GAMMA]`, so a listing that ignored `sort=price` and
  // served its usual page cannot pass by coincidence.
  await seedProduct(em, retail.id, {
    ...ALPHA,
    visibility: 'public',
    allowedOrganizationIds: [],
    attributeValues: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  await seedProduct(em, retail.id, {
    ...BETA,
    visibility: 'public',
    allowedOrganizationIds: [],
    attributeValues: {},
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  await seedProduct(em, retail.id, {
    ...GAMMA,
    visibility: 'public',
    allowedOrganizationIds: [],
    attributeValues: { defaultPrice: GAMMA_ATTRIBUTE_PRICE },
    createdAt: new Date('2026-01-04T00:00:00.000Z'),
  });
  await seedProduct(em, retail.id, {
    ...DELTA,
    visibility: 'organization_restricted',
    allowedOrganizationIds: [TEST_ORGANIZATION_ID],
    attributeValues: {},
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
  });

  await seedList(em, {
    id: CHANNEL_LIST_ID,
    code: 'price-sort-channel',
    name: 'Price sort channel list',
    applicationRule: { kind: 'all' },
    modifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    amounts: {
      [ALPHA.id]: `${CHANNEL_PRICES.alpha}.00`,
      [BETA.id]: `${CHANNEL_PRICES.beta}.00`,
      [DELTA.id]: `${CHANNEL_PRICES.delta}.00`,
    },
  });
  await seedList(em, {
    id: ORG_A_LIST_ID,
    code: 'price-sort-org-a',
    name: 'Price sort organisation A',
    applicationRule: { kind: 'criterion', type: 'organization', values: [TEST_ORGANIZATION_ID] },
    modifiedAt: new Date('2026-01-02T00:00:00.000Z'),
    amounts: {
      [ALPHA.id]: `${ORG_A_PRICES.alpha}.00`,
      [BETA.id]: `${ORG_A_PRICES.beta}.00`,
    },
  });
  await seedList(em, {
    id: ORG_B_LIST_ID,
    code: 'price-sort-org-b',
    name: 'Price sort organisation B',
    applicationRule: {
      kind: 'criterion',
      type: 'organization',
      values: [OTHER_TEST_ORGANIZATION_ID],
    },
    modifiedAt: new Date('2026-01-03T00:00:00.000Z'),
    amounts: {
      [ALPHA.id]: `${ORG_B_PRICES.alpha}.00`,
      [BETA.id]: `${ORG_B_PRICES.beta}.00`,
    },
  });
}

/** Removes `DELTA` altogether — SC-007's "the same catalogue with it deleted". */
export async function deleteRestrictedProduct(em: EntityManager): Promise<void> {
  const conn = em.getConnection();
  await conn.execute(`delete from price_list_price_brackets where product_id = ?`, [DELTA.id]);
  await conn.execute(`delete from price_list_products where product_id = ?`, [DELTA.id]);
  await conn.execute(`delete from sales_channel_products where product_id = ?`, [DELTA.id]);
  await conn.execute(`delete from products where id = ?`, [DELTA.id]);
}
