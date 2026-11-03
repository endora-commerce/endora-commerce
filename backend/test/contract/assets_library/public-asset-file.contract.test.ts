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
import { overrideAssetSetting } from '../../helpers/crm-attachment-upload.js';




import { resolvePublicApiBaseUrl } from '../../../src/kernel/index.js';

import { replaceAsset, runName } from '../../helpers/asset-replace-fixtures.js';


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
  let restoreBaseDir: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    h = await setupBackendServer();
    baseDir = await mkdtemp(join(tmpdir(), 'assets-library-public-'));
    restoreBaseDir = await overrideAssetSetting(h, 'assets.local.base_dir', baseDir);
    h.assetsLibrary.adapters.invalidate();
  });

  afterAll(async () => {
    await restoreBaseDir?.();
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
    // D-223 — `getAssetUrlResponse` carries an absolute URL, signature and all.
    // The signed form is the one a hand-written join could not have rebased,
    // which is why `product_feeds`' root site skipped it rather than absolutizing
    // it; this module builds it on the origin, so the query survives untouched
    // and the route below still validates the signature.
    expect(url).toMatch(/^https?:\/\/[^/]+\/assets\/file\//);
    // Strip the host portion before injecting.
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const r = await h.app.inject({ method: 'GET', url: path });
    expect(r.statusCode).toBe(200);
    await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id }));
  });

  it('answers an absolute, unsigned URL for a public asset (D-223)', async () => {
    const id = await uploadOne('public');
    const r = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/assets/${id}/url`,
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    const body = (r.json() as { data: { url: string; expiresAt: string | null } }).data;
    // The stable public form: an origin, the route, no signature, no expiry.
    // It used to be `/assets/file/<id>` — correct only for a browser already on
    // this host, and the reason three composition-root sites rebased it, each in
    // its own way, and a fourth did not.
    expect(body.url).toBe(`${resolvePublicApiBaseUrl()}/assets/file/${id}`);
    expect(body.expiresAt).toBeNull();
    await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id }));
  });

  it('serves an uploaded SVG as an image under a policy that runs no script', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'logo.svg', mime: 'image/svg+xml', value: svg },
    ]);
    const up = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets',
      headers: { 'content-type': contentType },
      cookies: adminCookie,
      payload: body,
    });
    expect(up.statusCode).toBe(201);
    const id = (up.json() as { data: { id: string } }).data.id;
    const r = await h.app.inject({ method: 'GET', url: `/assets/file/${id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/svg+xml');
    expect(r.headers['content-disposition']).toMatch(/^inline;/);
    expect(r.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id }));
  });

  it('refuses an HTML upload with 415 and stores nothing', async () => {
    const before = await h.em().fork().count(Asset, {});
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'page.html', mime: 'text/html', value: '<!doctype html><p>hi</p>' },
    ]);
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets',
      headers: { 'content-type': contentType },
      cookies: adminCookie,
      payload: body,
    });
    expect(r.statusCode).toBe(415);
    expect(r.json()).toMatchObject({ error: { code: 'ASSET_UPLOAD_TYPE_NOT_ALLOWED' } });
    expect(await h.em().fork().count(Asset, {})).toBe(before);
  });

  it('returns 404 ASSET_NOT_FOUND for an unknown id', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/assets/file/00000000-0000-0000-0000-000000000000',
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
  });

  // -------------------------------------------------------------------------
  // specs/156-asset-stable-url/ T055 — caching by URL form, the stale-marker
  // redirect, and the signature checked before the deleted state.
  // -------------------------------------------------------------------------

  async function detailOf(id: string): Promise<{ contentVersion: string }> {
    const r = await h.app.inject({ method: 'GET', url: `/api/v1/admin/assets/${id}`, cookies: adminCookie });
    return (r.json() as { data: { contentVersion: string } }).data;
  }

  function expectRefusalHeaders(r: { headers: Record<string, unknown> }): void {
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  }

  it('caches the bare URL as public, no-cache and the current-marker URL as immutable, ETag from the content version', async () => {
    const id = await uploadOne('public');
    const { contentVersion } = await detailOf(id);
    const bare = await h.app.inject({ method: 'GET', url: `/assets/file/${id}` });
    expect(bare.headers['cache-control']).toBe('public, no-cache');
    expect(bare.headers['etag']).toBe(`"${id}-${contentVersion}"`);
    const marked = await h.app.inject({ method: 'GET', url: `/assets/file/${id}?v=${contentVersion}` });
    expect(marked.statusCode).toBe(200);
    expect(marked.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('after a replace, a stale marker redirects to the current one, keeping only download=1, and the old ETag gets the new bytes', async () => {
    const id = await uploadOne('public');
    const old = await detailOf(id);
    const oldEtag = String((await h.app.inject({ method: 'GET', url: `/assets/file/${id}` })).headers['etag']);
    const replaced = await replaceAsset(h, id, {
      filename: `${runName()}.png`,
      mime: 'image/png',
      value: Buffer.concat([TINY_PNG, Buffer.from('as156')]),
    });
    expect(replaced.statusCode, replaced.body).toBe(200);
    const current = await detailOf(id);

    const stale = await h.app.inject({ method: 'GET', url: `/assets/file/${id}?v=${old.contentVersion}` });
    expect(stale.statusCode).toBe(302);
    expect(stale.headers['location']).toBe(`/assets/file/${id}?v=${current.contentVersion}`);
    expectRefusalHeaders(stale);
    const download = await h.app.inject({ method: 'GET', url: `/assets/file/${id}?v=${old.contentVersion}&download=1` });
    expect(download.headers['location']).toBe(`/assets/file/${id}?v=${current.contentVersion}&download=1`);
    const extra = await h.app.inject({
      method: 'GET',
      url: `/assets/file/${id}?v=${old.contentVersion}&token=a&exp=1&x=y`,
    });
    expect(extra.headers['location']).toBe(`/assets/file/${id}?v=${current.contentVersion}`);

    const conditional = await h.app.inject({ method: 'GET', url: `/assets/file/${id}`, headers: { 'if-none-match': oldEtag } });
    expect(conditional.statusCode).toBe(200);
    expect(conditional.rawPayload.equals(Buffer.concat([TINY_PNG, Buffer.from('as156')]))).toBe(true);
  });

  it('answers 410 for a soft-deleted public asset, bare and with a marker', async () => {
    const id = await uploadOne('public');
    const { contentVersion } = await detailOf(id);
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${id}`, cookies: adminCookie })).statusCode).toBe(200);
    for (const url of [`/assets/file/${id}`, `/assets/file/${id}?v=${contentVersion}`]) {
      const r = await h.app.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(410);
      expectRefusalHeaders(r);
    }
  });

  it('checks a soft-deleted private asset’s signature first: 403 without or with a tampered one, 410 with a valid one', async () => {
    const id = await uploadOne('private');
    const signed = await h.app.inject({ method: 'GET', url: `/api/v1/admin/assets/${id}/url`, cookies: adminCookie });
    const url = new URL((signed.json() as { data: { url: string } }).data.url);
    const token = url.searchParams.get('token')!;
    const exp = url.searchParams.get('exp')!;
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${id}`, cookies: adminCookie })).statusCode).toBe(200);

    const without = await h.app.inject({ method: 'GET', url: `/assets/file/${id}` });
    const tampered = await h.app.inject({ method: 'GET', url: `/assets/file/${id}?token=${'0'.repeat(64)}&exp=${exp}` });
    const valid = await h.app.inject({ method: 'GET', url: `/assets/file/${id}?token=${token}&exp=${exp}` });
    expect([without.statusCode, tampered.statusCode, valid.statusCode]).toEqual([403, 403, 410]);
    expect(without.json()).toMatchObject({ error: { code: 'ASSET_ACCESS_DENIED' } });
    expect(valid.json()).toMatchObject({ error: { code: 'ASSET_GONE' } });
    for (const r of [without, tampered, valid]) expectRefusalHeaders(r);
  });

  it('answers 404 ASSET_NOT_FOUND for a name that is neither an id nor a permalink', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/assets/file/not-a-uuid-or-permalink' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
