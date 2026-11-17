import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { NewsletterTokenHelper } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';

/** The key the test harness pins newsletter links to (`newsletterTokenSecret` in `test-server.ts`). */
const HARNESS_NEWSLETTER_TOKEN_SECRET = 'test-newsletter-secret';
const ADMIN = { b2b_session: 'stub-admin-session' };

/**
 * Issue #1381 (Principle XIII) — every subscriber write runs a Command, so each
 * one stores exactly one audit entry in its own transaction, under the actor
 * the bus resolved: none for the anonymous storefront and e-mail-link routes,
 * the operator for the admin ones. A refused or no-op write stores none.
 */
describe('newsletter subscriber writes are Commands (issue #1381)', () => {
  let h: BackendServerHandle;
  const tokens = new NewsletterTokenHelper(HARNESS_NEWSLETTER_TOKEN_SECRET);

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const entriesFor = async (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectId }, { orderBy: { actedAt: 'asc' } });

  const subscriberIdOf = async (email: string): Promise<string> => {
    const [row] = (await h.em().getConnection().execute(
      `select id from newsletter_subscribers where email = ?`,
      [email],
    )) as Array<{ id: string }>;
    if (!row) throw new Error(`no subscriber was stored for ${email}`);
    return row.id;
  };

  it('stores one entry per storefront write: subscribe, confirm, unsubscribe — and none for a repeat', async () => {
    const email = `s1381-public-${Date.now()}@example.test`;
    const subscribed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      payload: { email, channelCode: 'default' },
    });
    expect(subscribed.statusCode, subscribed.body).toBe(200);
    const id = await subscriberIdOf(email);
    const pending = (subscribed.json().data as { status: string }).status === 'pending';

    const confirmUrl = `/api/v1/newsletter/confirm?token=${encodeURIComponent(tokens.mint('confirm', { id }, 3600))}`;
    expect((await h.app.inject({ method: 'GET', url: confirmUrl })).statusCode).toBe(302);
    // Already active: the second confirmation changes nothing and records nothing.
    expect((await h.app.inject({ method: 'GET', url: confirmUrl })).statusCode).toBe(302);

    const token = tokens.mint('unsubscribe', { id }, 3600);
    for (let i = 0; i < 2; i += 1) {
      const unsubscribed = await h.app.inject({
        method: 'POST',
        url: '/api/v1/newsletter/unsubscribe',
        payload: { token, reason: 'S1381 too many mails' },
      });
      expect(unsubscribed.statusCode, unsubscribed.body).toBe(200);
    }

    const entries = await entriesFor(id);
    expect(entries.map((entry) => entry.action)).toEqual([
      'newsletter_subscribe',
      ...(pending ? ['newsletter_confirm'] : []),
      'newsletter_unsubscribe',
    ]);
    for (const entry of entries) {
      expect(entry.objectType).toBe('newsletter_subscriber');
      expect(entry.actorAdminUserId ?? null).toBeNull();
    }
    expect(entries.at(-1)!.stateAfter).toEqual({ status: 'unsubscribed', hasReason: true });
    const text = JSON.stringify(entries.map((entry) => [entry.stateBefore, entry.stateAfter]));
    expect(text).not.toContain(email);
    expect(text).not.toContain('S1381');
  });

  it('stores one entry per operator write, naming the operator, and none for a refused one', async () => {
    const email = `s1381-admin-${Date.now()}@example.test`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/newsletter/subscribers',
      cookies: ADMIN,
      payload: { email },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = await subscriberIdOf(email);
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/newsletter/subscribers/${id}`, cookies: ADMIN });
    const version = (detail.json().data as { version: number }).version;

    const stale = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/newsletter/subscribers/${id}/deactivate`,
      cookies: ADMIN,
      payload: { expectedVersion: version + 100 },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    const deactivated = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/newsletter/subscribers/${id}/deactivate`,
      cookies: ADMIN,
      payload: { expectedVersion: version },
    });
    expect(deactivated.statusCode, deactivated.body).toBe(200);
    expect((deactivated.json().data as { status: string; version: number })).toMatchObject({
      status: 'deactivated',
      version: version + 1,
    });

    const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/newsletter/subscribers/${id}`, cookies: ADMIN });
    expect(removed.statusCode, removed.body).toBe(204);
    const again = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/newsletter/subscribers/${id}`, cookies: ADMIN });
    expect(again.statusCode).toBe(404);

    const entries = await entriesFor(id);
    expect(entries.map((entry) => entry.action)).toEqual([
      'newsletter_subscribe',
      'newsletter_deactivate',
      'newsletter_delete',
    ]);
    for (const entry of entries) expect(entry.actorAdminUserId).toBe(TEST_ADMIN_ID);
    expect(entries[0]!.stateAfter).toMatchObject({ source: 'api' });
    expect(entries[1]!.stateAfter).toEqual({ status: 'deactivated' });
    expect(entries[2]!.stateBefore).toEqual({ status: 'deactivated' });
    expect(entries[2]!.stateAfter ?? null).toBeNull();
    expect(JSON.stringify(entries.map((entry) => [entry.stateBefore, entry.stateAfter]))).not.toContain(email);
  });
});
