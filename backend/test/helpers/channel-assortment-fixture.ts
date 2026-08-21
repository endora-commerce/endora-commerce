import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '../../src/kernel/sales-channels/sales-channel.entity.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_101_SKU,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_102_SKU,
} from './seed-catalog.js';

/**
 * One channel that sells one of the seeded products and not the other — the
 * fixture every acquisition-seam test for issue #259 is written against.
 *
 * ## Why the pair, rather than a channel that sells nothing
 *
 * A gate that refuses **everything** passes "the withheld product is refused",
 * and that is the failure mode a channel filter actually has: it is one wrong
 * argument away from narrowing against a channel nobody is on. So every case
 * comes in two halves on the **same** channel and the **same** request shape —
 * {@link ChannelAssortment.soldHereId} must go through, and
 * {@link ChannelAssortment.notSoldHereId} must not. The withheld product is a
 * live, `public`, active row that another channel does sell, so the only thing
 * separating the two answers is the bridge row.
 *
 * ## Why it is a fresh channel per suite
 *
 * `sales_channels` and `sales_channel_products` are both in the harness's
 * `SEEDED_TABLES`, so the seed is rebuilt per file and nothing leaks between
 * files. The random code is for the files that run in one composition: a
 * channel this suite created cannot be one another suite is asserting over.
 */
export interface ChannelAssortment {
  /** `X-Sales-Channel` value for the probe channel. */
  readonly code: string;
  readonly id: string;
  /** Published on this channel — the positive half of every case. */
  readonly soldHereId: string;
  readonly soldHereSku: string;
  /** Published on `pl_retail`, deliberately not on this channel. */
  readonly notSoldHereId: string;
  readonly notSoldHereSku: string;
}

/**
 * Create the probe channel and publish `SEED_PRODUCT_102` on it.
 *
 * The bridge row is written with SQL rather than through
 * `SalesChannelMembershipService` on purpose: the service audits and emits, and
 * a fixture that produces audit rows is a fixture the audit assertions in the
 * same composition have to know about. `seed-catalog.ts` writes the other six
 * memberships the same way, so this is the seeder's own idiom rather than a
 * second one.
 */
export async function seedProbeChannelAssortment(
  em: EntityManager,
  prefix: string,
): Promise<ChannelAssortment> {
  const code = `${prefix}-${randomUUID().slice(0, 8)}`;
  const channel = em.create(SalesChannel, {
    code,
    name: { 'en-US': `Assortment probe ${code}` },
    languages: ['en-US'],
    defaultLanguage: 'en-US',
    currencies: ['PLN'],
    defaultCurrency: 'PLN',
    active: true,
    isPublic: true,
  });
  await em.persistAndFlush(channel);

  await em
    .getConnection()
    .execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?) ` +
        `on conflict (sales_channel_id, product_id) do nothing`,
      [channel.id, SEED_PRODUCT_102_ID],
    );

  return {
    code,
    id: channel.id,
    soldHereId: SEED_PRODUCT_102_ID,
    soldHereSku: SEED_PRODUCT_102_SKU,
    notSoldHereId: SEED_PRODUCT_101_ID,
    notSoldHereSku: SEED_PRODUCT_101_SKU,
  };
}
