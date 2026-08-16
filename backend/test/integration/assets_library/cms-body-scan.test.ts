import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../../src/modules/assets_library/entities/asset.entity.js';
import { CmsPage } from '../../../src/modules/cms/entities/cms-page.entity.js';

/**
 * T093 — CMS body scan reference descriptor.
 *
 * Feature 014 reshaped CMS pages: the legacy `body` (Record<lang,string>
 * of HTML) is gone; content lives in `content` as a Page Builder tree
 * envelope. The asset-ref scan now matches any `assetId` value anywhere
 * in the tree — Puck components like `LibraryImage` carry `assetId`
 * directly in their `props`. This test confirms the new descriptor
 * blocks asset deletion when an asset is embedded in cms_pages.content.
 */

describe('cms body scan (T093)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('blocks soft-delete when an asset id is embedded in cms_pages.content', async () => {
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

    const slug = `t093-page-${randomUUID().slice(0, 8)}`;
    // Page Builder content envelope with an embedded LibraryImage node
    // carrying the asset id under `props.assetId`. The new asset-ref
    // descriptor matches by value (jsonpath `$.** ? (@ == "<id>")`).
    const content = {
      schema_version: 1,
      languages: {
        'en-US': {
          root: { props: {} },
          content: [
            { type: 'Heading', props: { level: 1, text: 'See:' } },
            { type: 'LibraryImage', props: { assetId: asset.id, alt: 'embedded' } },
          ],
        },
      },
    };
    const page = em.create(CmsPage, {
      // Legacy columns kept NOT NULL by migration 013; mirror values until
      // a follow-up migration drops them.
      path: slug,
      title: { 'en-US': `T093 page ${slug}` },
      body: {} as Record<string, string>,
      name: `T093 page ${slug}`,
      slug,
      status: 'published',
      active: true,
      content,
      languages: ['en-US'],
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
    page.content = {
      schema_version: 1,
      languages: {
        'en-US': {
          root: { props: {} },
          content: [{ type: 'Heading', props: { level: 1, text: 'See: nothing.' } }],
        },
      },
    };
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
