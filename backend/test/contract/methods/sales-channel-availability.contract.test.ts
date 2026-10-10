import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { createDeliveryMethodSeeder } from '@endora-commerce/mod-delivery-methods/install';
import { createPaymentMethodSeeder } from '@endora-commerce/mod-payment-methods/install';
import type { EntityManager } from '@mikro-orm/postgresql';

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
  /**
   * Seeds a method the way a gateway or carrier module's install hook does,
   * through the module's published install surface; answers the row's id.
   */
  seed(em: EntityManager, code: string): Promise<string>;
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
    seed: async (em, code) =>
      (
        await createDeliveryMethodSeeder().ensureMethodForAdapter(em, 'manual_courier', {
          code,
          name: { default: code },
        })
      ).row.id,
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
    seed: async (em, code) =>
      (
        await createPaymentMethodSeeder().ensureMethodForAdapter(em, 'bank_transfer', {
          code,
          type: 'bank_transfer',
          name: { default: code },
        })
      ).row.id,
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

  /**
   * A method a gateway or carrier module seeds is offered on every channel —
   * **whenever** the module is installed. This instance has booted and has a
   * default channel, which is the state in which the seed used to bind the
   * method to that channel alone; it binds nothing now.
   */
  it('lists a method a module seeds on a booted instance on every channel, bound to none', async () => {
    const id = await kind.seed(h.em(), `module_seeded_${kind.name}`);

    expect(await adminChannelsOf(id)).toEqual([]);
    expect(await listedOn(channelA.code)).toContain(id);
    expect(await listedOn(channelB.code)).toContain(id);
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

  /**
   * A channel id that names no channel — one deleted while the form was open,
   * or a mistyped id from an API caller.
   *
   * It used to reach the bridge and fail on its foreign key: a 500, after the
   * method's own row had been committed. For a **new** method that left a row
   * with no membership at all, and no membership means offered on every
   * channel — the widest possible answer to a request that asked for one
   * channel. It is refused before anything is written now.
   */
  describe('a sales channel that does not exist', () => {
    const NO_SUCH_CHANNEL = '00000000-0000-4000-8000-00000000dead';

    async function put(code: string, salesChannelIds: string[]): Promise<{
      statusCode: number;
      body: unknown;
    }> {
      const res = await h.app.inject({
        method: 'PUT',
        url: `${kind.adminPath}/${code}`,
        cookies: ADMIN,
        payload: { ...kind.body(code), salesChannelIds },
      });
      return { statusCode: res.statusCode, body: res.json() };
    }

    async function adminCodes(): Promise<string[]> {
      const res = await h.app.inject({ method: 'GET', url: kind.adminPath, cookies: ADMIN });
      return (res.json() as { data: Array<{ code: string }> }).data.map((m) => m.code);
    }

    function expectFieldError(res: { statusCode: number; body: unknown }): void {
      expect(res.statusCode).toBe(400);
      const error = (res.body as { error: { code: string; details: unknown } }).error;
      expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(error.details).toEqual([{ path: 'salesChannelIds', issue: NO_SUCH_CHANNEL }]);
    }

    it('refuses a create naming one, and creates no method', async () => {
      const code = `unknown_create_${kind.name}`;

      expectFieldError(await put(code, [NO_SUCH_CHANNEL]));

      expect(await adminCodes()).not.toContain(code);
    });

    it('refuses a create naming one beside a real channel, and creates no method', async () => {
      const code = `unknown_mixed_${kind.name}`;

      expectFieldError(await put(code, [channelB.id, NO_SUCH_CHANNEL]));

      expect(await adminCodes()).not.toContain(code);
    });

    it('refuses an update naming one, and leaves the assignment as it was', async () => {
      const code = `unknown_update_${kind.name}`;
      const method = await upsert(code, [channelB.id]);

      expectFieldError(await put(code, [NO_SUCH_CHANNEL]));

      expect(await adminChannelsOf(method.id)).toEqual([channelB.id]);
      expect(await listedOn(channelA.code)).not.toContain(method.id);
    });
  });

  /**
   * Where a method is offered decides how a buyer may ship and pay, and the
   * change is made through the method's own route — so the audit row of every
   * membership it adds or removes has to name the administrator who made it,
   * as the central sales-channel routes already do.
   */
  it('audits every channel change made through the method route with the acting administrator', async () => {
    const code = `audited_${kind.name}`;
    const method = await upsert(code, [channelA.id]);
    await upsert(code, [channelB.id]);
    await upsert(code, []);

    const changes = (
      await h.em().find(AuditLogEntry, { action: SALES_CHANNEL_AUDIT_ACTIONS.MEMBERSHIP_CHANGED })
    )
      .map((entry) => ({
        actor: entry.actorAdminUserId ?? null,
        ...(entry.stateAfter as { entityId: string; channelId: string; op: string }),
      }))
      .filter((change) => change.entityId === method.id);

    // add A; then remove A and add B; then remove B.
    expect(changes.map((c) => `${c.op}:${c.channelId}`).sort()).toEqual(
      [
        `add:${channelA.id}`,
        `remove:${channelA.id}`,
        `add:${channelB.id}`,
        `remove:${channelB.id}`,
      ].sort(),
    );
    expect(changes.map((c) => c.actor)).toEqual(changes.map(() => TEST_ADMIN_ID));
  });

});
