import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GOOGLE_TAG_MANAGER_SETTING_CODES,
  gtmStorefrontConfigSchema,
} from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

const C = GOOGLE_TAG_MANAGER_SETTING_CODES;

/**
 * Contract coverage for the Google Tag Manager storefront config route
 * (feature 066, US1). The server container address is backend-only — the
 * public read must never leak it.
 */
describe('Google Tag Manager module — storefront config', () => {
  let h: BackendServerHandle;
  const channelHeader = { 'x-sales-channel': 'default' };
  const actor = { actorAdminUserId: null };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, false, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.CONTAINER_ID, '', null, actor);
    await h.settings.adminService.setValueForAllChannels(C.SERVER_SIDE_ENABLED, false, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.SERVER_CONTAINER_URL, '', null, actor);
    await teardownBackendServer(h);
  });

  it('serves the disabled shape for an unconfigured channel', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/google-tag-manager/config',
      headers: channelHeader,
    });
    expect(res.statusCode).toBe(200);
    const config = gtmStorefrontConfigSchema.parse(res.json().data);
    expect(config).toEqual({
      enabled: false,
      containerId: null,
      requireConsent: true,
      serverSide: false,
    });
  });

  it('stays disabled while the container id is blank', async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, true, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.CONTAINER_ID, '   ', null, actor);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/google-tag-manager/config',
      headers: channelHeader,
    });
    expect(gtmStorefrontConfigSchema.parse(res.json().data).enabled).toBe(false);
  });

  it('reports the tracked shape once a container id is configured', async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, true, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.CONTAINER_ID, 'GTM-ABC1234', null, actor);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/google-tag-manager/config',
      headers: channelHeader,
    });
    const config = gtmStorefrontConfigSchema.parse(res.json().data);
    expect(config.enabled).toBe(true);
    expect(config.containerId).toBe('GTM-ABC1234');
  });

  it('never exposes the server container address or its ingest path', async () => {
    await h.settings.adminService.setValueForAllChannels(C.ENABLED, true, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.CONTAINER_ID, 'GTM-ABC1234', null, actor);
    await h.settings.adminService.setValueForAllChannels(C.SERVER_SIDE_ENABLED, true, null, actor);
    await h.settings.adminService.setValueForAllChannels(
      C.SERVER_CONTAINER_URL,
      'https://sgtm.example.test',
      null,
      actor,
    );

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/google-tag-manager/config',
      headers: channelHeader,
    });
    const config = gtmStorefrontConfigSchema.parse(res.json().data);
    expect(config.serverSide).toBe(true);
    expect(Object.keys(res.json().data as Record<string, unknown>).sort()).toEqual([
      'containerId',
      'enabled',
      'requireConsent',
      'serverSide',
    ]);
    expect(res.payload).not.toContain('sgtm.example.test');
    expect(res.payload).not.toContain('/data');
  });

  it('answers 503 while the module is disabled in the lifecycle registry', async () => {
    const allIds = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
    registryCache.__setEnabledForTesting(allIds.filter((id) => id !== 'google_tag_manager'));
    try {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/storefront/google-tag-manager/config',
        headers: channelHeader,
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('MODULE_DISABLED');
      expect(res.headers['retry-after']).toBe('60');
    } finally {
      registryCache.__setEnabledForTesting(allIds);
    }
  });
});
