import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  gaStorefrontConfigSchema,
  gaCustomEventResponseSchema,
  GOOGLE_ANALYTICS_SETTING_CODES,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

const C = GOOGLE_ANALYTICS_SETTING_CODES;
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

/**
 * Contract coverage for the Google Analytics module (feature 049):
 *   - storefront GET /config schema + per-channel resolution (US1, T010)
 *   - admin custom-events CRUD (US3, T028)
 *   - storefront POST /collect producer (US4, T043)
 */
describe('Google Analytics module — admin + storefront', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const channelHeader = { 'x-sales-channel': 'default' };
  const actor = { actorAdminUserId: null };
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      originalSecretKey ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
  });

  afterAll(async () => {
    // Restore module settings to defaults.
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, false, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.MEASUREMENT_ID, '', null, actor);
    await teardownBackendServer(h);
    if (originalSecretKey === undefined) delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
    else process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = originalSecretKey;
  });

  it('GET /config returns a valid, disabled config for an untracked channel', async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, false, null, actor);
    await settle();
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/google-analytics/config',
      headers: channelHeader,
    });
    expect(res.statusCode).toBe(200);
    const parsed = gaStorefrontConfigSchema.safeParse(res.json().data);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.enabled).toBe(false);
  });

  it('GET /config reflects enabled + Measurement ID', async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, true, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.MEASUREMENT_ID, 'G-CONTRACT', null, actor);
    await settle();
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/google-analytics/config',
      headers: channelHeader,
    });
    const data = res.json().data;
    expect(data.enabled).toBe(true);
    expect(data.measurementId).toBe('G-CONTRACT');
  });

  it('admin custom-events CRUD lifecycle', async () => {
    // Create
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/google-analytics/custom-events',
      cookies: adminCookie,
      payload: {
        eventName: 'contract_add_cart',
        triggerAction: 'add_to_cart',
        enabled: true,
        fields: [{ fieldKey: 'sku', position: 0 }],
      },
    });
    expect(create.statusCode).toBe(201);
    const created = gaCustomEventResponseSchema.parse(create.json().data);

    // List
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/google-analytics/custom-events',
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json().data as unknown[]).some((e) => (e as { id: string }).id === created.id)).toBe(
      true,
    );

    // Surfaced in the storefront config (enabled, all-channels)
    await settle();
    const cfg = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/google-analytics/config',
      headers: channelHeader,
    });
    expect(
      (cfg.json().data.customEvents as Array<{ eventName: string }>).some(
        (e) => e.eventName === 'contract_add_cart',
      ),
    ).toBe(true);

    // Update (optimistic version)
    const update = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/google-analytics/custom-events/${created.id}`,
      cookies: adminCookie,
      payload: { enabled: false, version: created.version },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.enabled).toBe(false);

    // Delete
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/google-analytics/custom-events/${created.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });

  it('rejects a button field on a non-button action (schema refine)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/google-analytics/custom-events',
      cookies: adminCookie,
      payload: {
        eventName: 'bad_event',
        triggerAction: 'add_to_cart',
        buttonId: 'checkout-btn',
        fields: [],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /collect accepts a valid batch and rejects an empty one', async () => {
    const ok = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/google-analytics/collect',
      headers: channelHeader,
      payload: {
        clientId: '123.456',
        consent: { analyticsStorage: 'granted' },
        events: [{ name: 'page_view', params: { page_path: '/' } }],
      },
    });
    // 202 when queue-backed; 503 only if Redis is unavailable in this env.
    expect([202, 503]).toContain(ok.statusCode);

    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/google-analytics/collect',
      headers: channelHeader,
      payload: { clientId: 'x', consent: { analyticsStorage: 'granted' }, events: [] },
    });
    expect([400, 503]).toContain(bad.statusCode);
  });
});
