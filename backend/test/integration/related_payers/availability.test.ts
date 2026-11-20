import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relatedPayersAvailabilityResponseSchema } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { systemDefaultSalesChannel } from '../../helpers/sales-channel-fixtures.js';
import { ADMIN, makeOrganizationWithAdmin, setSetting } from './fixtures.js';

/**
 * `specs/182-related-payers/` FR-002 — the storefront asks whether the capability is on for the
 * request's channel before it offers *Payers* or *Orders we pay for*. Off on the channel (a
 * channel override over a global `true`), the account routes answer `404` and this read answers
 * `enabled: false`, so the account shows neither entry nor a form that can only fail. The
 * module-off case is in `off-state.test.ts` (`503 MODULE_DISABLED`).
 */
describe('related_payers — availability on the request\'s channel (FR-002)', () => {
  let h: BackendServerHandle;
  let x: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  let channelCode: string;

  const availability = async (cookies?: Record<string, string>) =>
    h.app.inject({ method: 'GET', url: '/api/v1/related-payers/availability', ...(cookies ? { cookies } : {}) });
  const overrideOnChannel = async (value: boolean) => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.enabled/value',
      cookies: ADMIN,
      payload: { scope: 'subset', salesChannelCodes: [channelCode], value },
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    channelCode = (await systemDefaultSalesChannel(h.em())).code;
    await setSetting(h, 'related_payers.enabled', true);
    x = await makeOrganizationWithAdmin(h.em(), 'Availability buyer');
  }, 120_000);

  afterAll(async () => {
    await setSetting(h, 'related_payers.enabled', true);
    await teardownBackendServer(h);
  });

  it('answers enabled while the capability is on for the channel', async () => {
    const res = await availability(x.cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(relatedPayersAvailabilityResponseSchema.parse(res.json())).toEqual({ data: { enabled: true } });
  });

  it('answers disabled where the channel overrides it off — the account routes answer 404 alike', async () => {
    await overrideOnChannel(false);
    try {
      const res = await availability(x.cookie);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({ data: { enabled: false } });
      const list = await h.app.inject({ method: 'GET', url: '/api/v1/account/related-payers', cookies: x.cookie });
      expect(list.statusCode, list.body).toBe(404);
    } finally {
      await overrideOnChannel(true);
    }
    expect((await availability(x.cookie)).json()).toEqual({ data: { enabled: true } });
  });

  it('is a customer read: signed out, it is refused', async () => {
    expect((await availability()).statusCode).toBe(401);
  });
});
