import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../../src/modules/assets_library/entities/asset.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T059 + T060 — Icons on link items. The target validator refuses an
 * iconAssetId that points at a non-image asset; the storefront resolver
 * populates `item.icon = { assetId, url, position }` for link items
 * carrying the optional icon shape.
 */
describe('Megamenu link icons (T059 + T060)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;
  let imageAssetId: string;
  let videoAssetId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    defaultChannelCode = channel.code;

    const image = em.create(Asset, {
      filename: 'icon.svg',
      mimeType: 'image/svg+xml',
      kind: 'image',
      sizeBytes: '100',
      visibility: 'public',
      storageBackend: 'local',
      storageLocator: 'icons/icon.svg',
      storageUrl: '/assets/icons/icon.svg',
      label: 'Icon',
    });
    const video = em.create(Asset, {
      filename: 'video.mp4',
      mimeType: 'video/mp4',
      kind: 'video',
      sizeBytes: '1000',
      visibility: 'public',
      storageBackend: 'local',
      storageLocator: 'videos/video.mp4',
      storageUrl: '/assets/videos/video.mp4',
      label: 'Video',
    });
    await em.persistAndFlush([image, video]);
    imageAssetId = image.id;
    videoAssetId = video.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createMenu(): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Icons ${Date.now()}-${Math.random()}` }),
    });
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('refuses an iconAssetId pointing at a video asset', async () => {
    const menu = await createMenu();
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          {
            parentId: null,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'X' },
            target: {
              url: 'https://example.com',
              iconAssetId: videoAssetId,
              iconPosition: 'left',
            },
          },
        ],
        version: menu.version,
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.MEGAMENU_ASSET_KIND_MISMATCH } });
  });

  it('storefront payload populates item.icon for a link with an image icon', async () => {
    const menu = await createMenu();
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          {
            parentId: null,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'Phone' },
            target: {
              url: 'tel:+48123',
              iconAssetId: imageAssetId,
              iconPosition: 'right',
            },
          },
        ],
        version: menu.version,
      }),
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(res.statusCode).toBe(200);
    const item = (res.json() as {
      data: { items: Array<{ icon?: { assetId: string; position: string; url: string } }> };
    }).data.items[0];
    expect(item?.icon).toBeDefined();
    expect(item!.icon!.assetId).toBe(imageAssetId);
    expect(item!.icon!.position).toBe('right');
    expect(typeof item!.icon!.url).toBe('string');
  });
});
