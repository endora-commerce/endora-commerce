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
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Asset } from '../../../src/modules/assets_library/entities/asset.entity.js';

/**
 * T036 — Contract test: PATCH /api/v1/admin/assets/{id} (metadata + visibility flip).
 */

const TINY_PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C636400010000000500010D0A2DB40000000049454E44AE426082',
  'hex',
);

function buildMultipart(parts: Array<{ name: string; filename?: string; mime?: string; value: Buffer | string }>): {
  body: Buffer;
  contentType: string;
} {
  const boundary = `----b2bTestBoundary${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (p.filename) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n`,
        ),
      );
      chunks.push(Buffer.from(`Content-Type: ${p.mime ?? 'application/octet-stream'}\r\n\r\n`));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`));
    }
    chunks.push(Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('admin asset mutate (T036)', () => {
  let h: BackendServerHandle;
  let baseDir: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    baseDir = await mkdtemp(join(tmpdir(), 'assets-library-mutate-'));
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

  async function uploadOne(): Promise<{ id: string; storageBackend: string }> {
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'm.png', mime: 'image/png', value: TINY_PNG },
    ]);
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets',
      headers: { 'content-type': contentType },
      cookies: adminCookie,
      payload: body,
    });
    expect(r.statusCode).toBe(201);
    return (r.json() as { data: { id: string; storageBackend: string } }).data;
  }

  it('updates filename + label', async () => {
    const { id } = await uploadOne();
    const r = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/assets/${id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ filename: 'renamed.png', label: 'Hero' }),
    });
    expect(r.statusCode).toBe(200);
    const d = (r.json() as { data: { filename: string; label: string | null } }).data;
    expect(d.filename).toBe('renamed.png');
    expect(d.label).toBe('Hero');
    await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id }));
  });

  it('flips visibility from public to private', async () => {
    const { id } = await uploadOne();
    const r = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/assets/${id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ visibility: 'private' }),
    });
    expect(r.statusCode).toBe(200);
    const d = (r.json() as { data: { visibility: string } }).data;
    expect(d.visibility).toBe('private');
    await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id }));
  });

  it('returns 404 ASSET_NOT_FOUND for an unknown id', async () => {
    const r = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/assets/00000000-0000-0000-0000-000000000000',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ label: 'x' }),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
  });

  it('rejects visibility=private on a legacy asset with 409 ASSET_LEGACY_LOCATOR_CANNOT_HARDEN', async () => {
    // Forge a legacy row directly in the DB. Visibility flip should refuse.
    const em = h.em();
    const legacy = em.create(Asset, {
      kind: 'image',
      filename: 'legacy.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: '0',
      storageUrl: 'https://example.com/legacy.jpg',
      storageLocator: 'https://example.com/legacy.jpg',
      storageBackend: 'legacy',
      visibility: 'public',
    });
    await em.persistAndFlush(legacy);
    try {
      const r = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/assets/${legacy.id}`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ visibility: 'private' }),
      });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({
        error: { code: 'ASSET_LEGACY_LOCATOR_CANNOT_HARDEN' },
      });
    } finally {
      await em.removeAndFlush(legacy);
    }
  });
});
