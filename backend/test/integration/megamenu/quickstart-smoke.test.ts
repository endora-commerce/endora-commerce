import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T087 — End-to-end smoke covering quickstart.md § "End-to-end smoke":
 *   1. Create CMS Block.
 *   2. Create Megamenu, set 3-level tree with a `cms-block-embed` child.
 *   3. Add binding + activate.
 *   4. Storefront resolves the activated payload.
 *   5. CMS-block delete refused while megamenu references it.
 *   6. Admin reorders top-level — storefront sees the new order on
 *      next read (cache was invalidated by the items PUT).
 */
describe('Megamenu quickstart smoke (T087)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    defaultChannelCode = channel.code;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('walks the full editor → storefront → reference-protection → reorder flow', async () => {
    // 1. Create + populate a CMS Block.
    const blockCreate = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Smoke block',
        code: `mm-smoke-${Date.now()}`,
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(blockCreate.statusCode).toBe(201);
    const block = (blockCreate.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/blocks/${block.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        data: { root: { props: {} }, content: [{ type: 'Heading', props: { level: 'h2', text: 'Smoke' } }] },
        version: block.version,
      }),
    });

    // 2. Create the megamenu and a 3-level tree with the embed.
    const menuCreate = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Smoke menu ${Date.now()}` }),
    });
    const menu = (menuCreate.json() as { data: { id: string; version: number } }).data;

    const rootA = '11111111-aaaa-4111-8111-111111111111';
    const rootB = '22222222-aaaa-4222-8222-222222222222';
    const childA1 = '33333333-aaaa-4333-8333-333333333333';
    const grandA1a = '44444444-aaaa-4444-8444-444444444444';
    const embed = '55555555-aaaa-4555-8555-555555555555';

    const setItems = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          { id: rootA, parentId: null, position: 0, kind: 'external-link', labels: { 'en-US': 'Catalog' }, target: { url: 'https://example.com/catalog' } },
          { id: rootB, parentId: null, position: 1, kind: 'external-link', labels: { 'en-US': 'Phone' }, target: { url: 'tel:+48123' } },
          { id: childA1, parentId: rootA, position: 0, kind: 'external-link', labels: { 'en-US': 'Garden' }, target: { url: 'https://example.com/catalog/garden' } },
          { id: grandA1a, parentId: childA1, position: 0, kind: 'external-link', labels: { 'en-US': 'Tools' }, target: { url: 'https://example.com/catalog/garden/tools' } },
          { id: embed, parentId: rootA, position: 1, kind: 'cms-block-embed', labels: { 'en-US': 'Hero' }, target: { blockId: block.id, embedSide: 'right' } },
        ],
        version: menu.version,
      }),
    });
    expect(setItems.statusCode).toBe(200);

    // 3. Bind + activate.
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    const activate = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(activate.statusCode).toBe(200);

    // 4. Storefront resolves the payload.
    const first = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      data: { items: Array<{ label: string; children: Array<{ label: string; children: unknown[] }> }> };
    };
    expect(firstBody.data.items.map((i) => i.label)).toEqual(['Catalog', 'Phone']);
    expect(firstBody.data.items[0]?.children.find((c) => c.label === 'Garden')?.children[0]).toMatchObject(
      { label: 'Tools' },
    );

    // 5. Refuse Block delete while megamenu references it.
    const blockDelete = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });
    expect(blockDelete.statusCode).toBe(409);
    expect(blockDelete.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });

    // 6. Reorder the top-level (Phone → first) and read again.
    const reorderItems = (firstBody.data.items as unknown as Array<{ label: string }>).map((item, idx) => {
      if (item.label === 'Phone') return { ...item, position: 0 };
      if (item.label === 'Catalog') return { ...item, position: 1 };
      return { ...item, position: idx };
    });
    // Need to look up the latest version because previous mutations bumped it.
    const latest = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/megamenu/menus/${menu.id}`,
      cookies: adminCookie,
    });
    const latestVersion = (latest.json() as { data: { items: unknown[]; version: number } }).data.version;
    const fullItems = (latest.json() as { data: { items: unknown[] } }).data.items as Array<Record<string, unknown>>;
    // Just swap the two roots' positions in the round-tripped tree.
    const reordered = fullItems.map((item) => {
      if (item['id'] === rootA) return { ...item, position: 1 };
      if (item['id'] === rootB) return { ...item, position: 0 };
      return item;
    });
    void reorderItems; // keep linter happy; we use the round-tripped tree above
    const repaint = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ items: reordered, version: latestVersion }),
    });
    expect(repaint.statusCode).toBe(200);

    const second = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    const secondBody = second.json() as { data: { items: Array<{ label: string }> } };
    expect(secondBody.data.items.map((i) => i.label)).toEqual(['Phone', 'Catalog']);
  });
});
