import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('catalogue module filter (US3)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting([]);
    h.permissionCatalogueService.invalidate();
    await teardownBackendServer(h);
  });

  it('omits cms permissions when cms is not in the enabled set', async () => {
    const enabledWithoutCms = REGISTERED_MANIFESTS.map((e) => e.manifest.id).filter(
      (id) => id !== 'cms',
    );
    registryCache.__setEnabledForTesting(enabledWithoutCms);
    h.permissionCatalogueService.invalidate();

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/permissions',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const codes = (res.json() as { data: Array<{ code: string }> }).data.map((r) => r.code);
    expect(codes).not.toContain('cms.read');
    expect(codes).not.toContain('cms.write');
    expect(codes).toContain('settings:read');
  });
});
