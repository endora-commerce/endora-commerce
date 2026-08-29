import { Asset } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mkdtemp, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { Setting } from '../../../src/kernel/settings/setting.entity.js';

import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';

import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';


/**
 * T037 — Contract test: GET /assets/file/:assetId (public + private + 410 + 404).
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

describe('public asset file (T037)', () => {
  let h: BackendServerHandle;
  let baseDir: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    baseDir = await mkdtemp(join(tmpdir(), 'assets-library-public-'));
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
    await teardownBackendServer(h);
    await rm(baseDir, { recursive: true, force: true });
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function uploadOne(visibility: 'public' | 'private' = 'public'): Promise<string> {
    // Visibility MUST come before the file part because @fastify/multipart
    // streams parts in arrival order; the upload pipeline finalises the
    // asset on the file part, so any visibility set later is ignored.
    const { body, contentType } = buildMultipart([
      { name: 'visibility', value: visibility },
      { name: 'file', filename: 'p.png', mime: 'image/png', value: TINY_PNG },
    ]);
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets',
      headers: { 'content-type': contentType },
      cookies: adminCookie,
      payload: body,
    });
    expect(r.statusCode).toBe(201);
    return (r.json() as { data: { id: string } }).data.id;
  }

  it('serves a public asset with 200 + correct headers', async () => {
    const id = await uploadOne('public');
    const r = await h.app.inject({ method: 'GET', url: `/assets/file/${id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toContain('public');
    expect(r.headers['etag']).toBeTruthy();
    expect(r.rawPayload).toBeInstanceOf(Buffer);
    expect(r.rawPayload.equals(TINY_PNG)).toBe(true);
    // The multipart part carried no Content-Length, so the byte count must be
    // captured from the stream — not left at 0 — or browsers render a blank
    // image. Content-Length must match the actual body length.
    expect(r.headers['content-length']).toBe(String(TINY_PNG.length));
    // Public assets are embedded cross-origin by the storefront/admin, so the
    // resource policy must permit it.
    expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const stored = await h.em().findOneOrFail(Asset, { id });
    expect(Number(stored.sizeBytes)).toBe(TINY_PNG.length);
    await h.em().removeAndFlush(stored);
  });

  it('returns 304 on conditional GET when ETag matches', async () => {
    const id = await uploadOne('public');
    const first = await h.app.inject({ method: 'GET', url: `/assets/file/${id}` });
    const etag = first.headers['etag'];
    const second = await h.app.inject({
      method: 'GET',
      url: `/assets/file/${id}`,
      headers: { 'if-none-match': etag as string },
    });
    expect(second.statusCode).toBe(304);
    await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id }));
  });

  it('rejects an unauthenticated request for a private asset with 403', async () => {
    const id = await uploadOne('private');
    const r = await h.app.inject({ method: 'GET', url: `/assets/file/${id}` });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: { code: 'ASSET_ACCESS_DENIED' } });
    await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id }));
  });

  it('serves a private asset with a valid signed token (200)', async () => {
    const id = await uploadOne('private');
    const adminUrlR = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/assets/${id}/url`,
      cookies: adminCookie,
    });
    expect(adminUrlR.statusCode).toBe(200);
    const url = (adminUrlR.json() as { data: { url: string } }).data.url;
    expect(url).toMatch(/[?&]token=/);
    expect(url).toMatch(/[?&]exp=/);
    // Strip the host portion before injecting.
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const r = await h.app.inject({ method: 'GET', url: path });
    expect(r.statusCode).toBe(200);
    await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id }));
  });

  it('returns 404 ASSET_NOT_FOUND for an unknown id', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/assets/file/00000000-0000-0000-0000-000000000000',
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
  });
});
