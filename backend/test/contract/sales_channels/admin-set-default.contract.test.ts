import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, SalesChannelSetDefaultResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * D-50 + D-51 — the two halves of the product owner's ruling, over HTTP.
 *
 * D-50: a channel's code is set at creation and immutable afterwards, on **every**
 * channel and not only the system default. The admin form has always locked the
 * field; this pins the refusal in the API, which is where the guarantee has to
 * live for the channel cache (an identity change carries only the new code, so a
 * rename would leave the old key resolving until its TTL expired) and for
 * `SALES_CHANNEL_HOST_MAP`, which names codes in deployment configuration.
 *
 * D-51: the flag is movable. That is what makes "fix a mistyped code by creating
 * the channel again and deleting the old one" work for the *default* channel too,
 * since the default channel cannot be deleted while it holds the flag.
 *
 * The harness seeds `default` as the system default (`test-server.ts:685`), and
 * these cases move the flag off it for real, so `beforeEach` puts it back before
 * clearing the scratch channels — in that order, because deleting the row that
 * currently holds the flag is exactly what the platform refuses.
 */
describe('admin sales-channels set-default + code immutability (D-50/D-51)', () => {
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
    const em = h.em();
    const conn = em.getConnection();
    await conn.execute(
      `update "sales_channels" set "system_default" = false ` +
        `where "system_default" = true and "code" <> 'default'`,
      [],
      'run',
    );
    await conn.execute(
      `update "sales_channels" set "system_default" = true where "code" = 'default'`,
      [],
      'run',
    );
  }

  beforeEach(async () => {
    await restoreDefaultChannel();
    const em = h.em();
    for (const c of await em.find(SalesChannel, { systemDefault: false }, { refresh: true })) {
      em.remove(c);
    }
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  });

  async function createChannel(code: string, active = true): Promise<string> {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code,
        name: { 'en-US': code },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active,
      },
    });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }

  async function setDefault(code: string) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/sales-channels/${code}/set-default`,
      cookies: adminCookie,
      payload: {},
    });
  }

  // -- D-50: the code is immutable -----------------------------------------

  it('PATCH refuses a code change on an ordinary channel → SALES_CHANNEL_CODE_IMMUTABLE', async () => {
    await createChannel('immutable-a');
    const r = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/sales-channels/immutable-a',
      cookies: adminCookie,
      payload: { expectedVersion: 1, code: 'immutable-b' },
    });
    expect(r.statusCode).toBe(422);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.SALES_CHANNEL_CODE_IMMUTABLE,
    );

    // The refusal is a refusal: nothing was written, not even the version bump.
    const detail = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels/immutable-a',
      cookies: adminCookie,
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { version: number }).version).toBe(1);
  });

  it('PATCH refuses a code change on the system-default channel too', async () => {
    const r = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/sales-channels/default',
      cookies: adminCookie,
      payload: { expectedVersion: currentVersion(await detailOf('default')), code: 'renamed' },
    });
    expect(r.statusCode).toBe(422);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.SALES_CHANNEL_CODE_IMMUTABLE,
    );
    const still = await detailOf('default');
    expect(still['code']).toBe('default');
  });

  it('PATCH accepts the channel’s own code, and keeps editing the name', async () => {
    await createChannel('immutable-same');
    const r = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/sales-channels/immutable-same',
      cookies: adminCookie,
      payload: {
        expectedVersion: 1,
        code: 'immutable-same',
        name: { 'en-US': 'Renamed but not recoded' },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body['code']).toBe('immutable-same');
    expect((body['name'] as Record<string, string>)['en-US']).toBe('Renamed but not recoded');
  });

  // -- D-51: the flag moves -------------------------------------------------

  it('POST /:code/set-default demotes the old default and promotes the target', async () => {
    const targetId = await createChannel('shop-b');

    const r = await setDefault('shop-b');
    expect(r.statusCode).toBe(200);
    const body = SalesChannelSetDefaultResponseSchema.parse(r.json());
    expect(body.changed).toBe(true);
    expect(body.previousDefaultCode).toBe('default');
    expect(body.channel.code).toBe('shop-b');
    expect(body.channel.systemDefault).toBe(true);

    // Exactly one default afterwards, and it is the target.
    const em = h.em();
    const defaults = await em.find(SalesChannel, { systemDefault: true }, { refresh: true });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(targetId);

    // The old default is readable and demoted, not deleted or deactivated.
    const old = await detailOf('default');
    expect(old['systemDefault']).toBe(false);
    expect(old['active']).toBe(true);
  });

  it('records one audit row for the move, naming both channels', async () => {
    const targetId = await createChannel('shop-audit');
    const r = await setDefault('shop-audit');
    expect(r.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, {
      action: 'sales_channel.set_default',
      objectId: targetId,
    });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.stateBefore as { code?: string } | null)?.code).toBe('default');
    expect((rows[0]!.stateAfter as { code?: string } | null)?.code).toBe('shop-audit');
  });

  it('promoting the channel that is already the default is a no-op success', async () => {
    const r = await setDefault('default');
    expect(r.statusCode).toBe(200);
    const body = SalesChannelSetDefaultResponseSchema.parse(r.json());
    expect(body.changed).toBe(false);
    expect(body.previousDefaultCode).toBe('default');
    expect(body.channel.code).toBe('default');
    expect(body.channel.systemDefault).toBe(true);

    // A no-op writes nothing, so it leaves no audit row behind either.
    const rows = await h.em().find(AuditLogEntry, {
      action: 'sales_channel.set_default',
      objectId: body.channel.id,
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses an inactive target → INACTIVE_SALES_CHANNEL', async () => {
    await createChannel('shop-off', false);
    const r = await setDefault('shop-off');
    expect(r.statusCode).toBe(422);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.INACTIVE_SALES_CHANNEL,
    );
    const defaults = await h.em().find(SalesChannel, { systemDefault: true }, { refresh: true });
    expect(defaults.map((c) => c.code)).toEqual(['default']);
  });

  it('refuses an unknown code → 404', async () => {
    const r = await setDefault('no-such-channel');
    expect(r.statusCode).toBe(404);
  });

  it('requires an admin session', async () => {
    await createChannel('shop-anon');
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels/shop-anon/set-default',
      payload: {},
    });
    expect(r.statusCode).toBe(401);
  });

  it('the resolver stops calling the demoted channel the default', async () => {
    await createChannel('shop-cache');
    // Warm both entries in the two-layer channel cache.
    expect((await h.salesChannels.resolver.getByCode('default'))?.systemDefault).toBe(true);
    expect((await h.salesChannels.resolver.getByCode('shop-cache'))?.systemDefault).toBe(false);

    expect((await setDefault('shop-cache')).statusCode).toBe(200);
    // The event dispatches after commit; let the invalidator's handler run.
    await new Promise((resolve) => setImmediate(resolve));

    expect((await h.salesChannels.resolver.getByCode('default'))?.systemDefault).toBe(false);
    expect((await h.salesChannels.resolver.getByCode('shop-cache'))?.systemDefault).toBe(true);
    expect((await h.salesChannels.resolver.getSystemDefault()).code).toBe('shop-cache');
  });

  // -- helpers --------------------------------------------------------------

  async function detailOf(code: string): Promise<Record<string, unknown>> {
    const r = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/sales-channels/${code}`,
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    return r.json() as Record<string, unknown>;
  }

  function currentVersion(detail: Record<string, unknown>): number {
    return detail['version'] as number;
  }
});
