import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Setting } from '../../../src/modules/settings/entities/setting.entity.js';
import { SettingValue } from '../../../src/modules/settings/entities/setting-value.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

/**
 * T073 — Contract test: storage self-check + state endpoints.
 */

describe('admin storage self-check + state (T073)', () => {
  let h: BackendServerHandle;
  let baseDir: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    baseDir = await mkdtemp(join(tmpdir(), 'assets-library-self-check-'));
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'assets.local.base_dir' });
    const channel = await em.findOneOrFail(SalesChannel, { code: 'default' });
    const existing = await em.findOne(SettingValue, { setting });
    if (existing) existing.value = baseDir;
    else em.create(SettingValue, { setting, salesChannel: channel, value: baseDir });
    await em.flush();
    h.assetsLibrary.adapters.invalidate();
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
    await rm(baseDir, { recursive: true, force: true });
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('self-check returns ok=true for a writable local-FS base dir', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/storage/self-check',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    const out = (r.json() as { data: { adapter: string; ok: boolean } }).data;
    expect(out.adapter).toBe('local');
    expect(out.ok).toBe(true);
  });

  it('state endpoint surfaces active adapter + counts', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/assets/storage/state',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    const out = (
      r.json() as {
        data: {
          activeAdapter: string;
          selfCheck: { ok: boolean };
          pendingCleanupCount: number;
          softDeletedCount: number;
        };
      }
    ).data;
    expect(out.activeAdapter).toBe('local');
    expect(out.selfCheck.ok).toBe(true);
    expect(typeof out.pendingCleanupCount).toBe('number');
    expect(typeof out.softDeletedCount).toBe('number');
  });
});
