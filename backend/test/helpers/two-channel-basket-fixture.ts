import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import { PRICING_SETTING_CODES } from '@endora-commerce/contracts';
import { Product } from './package-entities.js';
import { seedPriceBookSql } from './price-book-sql.js';
import { addOrganizationChannels } from './sales-channel-access.js';
import { TEST_ORGANIZATION_ID } from './test-actors.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * Two stores that sell one product at two different prices — the fixture the
 * basket-attribution tests of `specs/154-sales-channel-access/` (User Story 6)
 * are written against.
 *
 * The prices are what make the channel visible: a basket priced on the wrong
 * channel — the system default, as every basket was before — reads as neither
 * {@link TwoChannelBasket.priceOnA} nor {@link TwoChannelBasket.priceOnB},
 * because the product has no base price and no book bound to the default
 * channel. So a line that is priced at all was priced on one of the two stores,
 * and the figure says which.
 *
 * Each price is a catalogue book bound to its one channel (feature 160 US3),
 * which the pricing engine selects by the channel it is handed. The
 * test Organization is assigned both channels through the membership service,
 * so the access rule lets the fixture buyer shop on either.
 */
export interface TwoChannelBasket {
  readonly a: { readonly id: string; readonly code: string };
  readonly b: { readonly id: string; readonly code: string };
  readonly productId: string;
  /** Decimal string — the list price on channel A. */
  readonly priceOnA: string;
  /** Decimal string — the list price on channel B. */
  readonly priceOnB: string;
}

export const PRICE_ON_A = '30.00';
export const PRICE_ON_B = '40.00';

async function createChannel(em: EntityManager, code: string): Promise<{ id: string; code: string }> {
  const channel = em.create(SalesChannel, {
    code,
    name: { 'en-US': `Basket probe ${code}` },
    languages: ['en-US'],
    defaultLanguage: 'en-US',
    currencies: ['PLN'],
    defaultCurrency: 'PLN',
    active: true,
  });
  await em.persistAndFlush(channel);
  return { id: channel.id, code };
}

async function priceOnChannel(
  em: EntityManager,
  input: { code: string; channelId: string; productId: string; amount: string },
): Promise<void> {
  // A channel catalogue book (feature 160 US3): everyone, on that one channel.
  await seedPriceBookSql(em, {
    name: input.code,
    audience: 'everyone',
    channelIds: [input.channelId],
    rows: [{ productId: input.productId, fixed: input.amount }],
  });
}

export async function seedTwoChannelBasket(
  h: BackendServerHandle,
  prefix: string,
): Promise<TwoChannelBasket> {
  const em = h.em();
  const suffix = randomUUID().slice(0, 8);
  const a = await createChannel(em, `${prefix}-a-${suffix}`);
  const b = await createChannel(em, `${prefix}-b-${suffix}`);

  const product = em.create(Product, {
    sku: `BASKET-${prefix}-${suffix}`,
    slug: `basket-${prefix}-${suffix}`,
    type: 'simple',
    status: 'active',
    name: `Basket probe ${prefix}`,
    description: '',
    visibility: 'public',
    allowedOrganizationIds: [],
    attributeValues: {},
    manageStock: false,
  });
  await em.persistAndFlush(product);

  for (const channel of [a, b]) {
    await em
      .getConnection()
      .execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) ` +
          `on conflict (sales_channel_id, product_id) do nothing`,
        [channel.id, product.id],
      );
  }
  await priceOnChannel(em, {
    code: `basket-${prefix}-a-${suffix}`,
    channelId: a.id,
    productId: product.id,
    amount: PRICE_ON_A,
  });
  await priceOnChannel(em, {
    code: `basket-${prefix}-b-${suffix}`,
    channelId: b.id,
    productId: product.id,
    amount: PRICE_ON_B,
  });

  await addOrganizationChannels(h, TEST_ORGANIZATION_ID, [a.code, b.code]);

  return { a, b, productId: product.id, priceOnA: PRICE_ON_A, priceOnB: PRICE_ON_B };
}

/**
 * Make every product sold on request only on one channel — for signed-in
 * buyers and anonymous visitors alike — through the two channel-scoped
 * settings the display-mode chain ends on. Returns the undo.
 */
export async function quoteOnlyOnChannel(
  h: BackendServerHandle,
  channelId: string,
): Promise<() => Promise<void>> {
  const em = h.em();
  const written: string[] = [];
  for (const code of [
    PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE,
    PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE,
  ]) {
    const setting = await em.findOneOrFail(Setting, { code });
    const value = em.create(SettingValue, {
      setting,
      salesChannel: em.getReference(SalesChannel, channelId),
      value: 'none',
    });
    await em.flush();
    written.push(value.id);
    await h.settings.cache.invalidate(code);
  }
  return async () => {
    await h.em().nativeDelete(SettingValue, { id: { $in: written } });
    for (const code of [
      PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE,
      PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE,
    ]) {
      await h.settings.cache.invalidate(code);
    }
  };
}
