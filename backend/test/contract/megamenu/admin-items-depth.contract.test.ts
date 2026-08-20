import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T078 — Tree depth > 4 is a non-blocking UX warning. Save still
 * succeeds; the response carries `meta.warnings` containing
 * `MEGAMENU_DEPTH_EXCEEDED`; every level (including the 5th) persists
 * and resolves on the storefront.
 */
describe('Megamenu tree depth (T078)', () => {
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

  it('persists a 5-level tree and surfaces a non-blocking warning', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Depth ${Date.now()}` }),
    });
    const menu = (create.json() as { data: { id: string; version: number } }).data;

    // 5-level chain.
    const ids = [
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
      'cccccccc-3333-4333-8333-cccccccccccc',
      'dddddddd-4444-4444-8444-dddddddddddd',
      'eeeeeeee-5555-4555-8555-eeeeeeeeeeee',
    ];
    const items = ids.map((id, idx) => ({
      id,
      parentId: idx === 0 ? null : ids[idx - 1],
      position: 0,
      kind: 'external-link' as const,
      labels: { 'en-US': `L${idx + 1}` },
      target: { url: `https://example.com/level-${idx + 1}` },
    }));

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ items, version: menu.version }),
    });
    expect(put.statusCode).toBe(200);
    const body = put.json() as {
      data: { items: unknown[] };
      meta?: { warnings?: Array<{ code: string }> };
    };
    expect(body.data.items).toHaveLength(5);
    expect(body.meta?.warnings?.[0]?.code).toBe('MEGAMENU_DEPTH_EXCEEDED');

    // Resolve the storefront — every level should be reachable.
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

    const resolved = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(resolved.statusCode).toBe(200);

    // Walk down — every level (including the 5th) should resolve.
    let cursor = (resolved.json() as { data: { items: Array<{ label: string; children: unknown[] }> } }).data.items[0];
    for (let i = 0; i < 5; i++) {
      expect(cursor?.label).toBe(`L${i + 1}`);
      if (i < 4) {
        cursor = (cursor as { children: Array<{ label: string; children: unknown[] }> }).children[0];
      }
    }
  });
});
