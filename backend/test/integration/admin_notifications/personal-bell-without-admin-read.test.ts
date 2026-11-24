import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminNotificationRecordPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { TEST_RESTRICTED_ADMIN_ID } from '../../helpers/seed-admins.js';

/**
 * Issue #518 — every signed-in admin reads and acknowledges their own bell.
 *
 * Personal notifications (`audience='admin_user'`) are recorded for any
 * administrator a Task or a CRM record names, whatever their role. Before the
 * fix the bell's routes were gated on `admin:read`, so a narrow role — the demo
 * Sales representative — had rows written for them that they could never read.
 *
 * The owner's ruling (option A): the bell is a signed-in-admin surface, and
 * `admin:read` gates only the `all_admins` broadcast audience — listing it,
 * counting it and acknowledging it.
 *
 * The restricted admin of the seed holds `orders:read` alone, so it stands for
 * every role without `admin:read`.
 */

const RESTRICTED = { b2b_session: 'stub-restricted-admin-session' };
const PLATFORM_ADMIN = { b2b_session: 'stub-admin-session' };

interface FeedItem {
  id: string;
  audience: string;
  isRead: boolean;
}

interface Feed {
  items: FeedItem[];
  unreadCount: number;
}

describe('admin notification bell for an admin without admin:read (#518)', () => {
  let h: BackendServerHandle;
  let port: AdminNotificationRecordPort;
  let ownId: string;
  let broadcastId: string;
  let othersId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<AdminNotificationRecordPort>('adminNotificationRecordPort');
    ownId = (
      await port.record({
        audience: 'admin_user',
        targetAdminUserId: TEST_RESTRICTED_ADMIN_ID,
        kind: 'test.issue-518.own',
        title: 'Task T-1 was assigned to you',
      })
    ).id;
    broadcastId = (
      await port.record({
        audience: 'all_admins',
        kind: 'test.issue-518.broadcast',
        title: 'A new organisation registered',
      })
    ).id;
    othersId = (
      await port.record({
        audience: 'admin_user',
        targetAdminUserId: TEST_ADMIN_ID,
        kind: 'test.issue-518.others',
        title: 'Task T-2 was assigned to you',
      })
    ).id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const feed = async (cookies: Record<string, string>, query = 'limit=100'): Promise<Feed> => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/notifications?${query}`,
      cookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Feed;
  };

  it('lists their own notification and no broadcast', async () => {
    const page = await feed(RESTRICTED);
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(ownId);
    expect(ids).not.toContain(broadcastId);
    expect(ids).not.toContain(othersId);
    expect(page.items.every((item) => item.audience === 'admin_user')).toBe(true);
  });

  it('counts only their own unread notifications', async () => {
    const page = await feed(RESTRICTED, 'limit=100&unread=true');
    expect(page.items.map((item) => item.id)).not.toContain(broadcastId);
    expect(page.unreadCount).toBe(page.items.length);
  });

  it('cannot acknowledge a broadcast', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${broadcastId}/read`,
      cookies: RESTRICTED,
    });
    expect(res.statusCode, res.body).toBe(404);
  });

  it("cannot acknowledge another admin's notification", async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${othersId}/read`,
      cookies: RESTRICTED,
    });
    expect(res.statusCode, res.body).toBe(404);
    const owner = await feed(PLATFORM_ADMIN);
    expect(owner.items.find((item) => item.id === othersId)?.isRead).toBe(false);
  });

  it('acknowledges their own notification', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${ownId}/read`,
      cookies: RESTRICTED,
    });
    expect(res.statusCode, res.body).toBe(204);
    const page = await feed(RESTRICTED);
    expect(page.items.find((item) => item.id === ownId)?.isRead).toBe(true);
  });

  it('mark-all-read acknowledges their own rows and writes no broadcast read', async () => {
    const second = await port.record({
      audience: 'admin_user',
      targetAdminUserId: TEST_RESTRICTED_ADMIN_ID,
      kind: 'test.issue-518.own',
      title: 'Task T-3 was assigned to you',
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/notifications/mark-all-read',
      cookies: RESTRICTED,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { markedCount: number }).markedCount).toBeGreaterThanOrEqual(1);
    const page = await feed(RESTRICTED);
    expect(page.items.find((item) => item.id === second.id)?.isRead).toBe(true);
    expect(page.unreadCount).toBe(0);

    const reads = await h.orm.em
      .fork()
      .getConnection()
      .execute(`select 1 from "admin_notification_reads" where "admin_user_id" = ?`, [TEST_RESTRICTED_ADMIN_ID]);
    expect(reads).toHaveLength(0);
  });

  it('still lists and acknowledges broadcasts for an admin holding admin:read', async () => {
    const page = await feed(PLATFORM_ADMIN);
    expect(page.items.map((item) => item.id)).toContain(broadcastId);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${broadcastId}/read`,
      cookies: PLATFORM_ADMIN,
    });
    expect(res.statusCode, res.body).toBe(204);
  });
});
