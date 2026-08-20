import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Issue #101 — the dictionary registry cache and the default channel.
 *
 * `DictionaryReadService.resolveContext` resolved the channel by the
 * `system_default` flag (correct) and then keyed the cache entry
 * `args.channelCode ?? 'default'` — a literal, not the channel it had just
 * resolved. Two consequences, both of them served to storefronts for up to the
 * hour the entry lives:
 *
 *   1. an operator PATCHing the default channel's languages or currencies got
 *      the old registry, because the module subscribed to no `sales_channels.*`
 *      event and nothing dropped the entry;
 *   2. after the D-51 flag move, the entry keyed `'default'` served the
 *      *previous* default channel's registry under the new one's name.
 *
 * The key is the resolved channel's id now (`__global__` for the platform-wide
 * tier, matching the settings cache's reserved segment), and the module drops
 * its own cache when a channel changes identity or lifecycle.
 */
describe('dictionary registry cache — keyed by channel identity (issue #101)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await restoreDefaultChannel();
    await teardownBackendServer(h);
  });

  /** Demote whatever holds the flag, then give it back to `default` — in that order. */
  async function restoreDefaultChannel(): Promise<void> {
    const conn = h.em().getConnection();
    await conn.execute(
      `update "sales_channels" set "system_default" = false ` +
        `where "system_default" = true and "code" <> 'default'`,
      [],
      'run',
    );
    await conn.execute(
      `update "sales_channels" set "system_default" = true, "currencies" = '["PLN"]', ` +
        `"default_currency" = 'PLN' where "code" = 'default'`,
      [],
      'run',
    );
    await h.salesChannels.cache.invalidateAll();
  }

  beforeEach(async () => {
    await restoreDefaultChannel();
    const em = h.em();
    for (const c of await em.find(SalesChannel, { systemDefault: false }, { refresh: true })) {
      em.remove(c);
    }
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
    await h.redis.flushdb();
  });

  async function registryCurrencies(): Promise<string[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/dictionary?locale=en-US' });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { currencies: Array<{ code: string }> } }).data.currencies.map(
      (c) => c.code,
    );
  }

  async function createChannel(code: string, currency: string): Promise<string> {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code,
        name: { 'en-US': code },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: [currency],
        defaultCurrency: currency,
        active: true,
      },
    });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }

  it('keys the entry by the resolved channel id, not the literal "default"', async () => {
    expect(await registryCurrencies()).toEqual(['PLN']);

    const defaultChannel = await h.em().findOne(SalesChannel, { systemDefault: true });
    expect(defaultChannel).not.toBeNull();
    expect(await h.redis.exists(`dictionary:registry:v1:${defaultChannel!.id}:en-US`)).toBe(1);
    expect(await h.redis.exists('dictionary:registry:v1:default:en-US')).toBe(0);
  });

  it('does not serve the previous default’s registry after the flag moves', async () => {
    // Warm the entry for the current default (PLN only).
    expect(await registryCurrencies()).toEqual(['PLN']);

    await createChannel('dict-alt', 'EUR');
    const moved = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels/dict-alt/set-default',
      cookies: adminCookie,
      payload: {},
    });
    expect(moved.statusCode).toBe(200);
    // The Command's event dispatches after commit.
    await new Promise((resolve) => setImmediate(resolve));

    expect(await registryCurrencies()).toEqual(['EUR']);
  });

  it('drops the entry when the default channel’s currencies are patched', async () => {
    expect(await registryCurrencies()).toEqual(['PLN']);

    const detail = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels/default',
      cookies: adminCookie,
    });
    expect(detail.statusCode).toBe(200);

    const patch = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/sales-channels/default',
      cookies: adminCookie,
      payload: {
        expectedVersion: (detail.json() as { version: number }).version,
        currencies: ['PLN', 'EUR'],
      },
    });
    expect(patch.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));

    expect((await registryCurrencies()).sort()).toEqual(['EUR', 'PLN']);
  });
});
