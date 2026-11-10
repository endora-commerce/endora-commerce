import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  ADMIN,
  forgetAssets,
  pdfBytes,
  replaceAsset,
  runName,
  uploadAsset,
  type AssetBody,
} from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` QA of the backend block — what the file route
 * must not reveal about a private asset (FR-013, FR-018, SC-008, R-9) and what
 * it does with a stale marker on a permalink (FR-012a).
 */

describe('public file route — private and stale-marker edges (feature 156 QA)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const created: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
  }, 120_000);

  afterAll(async () => {
    await forgetAssets(h, created);
    await store.undo();
    await teardownBackendServer(h);
  });

  async function asset(visibility: 'public' | 'private'): Promise<AssetBody> {
    const a = await uploadAsset(
      h,
      { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes(runName()) },
      { visibility },
    );
    created.push(a.id);
    return a;
  }

  async function setPermalink(id: string, permalink: string): Promise<void> {
    const r = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/assets/${id}/permalink`,
      cookies: ADMIN,
      payload: { permalink, confirmReuse: true },
    });
    expect(r.statusCode, r.body).toBe(200);
  }

  const get = (url: string, headers: Record<string, string> = {}) => h.app.inject({ method: 'GET', url, headers });

  async function signedQuery(id: string): Promise<string> {
    const r = await h.app.inject({ method: 'GET', url: `/api/v1/admin/assets/${id}/url`, cookies: ADMIN });
    return new URL((r.json() as { data: { url: string } }).data.url).search;
  }

  /** Everything a client can observe, minus the date and the request id, which legitimately vary. */
  function observable(res: Awaited<ReturnType<typeof get>>) {
    const { date: _date, 'x-request-id': _requestId, ...headers } = res.headers;
    return {
      status: res.statusCode,
      headers,
      body: res.body.replace(/"requestId":"[^"]*"/, '"requestId":"-"'),
    };
  }

  it('answers a private permalink without a signature exactly as a name that does not exist (status, headers and body)', async () => {
    const a = await asset('private');
    const permalink = `${runName()}/hidden.pdf`;
    await setPermalink(a.id, permalink);
    const hidden = observable(await get(`/assets/file/${permalink}`));
    const missing = observable(await get(`/assets/file/${runName()}/hidden.pdf`));
    expect(hidden.status).toBe(404);
    expect(hidden).toEqual(missing);

    // The same holds with a bad signature, an expired one and a stale marker.
    const query = await signedQuery(a.id);
    const params = new URLSearchParams(query);
    params.set('token', 'deadbeef'.repeat(8));
    expect(observable(await get(`/assets/file/${permalink}?${params}`))).toEqual(missing);
    params.set('token', new URLSearchParams(query).get('token')!);
    params.set('exp', String(Math.floor(Date.now() / 1000) - 60));
    expect(observable(await get(`/assets/file/${permalink}?${params}`))).toEqual(missing);
    expect(observable(await get(`/assets/file/${permalink}?v=000000000000`))).toEqual(missing);
  });

  it('never answers 304 to an unsigned request for a private asset, even with its real ETag', async () => {
    const a = await asset('private');
    const permalink = `${runName()}/etag.pdf`;
    await setPermalink(a.id, permalink);
    const query = await signedQuery(a.id);
    const signed = await get(`/assets/file/${a.id}${query}`);
    expect(signed.statusCode).toBe(200);
    const etag = String(signed.headers.etag);
    expect(etag).not.toBe('undefined');

    const byId = await get(`/assets/file/${a.id}`, { 'if-none-match': etag });
    expect(byId.statusCode).toBe(404);
    expect(byId.headers.etag).toBeUndefined();
    const byName = await get(`/assets/file/${permalink}`, { 'if-none-match': etag });
    expect(byName.statusCode).toBe(404);
    expect(byName.headers.etag).toBeUndefined();
    expect(byName.headers['cache-control']).toBe('no-store');
  });

  it('refuses another asset’s signature and an expired one by id', async () => {
    const a = await asset('private');
    const b = await asset('private');
    const foreign = await get(`/assets/file/${a.id}${await signedQuery(b.id)}`);
    expect(foreign.statusCode).toBe(404);
    const params = new URLSearchParams(await signedQuery(a.id));
    params.set('exp', String(Math.floor(Date.now() / 1000) - 60));
    const expired = await get(`/assets/file/${a.id}?${params}`);
    expect(expired.statusCode).toBe(404);
    expect(expired.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
  });

  it('sends a stale marker on a permalink to the permalink’s current version, never copying a signature', async () => {
    const a = await asset('public');
    const permalink = `${runName()}/stale.pdf`;
    await setPermalink(a.id, permalink);
    const replaced = await replaceAsset(h, a.id, {
      filename: `${runName()}.pdf`,
      mime: 'application/pdf',
      value: pdfBytes('stale-2'),
    });
    expect(replaced.statusCode, replaced.body).toBe(200);
    const current = (replaced.json() as { data: AssetBody }).data.contentVersion;
    expect(current).not.toBe(a.contentVersion);

    const stale = await get(`/assets/file/${permalink.toUpperCase()}?v=${a.contentVersion}&token=abc&exp=1&download=1`);
    expect(stale.statusCode).toBe(302);
    expect(stale.headers.location).toBe(`/assets/file/${permalink}?v=${current}&download=1`);
    expect(String(stale.headers.location)).not.toMatch(/token|exp=/);
    expect(stale.headers['cache-control']).toBe('no-store');
    expect(stale.headers['x-content-type-options']).toBe('nosniff');

    const followed = await get(String(stale.headers.location));
    expect(followed.statusCode).toBe(200);
    expect(followed.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});
