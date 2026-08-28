import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);

describe('catalogue module filter (US3)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    // Issue #213 — restored to the seeded set rather than emptied. The registry
    // cache is a process singleton and the suite runs single-fork, so leaving it
    // empty hands the next file a composition in which every module is absent.
    // There is no `invalidate()` to pair it with any more: the catalogue keeps
    // no memo.
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  it('omits cms permissions when cms is not in the enabled set', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'cms'));

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

  /**
   * The same question on the other axis (issue #213). `cms` is still installed
   * and platform-available here; the operator has switched it off. Until the
   * catalogue read `effectiveState`, this case answered with the codes still in
   * the list.
   */
  it('omits cms permissions when cms is installed but deactivated', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['cms'] });

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
