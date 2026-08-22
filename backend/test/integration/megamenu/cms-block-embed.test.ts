import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T042 + T044 — CMS-block embed end-to-end. Verifies:
 *   1. PUT /menus/:id/items accepts a `cms-block-embed` item shape.
 *   2. Storefront `/by-channel` payload populates `block.content.data`
 *      from the CMS module's resolver.
 *   3. Deleting the referenced CMS Block while the megamenu still uses
 *      it returns 409 CMS_REFERENCED with the megamenu in the holders.
 */
describe('Megamenu CMS-block embed (T042 + T044)', () => {
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

  it('inlines a referenced CMS Block under a megamenu panel item', async () => {
    // Seed a CMS Block via the cms admin surface.
    const code = `mm-embed-${Date.now()}`;
    const blockRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Megamenu hero',
        code,
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(blockRes.statusCode).toBe(201);
    const block = (blockRes.json() as { data: { id: string; version: number } }).data;

    // Set its content.
    const blockPut = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/blocks/${block.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        data: {
          root: { props: {} },
          content: [{ type: 'Heading', props: { level: 'h2', text: 'Hero!' } }],
        },
        version: block.version,
      }),
    });
    expect(blockPut.statusCode).toBe(200);

    // Create a megamenu, add a top-level item, add a cms-block-embed child.
    const menuRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Embed test ${Date.now()}` }),
    });
    const menu = (menuRes.json() as { data: { id: string; version: number } }).data;

    const setItems = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          {
            id: '6f2c7b4a-1d3e-4cb5-ab21-fa1023df1100',
            parentId: null,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'Specials' },
            target: { url: 'https://example.com/specials' },
          },
          {
            parentId: '6f2c7b4a-1d3e-4cb5-ab21-fa1023df1100',
            position: 0,
            kind: 'cms-block-embed',
            labels: { 'en-US': 'Hero' },
            target: { blockId: block.id, embedSide: 'right' },
          },
        ],
        version: menu.version,
      }),
    });
    expect(setItems.statusCode).toBe(200);

    // Bind + activate.
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

    // Storefront resolution surfaces the inlined block payload.
    const resolved = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(resolved.statusCode).toBe(200);
    const body = resolved.json() as {
      data: {
        items: Array<{
          children: Array<{
            kind: string;
            block?: { code: string; content: { data: { content: Array<{ type: string }> } } };
            embedSide?: string;
          }>;
        }>;
      };
    };
    const topLevel = body.data.items[0]!;
    const embed = topLevel.children.find((c) => c.kind === 'cms-block-embed');
    expect(embed).toBeDefined();
    expect(embed!.embedSide).toBe('right');
    expect(embed!.block?.code).toBe(code);
    expect(embed!.block?.content.data.content[0]?.type).toBe('Heading');

    // Deleting the referenced CMS Block while megamenu uses it returns
    // 409 CMS_REFERENCED via the cms ↔ megamenu external-scanner bridge.
    const blockDelete = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });
    expect(blockDelete.statusCode).toBe(409);
    expect(blockDelete.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });
  });
});
