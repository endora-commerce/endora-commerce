import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LINKEDIN_ADS_SETTING_CODES,
  linkedInConversionMappingSchema,
  linkedInStorefrontConfigSchema,
} from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

const C = LINKEDIN_ADS_SETTING_CODES;

/**
 * Contract coverage for the LinkedIn Ads module (feature 063):
 *   - storefront GET /config shape + the kill switch (US1/US2, T008)
 *   - admin conversion-mapping CRUD incl. the optimistic-version 409 (US3, T019)
 */
describe('LinkedIn Ads module — admin + storefront', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const channelHeader = { 'x-sales-channel': 'default' };
  const actor = { actorAdminUserId: null };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, false, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.PARTNER_ID, '', null, actor);
    await teardownBackendServer(h);
  });

  it('serves a disabled config while the module is switched off', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/linkedin-ads/config',
      headers: channelHeader,
    });
    expect(res.statusCode).toBe(200);
    const config = linkedInStorefrontConfigSchema.parse(res.json().data);
    expect(config.enabled).toBe(false);
    expect(config.partnerId).toBeNull();
  });

  it('stays disabled when enabled is on but the partner id is blank', async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, true, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.PARTNER_ID, '   ', null, actor);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/linkedin-ads/config',
      headers: channelHeader,
    });
    const config = linkedInStorefrontConfigSchema.parse(res.json().data);
    expect(config.enabled).toBe(false);
    expect(config.partnerId).toBeNull();
  });

  it('reports the partner id once one is configured, and never the access token', async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, true, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.PARTNER_ID, '1234567', null, actor);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/linkedin-ads/config',
      headers: channelHeader,
    });
    const body = res.json().data;
    const config = linkedInStorefrontConfigSchema.parse(body);
    expect(config.enabled).toBe(true);
    expect(config.partnerId).toBe('1234567');
    expect(JSON.stringify(body)).not.toContain('access_token');
  });

  it('runs mapping CRUD and rejects a stale version with 409', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/linkedin-ads/conversion-mappings',
      cookies: adminCookie,
      payload: { triggerAction: 'purchase', conversionId: '9876543' },
    });
    expect(created.statusCode).toBe(201);
    const mapping = linkedInConversionMappingSchema.parse(created.json().data);
    expect(mapping.salesChannelId).toBeNull();
    expect(mapping.enabled).toBe(true);

    const listed = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/linkedin-ads/conversion-mappings',
      cookies: adminCookie,
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json().data as unknown[]).length).toBeGreaterThan(0);

    const updated = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/linkedin-ads/conversion-mappings/${mapping.id}`,
      cookies: adminCookie,
      payload: { enabled: false, version: mapping.version },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.enabled).toBe(false);

    // Replaying the original version must not silently clobber the update.
    const stale = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/linkedin-ads/conversion-mappings/${mapping.id}`,
      cookies: adminCookie,
      payload: { enabled: true, version: mapping.version },
    });
    expect(stale.statusCode).toBe(409);

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/linkedin-ads/conversion-mappings/${mapping.id}`,
      cookies: adminCookie,
    });
    expect(removed.statusCode).toBe(204);
  });

  it('omits a disabled mapping from the storefront config', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/linkedin-ads/conversion-mappings',
      cookies: adminCookie,
      payload: { triggerAction: 'add_to_cart', conversionId: '111', enabled: false },
    });
    const mapping = linkedInConversionMappingSchema.parse(created.json().data);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/linkedin-ads/config',
      headers: channelHeader,
    });
    const config = linkedInStorefrontConfigSchema.parse(res.json().data);
    expect(config.conversionMappings.some((m) => m.conversionId === '111')).toBe(false);

    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/linkedin-ads/conversion-mappings/${mapping.id}`,
      cookies: adminCookie,
    });
  });
});
