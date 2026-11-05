import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';
import { seedProductScopesAdmins } from '../../helpers/product-scopes-admins.js';

/**
 * Feature 174, US8 (T108; FR-080, SC-010) — one `catalog:write` check governs the editor:
 *
 * - a `catalog:read` admin reads the scoped values at every scope (G, C, C×L);
 * - it gets 403 on `PUT …/scoped-values`, `POST …/scoped-values/copy` and `PATCH …/scopes`, and
 *   nothing is written;
 * - no product write route accepts it: the routes are **derived** from catalog's admin route files
 *   (every `post|put|patch|delete` under `/api/v1/admin/catalog/products`), not typed here, and
 *   the only ones gated `catalog:read` are the named reads-by-POST and the editor preference (UI
 *   state, research R8). A new write route gated `catalog:read` fails this file.
 */
const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const ROUTE_FILES = [
  'packages/modules/catalog/src/backend/routes.admin.ts',
  'packages/modules/catalog/src/backend/routes.admin.url-keys.ts',
];
/** Write-method routes a catalogue reader may call: reads by POST, and the editor's own UI state (R8). */
const READER_WRITE_METHOD_ROUTES = [
  'PATCH /api/v1/admin/catalog/products/:id/editor-preference',
  'POST /api/v1/admin/catalog/products/batch-by-id',
  'POST /api/v1/admin/catalog/products/resolve-ids',
  'PUT /api/v1/admin/catalog/products/:id/editor-preference',
];

function productWriteRoutes(): Array<{ method: string; url: string; permission: string | null }> {
  const routes: Array<{ method: string; url: string; permission: string | null }> = [];
  for (const file of ROUTE_FILES) {
    const source = readFileSync(path.join(REPO, file), 'utf8');
    for (const match of source.matchAll(/app\.(post|put|patch|delete)\s*(?:<[\s\S]*?>)?\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\}/g)) {
      const url = match[2]!;
      if (!url.startsWith('/api/v1/admin/catalog/products')) continue;
      const gate = /requireAdmin\('([^']+)'\)/.exec(match[3]!);
      routes.push({ method: match[1]!.toUpperCase(), url, permission: gate ? gate[1]! : null });
    }
  }
  return routes;
}

describe('174 US8 — catalog:read reads every scope and writes nothing (T108)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let productId: string;
  const reader = { cookies: { b2b_session: 'stub-product-scopes-reader-session' } };
  const routes = productWriteRoutes();
  process.stdout.write(`[scoped-values-permissions] read: files=${ROUTE_FILES.length} write-routes=${routes.length}\n`);

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    await seedProductScopesAdmins(h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    productId = await fx.product({ channels: [channel] });
    await fx.save(productId, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Wiertarka' });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('read something — an empty walk is a moved route file, not a clean one', () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.every((route) => route.permission !== null)).toBe(true);
  });

  it('reads the scoped values at G, C and C×L', async () => {
    for (const scope of [{}, { channelId: channel }, { channelId: channel, languageCode: 'pl-PL' }]) {
      const res = await fx.readRaw(productId, scope, reader);
      expect(res.statusCode, res.body).toBe(200);
    }
    expect((await fx.read(productId, { channelId: channel, languageCode: 'pl-PL' }, reader)).fields.name.value).toBe('Wiertarka');
  });

  it('is refused the save, the copy and the scopes PATCH with 403, and nothing is written', async () => {
    const { version } = await fx.read(productId);
    const save = await fx.put(productId, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Zmieniona' }, { version, who: reader });
    expect(save.statusCode).toBe(403);
    const copy = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/scoped-values/copy`,
      ...reader,
      payload: { field: 'name', from: { channelId: channel, languageCode: 'pl-PL' }, toChannelIds: [channel], version },
    });
    expect(copy.statusCode).toBe(403);
    const scopes = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/scopes`,
      ...reader,
      payload: { channels: [{ channelId: channel, status: 'inactive' }] },
    });
    expect(scopes.statusCode).toBe(403);
    const after = await fx.read(productId, { channelId: channel, languageCode: 'pl-PL' });
    expect(after.fields.name.value).toBe('Wiertarka');
    expect(after.version).toBe(version);
  });

  it('gates every other product write route on catalog:write, and answers the reader 403 on each', async () => {
    const readerRoutes = routes.filter((route) => route.permission !== 'catalog:write').map((route) => `${route.method} ${route.url}`);
    expect(readerRoutes.sort()).toEqual(READER_WRITE_METHOD_ROUTES);
    for (const route of routes.filter((r) => r.permission === 'catalog:write')) {
      const url = route.url.replace(/:kind\b/, 'related').replace(/:[A-Za-z]+/g, () => randomUUID());
      const res = await h.app.inject({ method: route.method as 'POST', url, ...reader, payload: {} });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
    }
  });
});
