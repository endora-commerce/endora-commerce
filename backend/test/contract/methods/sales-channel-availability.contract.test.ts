import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

/**
 * In which sales channels a delivery or payment method is offered.
 *
 * ## What was true before, and is asserted here to have changed
 *
 * Both admin `PUT` routes stored a channel assignment and both admin lists
 * returned it, but neither storefront catalogue read it: `GET
 * /api/v1/delivery-methods` and `GET /api/v1/payment-methods` filtered on
 * status, the Organization allow-list and the adapter, and listed every such
 * method on every channel. An assignment changed nothing a buyer saw.
 *
 * ## The rule
 *
 * A membership is a **restriction**. A method bound to one or more channels is
 * listed on exactly those; a method bound to **none** is listed on every
 * channel. The second half is not a convenience: the harness's own seeded
 * methods — like a fresh instance's, and like the demo's — have no membership
 * row at all, and they must go on being offered.
 *
 * The two modules are twins, so every case runs against both. The cases are
 * written against the HTTP surface on purpose: the channel is resolved by the
 * real middleware from `X-Sales-Channel`, which is what a storefront sends.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

interface Kind {
  readonly name: 'delivery' | 'payment';
  readonly adminPath: string;
  readonly publicPath: string;
  readonly seededMethodId: string;
  /** A valid upsert body for this kind, without `salesChannelIds`. */
  body(code: string): Record<string, unknown>;
}

const KINDS: readonly Kind[] = [
  {
    name: 'delivery',
    adminPath: '/api/v1/admin/delivery-methods',
    publicPath: '/api/v1/delivery-methods',
    seededMethodId: SEED_DELIVERY_METHOD_ID,
    body: (code) => ({
      code,
      name: { 'en-US': code },
      cost: 10,
      currency: 'PLN',
      adapter: 'manual_courier',
    }),
  },
  {
    name: 'payment',
    adminPath: '/api/v1/admin/payment-methods',
    publicPath: '/api/v1/payment-methods',
    seededMethodId: SEED_PAYMENT_METHOD_ID,
    body: (code) => ({
      code,
      name: { 'en-US': code },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
    }),
  },
];

describe.each(KINDS)('$name methods — sales-channel availability', (kind) => {
  let h: BackendServerHandle;
  let channelA: { id: string; code: string };
  let channelB: { id: string; code: string };

  beforeAll(async () => {
    h = await setupBackendServer();

    // Channel A is the system default, so a request with no channel signal
    // resolves it — the same thing a single-channel shop's storefront does.
    const systemDefault = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channelA = { id: systemDefault.id, code: systemDefault.code };

    const code = `avail-${kind.name}-b`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: ADMIN,
      payload: {
        code,
        name: { 'en-US': `Availability ${kind.name} B` },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
      },
    });
    expect(created.statusCode).toBe(201);
    channelB = { id: (created.json() as { id: string }).id, code };
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function upsert(
    code: string,
    salesChannelIds?: string[],
  ): Promise<{ id: string; salesChannelIds: string[] }> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `${kind.adminPath}/${code}`,
      cookies: ADMIN,
      payload: {
        ...kind.body(code),
        ...(salesChannelIds === undefined ? {} : { salesChannelIds }),
      },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { id: string; salesChannelIds: string[] } }).data;
  }

  /** The ids the storefront catalogue lists on `channelCode` (none ⇒ no signal ⇒ default). */
  async function listedOn(channelCode?: string): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: kind.publicPath,
      ...(channelCode ? { headers: { 'x-sales-channel': channelCode } } : {}),
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Array<{ id: string }> }).data.map((m) => m.id);
  }

  async function adminChannelsOf(id: string): Promise<string[]> {
    const res = await h.app.inject({ method: 'GET', url: kind.adminPath, cookies: ADMIN });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as { data: Array<{ id: string; salesChannelIds: string[] }> }).data.find(
      (m) => m.id === id,
    );
    expect(row).toBeDefined();
    return [...row!.salesChannelIds].sort();
  }

  it('lists a method assigned to channel A on A and not on B', async () => {
    const method = await upsert(`only_a_${kind.name}`, [channelA.id]);

    expect(await listedOn(channelA.code)).toContain(method.id);
    expect(await listedOn()).toContain(method.id);
    expect(await listedOn(channelB.code)).not.toContain(method.id);
  });

  it('lists a method assigned to channel B on B and not on A', async () => {
    const method = await upsert(`only_b_${kind.name}`, [channelB.id]);

    expect(await listedOn(channelB.code)).toContain(method.id);
    expect(await listedOn(channelA.code)).not.toContain(method.id);
    expect(await listedOn()).not.toContain(method.id);
  });

  it('lists a method assigned to both channels on both', async () => {
    const method = await upsert(`both_${kind.name}`, [channelA.id, channelB.id]);

    expect(await listedOn(channelA.code)).toContain(method.id);
    expect(await listedOn(channelB.code)).toContain(method.id);
  });

  it('lists a method with no membership on every channel — an explicit empty selection', async () => {
    const method = await upsert(`everywhere_${kind.name}`, []);

    expect(method.salesChannelIds).toEqual([]);
    expect(await listedOn(channelA.code)).toContain(method.id);
    expect(await listedOn(channelB.code)).toContain(method.id);
  });

  /**
   * The row every existing instance already has: seeded by code, never bound to
   * a channel. The harness seeds its methods exactly that way, which the first
   * assertion pins — if the seed ever starts binding, this case stops being
   * about the membership-less rule and must say so.
   */
  it('keeps listing a seeded method that was never bound to a channel', async () => {
    expect(await adminChannelsOf(kind.seededMethodId)).toEqual([]);

    expect(await listedOn()).toContain(kind.seededMethodId);
    expect(await listedOn(channelA.code)).toContain(kind.seededMethodId);
    expect(await listedOn(channelB.code)).toContain(kind.seededMethodId);
  });

  describe('what `salesChannelIds` on the upsert means', () => {
    it('omitted on create binds the new method to the system-default channel only', async () => {
      const method = await upsert(`omitted_create_${kind.name}`);

      expect(method.salesChannelIds).toEqual([channelA.id]);
      expect(await listedOn(channelB.code)).not.toContain(method.id);
    });

    it('omitted on update leaves the assignment exactly as it was', async () => {
      const code = `omitted_update_${kind.name}`;
      const method = await upsert(code, [channelB.id]);

      const again = await upsert(code);

      expect(again.salesChannelIds).toEqual([channelB.id]);
      expect(await adminChannelsOf(method.id)).toEqual([channelB.id]);
    });

    it('an empty list on update removes every membership, and a list replaces the set', async () => {
      const code = `replace_${kind.name}`;
      const method = await upsert(code, [channelA.id]);
      expect(await listedOn(channelB.code)).not.toContain(method.id);

      // A → every channel.
      expect((await upsert(code, [])).salesChannelIds).toEqual([]);
      expect(await listedOn(channelB.code)).toContain(method.id);

      // Every channel → B only: A's storefront stops listing it.
      expect((await upsert(code, [channelB.id])).salesChannelIds).toEqual([channelB.id]);
      expect(await listedOn(channelA.code)).not.toContain(method.id);
      expect(await listedOn(channelB.code)).toContain(method.id);

      // And the admin list reads back what was written.
      expect(await adminChannelsOf(method.id)).toEqual([channelB.id]);
    });
  });
});
