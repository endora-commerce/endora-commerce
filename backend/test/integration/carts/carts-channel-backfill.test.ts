import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Migration20261019T043854CartsChannelBackfill } from '@endora-commerce/mod-carts/migrations';
import { Cart } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `specs/154-sales-channel-access/` M3 (data-model §1) — a basket with no
 * channel is recorded on the system-default channel.
 *
 * A basket is now read by `(owner, channel)`, so a row with no channel is a
 * basket no request reaches. Every basket created before this feature was
 * created on the system default, which makes the default the honest record of
 * where a channel-less one was used. Baskets that already carry a channel keep
 * it, a second run changes nothing, and a row the one-active-basket-per-channel
 * index would refuse is left as it is rather than failing the upgrade. The
 * statements come from the migration class, so a change to the policy shows up
 * here.
 */
describe('carts — channel backfill (M3)', () => {
  let h: BackendServerHandle;
  let defaultId: string;
  let otherId: string;

  async function runMigration(): Promise<void> {
    const em = h.em();
    const migration = new Migration20261019T043854CartsChannelBackfill(em.getDriver(), em.config);
    await migration.up();
    for (const query of migration.getQueries()) {
      await em.execute(query as string);
    }
    em.clear();
  }

  async function channelOf(cartId: string): Promise<string | null> {
    const rows = await h
      .em()
      .execute<Array<{ sales_channel_id: string | null }>>(
        'select "sales_channel_id" from "carts" where "id" = ?',
        [cartId],
      );
    return rows[0]!.sales_channel_id;
  }

  async function basket(input: {
    customerAccountId?: string;
    anonymousCartToken?: string;
    status?: 'active' | 'abandoned' | 'completed';
    salesChannelId?: string | null;
  }): Promise<string> {
    const em = h.em();
    const cart = em.create(Cart, {
      ...(input.customerAccountId
        ? { customerAccountId: input.customerAccountId, organizationId: TEST_ORGANIZATION_ID }
        : {}),
      ...(input.anonymousCartToken ? { anonymousCartToken: input.anonymousCartToken } : {}),
      status: input.status ?? 'active',
      salesChannelId: input.salesChannelId ?? null,
    });
    await em.persist(cart).flush();
    return cart.id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    defaultId = (await em.findOneOrFail(SalesChannel, { systemDefault: true })).id;
    const other = em.create(SalesChannel, {
      code: `backfill-carts-${randomUUID().slice(0, 8)}`,
      name: { 'en-US': 'Backfill carts' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    await em.persist(other).flush();
    otherId = other.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records a customer basket and an anonymous basket with no channel on the system default', async () => {
    // A customer id of its own, so no basket another file left behind is in the way.
    const customer = await basket({ customerAccountId: randomUUID() });
    const anonymous = await basket({ anonymousCartToken: `anon-backfill-${randomUUID()}` });
    const abandoned = await basket({
      anonymousCartToken: `anon-backfill-${randomUUID()}`,
      status: 'abandoned',
    });
    await runMigration();
    expect(await channelOf(customer)).toBe(defaultId);
    expect(await channelOf(anonymous)).toBe(defaultId);
    expect(await channelOf(abandoned)).toBe(defaultId);
  });

  it('keeps the channel a basket already records', async () => {
    const onOther = await basket({ anonymousCartToken: `anon-backfill-${randomUUID()}`, salesChannelId: otherId });
    await runMigration();
    expect(await channelOf(onOther)).toBe(otherId);
  });

  it('changes nothing when run a second time', async () => {
    const cart = await basket({ anonymousCartToken: `anon-backfill-${randomUUID()}` });
    await runMigration();
    await runMigration();
    expect(await channelOf(cart)).toBe(defaultId);
  });

  it('does not fail on a customer who already has an active basket on the system default', async () => {
    const customerAccountId = randomUUID();
    const onDefault = await basket({ customerAccountId, salesChannelId: defaultId });
    const channelless = await basket({ customerAccountId });
    await runMigration();
    expect(await channelOf(onDefault)).toBe(defaultId);
    // The unique index admits one active basket per customer per channel; the
    // second one keeps no channel rather than stopping the upgrade.
    expect(await channelOf(channelless)).toBeNull();
  });

  it('moves only the most recently used of several channel-less active baskets of one customer', async () => {
    const customerAccountId = randomUUID();
    const older = await basket({ customerAccountId });
    const newer = await basket({ customerAccountId });
    await h
      .em()
      .execute(`update "carts" set "last_activity_at" = now() - interval '2 days' where "id" = ?`, [older]);
    await runMigration();
    expect(await channelOf(newer)).toBe(defaultId);
    expect(await channelOf(older)).toBeNull();
  });
});
