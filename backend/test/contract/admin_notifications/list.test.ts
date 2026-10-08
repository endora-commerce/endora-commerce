import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminNotificationRecordPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * Regression — `GET /api/v1/admin/notifications` 500'd with knex
 * "Expected 1 bindings, saw 0" because the raw SQL mixed Postgres `$N`
 * placeholders with a knex positional bindings array. The endpoint had no
 * test, so the unconditional 500 went unnoticed.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('GET /api/v1/admin/notifications', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('requires an authenticated admin session', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/notifications?limit=25' });
    expect(res.statusCode).toBe(401);
  });

  it('returns a list for a stub admin (default page)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/notifications?limit=25',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.json() as { items: unknown[] }).items)).toBe(true);
  });

  it('returns a list with the unread filter', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/notifications?limit=10&unread=true',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
  });

  /**
   * The feed carries a translatable message beside the finished sentence
   * (`specs/143-crm-sales-opportunities/spec.md` FR-085). Additive: `title` and
   * `body` are answered as they always were, and an entry recorded without a
   * message answers `null` for both — a key that is present and null, so a
   * consumer can tell "no message" from "a backend that predates the field".
   */
  describe('translatable messages', () => {
    interface FeedItem {
      id: string;
      title: string;
      body: string | null;
      titleMessage?: unknown;
      bodyMessage?: unknown;
    }

    const record = (extra: Record<string, unknown> = {}) =>
      h.container.resolve<AdminNotificationRecordPort>('adminNotificationRecordPort').record({
        audience: 'admin_user',
        targetAdminUserId: TEST_ADMIN_ID,
        kind: 'test.feed-shape',
        title: 'Opportunity OPP-000007 was assigned to you',
        ...extra,
      });

    const feedItem = async (id: string): Promise<FeedItem | undefined> => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications?limit=100',
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { items: FeedItem[] }).items.find((item) => item.id === id);
    };

    it('answers the message of an entry recorded with one, and the English sentence beside it', async () => {
      const recorded = await record({
        body: 'Open it to read on.',
        titleMessage: { scope: 'crm', key: 'notifications.assigned.title', params: { number: 'OPP-000007' } },
        bodyMessage: { scope: 'crm', key: 'notifications.assigned.body' },
      });
      expect(await feedItem(recorded.id)).toMatchObject({
        title: 'Opportunity OPP-000007 was assigned to you',
        body: 'Open it to read on.',
        titleMessage: { scope: 'crm', key: 'notifications.assigned.title', params: { number: 'OPP-000007' } },
        bodyMessage: { scope: 'crm', key: 'notifications.assigned.body', params: {} },
      });
    });

    it('answers null for an entry recorded without one', async () => {
      const recorded = await record();
      const item = await feedItem(recorded.id);
      expect(item).toMatchObject({ title: 'Opportunity OPP-000007 was assigned to you', body: null });
      expect(item).toHaveProperty('titleMessage', null);
      expect(item).toHaveProperty('bodyMessage', null);
    });
  });
});
