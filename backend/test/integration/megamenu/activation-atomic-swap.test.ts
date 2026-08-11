import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T052 — Activation atomic swap. Two megamenus contend for the same
 * (sales channel, language) scope; activating the second deactivates
 * the first inside the same transaction. The partial unique index on
 * `megamenu_bindings(sales_channel_id, language) WHERE active = true`
 * refuses the dual-active state at the DB layer even when the service
 * regresses.
 */
describe('Megamenu activation atomic swap (T052)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function seedMenuWithBinding(
    name: string,
    channelId: string,
    language: string,
  ): Promise<string> {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name }),
    });
    const menu = (create.json() as { data: { id: string; version: number } }).data;
    const items = await h.app.inject({
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
            labels: { [language]: name },
            target: { url: 'tel:+48123' },
          },
        ],
        version: menu.version,
      }),
    });
    expect(items.statusCode).toBe(200);
    const bind = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: channelId, language }),
    });
    expect(bind.statusCode).toBe(201);
    return menu.id;
  }

  it('atomically swaps the active binding when contention occurs', async () => {
    const menuA = await seedMenuWithBinding('A', defaultChannelId, 'en-US');
    const menuB = await seedMenuWithBinding('B', defaultChannelId, 'en-US');

    // Activate A → A is the holder, no prior holder.
    const a = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menuA}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(a.json()).toMatchObject({ data: { previouslyActive: null } });

    // Activate B → A flips to active=false, B becomes the holder, the
    // response surfaces A in `previouslyActive`.
    const b = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menuB}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({
      data: {
        activated: { megamenuId: menuB },
        previouslyActive: { megamenuId: menuA, name: 'A' },
      },
    });

    // DB state: exactly one row is active for (channel, en-US).
    const rows = (await h.em().getConnection().execute(
      `select megamenu_id::text, active
         from megamenu_bindings
        where sales_channel_id = ? and language = ?
        order by megamenu_id`,
      [defaultChannelId, 'en-US'],
    )) as Array<{ megamenu_id: string; active: boolean }>;
    const activeIds = rows.filter((r) => r.active).map((r) => r.megamenu_id);
    expect(activeIds).toEqual([menuB]);
  });

  it('the partial unique index refuses a manual dual-active insert', async () => {
    const menuA = await seedMenuWithBinding('A2', defaultChannelId, 'en-US');
    const menuB = await seedMenuWithBinding('B2', defaultChannelId, 'en-US');

    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menuA}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });

    await expect(
      h.em().getConnection().execute(
        `update megamenu_bindings
            set active = true
          where megamenu_id = ? and sales_channel_id = ? and language = ?`,
        [menuB, defaultChannelId, 'en-US'],
      ),
    ).rejects.toThrow(/megamenu_bindings_active_uniq|duplicate key/);
  });
});
