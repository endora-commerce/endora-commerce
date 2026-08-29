import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  META_ADS_SETTING_CODES,
  metaCustomEventMappingSchema,
  metaStorefrontConfigSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

const C = META_ADS_SETTING_CODES;

/**
 * Contract coverage for the Meta Ads module (feature 064):
 *   - storefront GET /config shape + the kill switch (US1/US2)
 *   - admin custom-event CRUD incl. the optimistic-version 409 (US4)
 */
describe('Meta Ads module — admin + storefront', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const channelHeader = { 'x-sales-channel': 'default' };
  const actor = { actorAdminUserId: null };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, false, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.PIXEL_ID, '', null, actor);
    await teardownBackendServer(h);
  });

  it('serves a disabled config while the module is switched off', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/meta-ads/config',
      headers: channelHeader,
    });
    expect(res.statusCode).toBe(200);
    const config = metaStorefrontConfigSchema.parse(res.json().data);
    expect(config.enabled).toBe(false);
    expect(config.pixelId).toBeNull();
  });

  it('stays disabled when enabled is on but the pixel id is blank', async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, true, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.PIXEL_ID, '   ', null, actor);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/meta-ads/config',
      headers: channelHeader,
    });
    const config = metaStorefrontConfigSchema.parse(res.json().data);
    expect(config.enabled).toBe(false);
  });

  it('reports the pixel id once one is configured', async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, true, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.PIXEL_ID, '9876543210', null, actor);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/meta-ads/config',
      headers: channelHeader,
    });
    const config = metaStorefrontConfigSchema.parse(res.json().data);
    expect(config.enabled).toBe(true);
    expect(config.pixelId).toBe('9876543210');
  });

  it('runs custom-event CRUD and rejects a stale version with 409', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/meta-ads/custom-events',
      cookies: adminCookie,
      payload: { triggerAction: 'add_to_quote_request', eventName: 'SubmitQuote' },
    });
    expect(created.statusCode).toBe(201);
    const mapping = metaCustomEventMappingSchema.parse(created.json().data);
    expect(mapping.salesChannelId).toBeNull();

    const updated = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/meta-ads/custom-events/${mapping.id}`,
      cookies: adminCookie,
      payload: { enabled: false, version: mapping.version },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.enabled).toBe(false);

    const stale = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/meta-ads/custom-events/${mapping.id}`,
      cookies: adminCookie,
      payload: { enabled: true, version: mapping.version },
    });
    expect(stale.statusCode).toBe(409);

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/meta-ads/custom-events/${mapping.id}`,
      cookies: adminCookie,
    });
    expect(removed.statusCode).toBe(204);
  });

  it('serves an enabled custom event to the storefront and omits a disabled one', async () => {
    const on = metaCustomEventMappingSchema.parse(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/meta-ads/custom-events',
          cookies: adminCookie,
          payload: { triggerAction: 'purchase', eventName: 'BigOrder' },
        })
      ).json().data,
    );
    const off = metaCustomEventMappingSchema.parse(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/meta-ads/custom-events',
          cookies: adminCookie,
          payload: { triggerAction: 'add_to_cart', eventName: 'Carted', enabled: false },
        })
      ).json().data,
    );

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/meta-ads/config',
      headers: channelHeader,
    });
    const config = metaStorefrontConfigSchema.parse(res.json().data);
    expect(config.customEvents.some((m) => m.eventName === 'BigOrder')).toBe(true);
    expect(config.customEvents.some((m) => m.eventName === 'Carted')).toBe(false);

    for (const id of [on.id, off.id]) {
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/meta-ads/custom-events/${id}`,
        cookies: adminCookie,
      });
    }
  });
});
