import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../../src/modules/assets_library/entities/asset.entity.js';
import { CmsPage } from '../../../src/modules/cms_pages/entities/cms-page.entity.js';

/**
 * T093 — CMS body scan reference descriptor.
 *
 * Verifies that an asset embedded in `cms_pages.body` as
 * `{ type: 'asset_ref', assetId: ... }` blocks soft-delete via the
 * AssetReferenceRegistry, and that removing the embed unblocks delete.
 */

describe('cms body scan (T093)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('blocks soft-delete when an asset_ref node points at the asset', async () => {
    const em = h.em();
    const asset = em.create(Asset, {
      kind: 'image',
      filename: 'cms-embed.png',
      mimeType: 'image/png',
      sizeBytes: '0',
      storageUrl: 'https://example.com/c.png',
      storageLocator: 'https://example.com/c.png',
      storageBackend: 'legacy',
      visibility: 'public',
    });
    await em.persistAndFlush(asset);

    // Insert a CMS page whose body contains an asset_ref node.
    const slug = `t093-page-${randomUUID().slice(0, 8)}`;
    const page = em.create(CmsPage, {
      path: `/${slug}`,
      status: 'published',
      title: { 'en-US': `T093 page ${slug}` },
      body: {
        root: [
          { kind: 'paragraph', text: 'See:' },
          { type: 'asset_ref', assetId: asset.id, rendering: 'image' },
        ],
      },
    });
    await em.persistAndFlush(page);

    // Reference registry sees it → soft-delete blocked.
    const refs = await h.assetsLibrary.referenceRegistry.findReferences(asset.id);
    expect(refs.some((r) => r.kind === 'cms_body_embed')).toBe(true);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/assets/${asset.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(409);
    expect(del.json()).toMatchObject({ error: { code: 'ASSET_REFERENCED' } });

    // Remove the embed → soft-delete now succeeds.
    page.body = { root: [{ kind: 'paragraph', text: 'See: nothing.' }] };
    await em.flush();

    const del2 = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/assets/${asset.id}`,
      cookies: adminCookie,
    });
    expect(del2.statusCode).toBe(200);

    // Cleanup.
    const fresh = h.em().fork({ clear: true });
    await fresh.removeAndFlush(await fresh.findOneOrFail(CmsPage, { id: page.id }));
    await fresh.removeAndFlush(await fresh.findOneOrFail(Asset, { id: asset.id }));
  });
});
