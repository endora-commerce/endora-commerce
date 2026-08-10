import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest, ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';

/**
 * T031 — Contract test: optimistic concurrency on PUT /:code/value via
 * `expectedVersion` (matching feature 003 governance pattern); stale →
 * 409 VERSION_CONFLICT.
 */
describe('admin set value — concurrent edit detection (T031)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await new ManifestReconciler(h.em()).apply([
      defineModuleSettingsManifest({
        moduleCode: 'us2_test_conflict',
        groups: [],
        settings: [
          {
            code: 'us2_conflict.knob',
            name: 'Knob',
            valueType: 'string',
            defaultValue: 'init',
          },
        ],
      }),
    ]);
  });

  afterAll(async () => {
    const em = h.em();
    for (const s of await em.find(Setting, { ownerModule: 'us2_test_conflict' })) em.remove(s);
    await em.flush();
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  beforeEach(async () => {
    const em = h.em();
    const settings = await em.find(Setting, { ownerModule: 'us2_test_conflict' });
    for (const s of settings) {
      const values = await em.find(SettingValue, { setting: s });
      for (const v of values) em.remove(v);
    }
    await em.flush();
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('rejects a stale expectedVersion with 409 VERSION_CONFLICT', async () => {
    // Read the initial version.
    const get1 = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/us2_conflict.knob',
      cookies: adminCookie,
    });
    const staleEtag = (get1.headers.etag as string).replace(/^"|"$/g, '');

    // First write succeeds.
    const w1 = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/us2_conflict.knob/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: 'first', expectedVersion: staleEtag },
    });
    expect(w1.statusCode).toBe(200);

    // Second write reuses the now-stale version.
    const w2 = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/us2_conflict.knob/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: 'second', expectedVersion: staleEtag },
    });
    expect(w2.statusCode).toBe(409);
    const body = w2.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.VERSION_CONFLICT);
  });

  it('accepts a fresh expectedVersion via If-Match header', async () => {
    const get1 = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/us2_conflict.knob',
      cookies: adminCookie,
    });
    const etag = get1.headers.etag as string;
    const r = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/us2_conflict.knob/value',
      cookies: adminCookie,
      headers: { 'if-match': etag },
      payload: { scope: 'all', value: 'fresh' },
    });
    expect(r.statusCode).toBe(200);
  });
});
