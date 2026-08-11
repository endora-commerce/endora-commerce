import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEED_DELIVERY_REDACTED } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { FeedDelivery } from '../../../src/modules/product_feeds/entities/feed-delivery.entity.js';
import { CredentialConfiguration } from '../../../src/modules/credentials/entities/credential-configuration.entity.js';

/**
 * Feature 070 — the delivery configuration contract (FR-100, FR-101, FR-107,
 * AS-4, AS-5, AS-7).
 *
 * Four things this surface has to get right, and each is a case below:
 *
 *  - **A password written here is never readable back** (FR-107, AS-5). Not from
 *    the delivery endpoint, not from the credentials endpoint, not before a
 *    rotation and not after it.
 *  - **The address is refused while the operator is still editing it** (AS-4),
 *    with a message naming the reason — not tomorrow morning as a failed
 *    delivery nobody is watching.
 *  - **One configuration per feed** (FR-100), so saving twice reconfigures
 *    rather than accumulating.
 *  - **A read-only administrator sees the target and cannot change it** (AS-7).
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const READER = { cookies: { b2b_session: 'stub-delivery-reader-session' } };
const READER_ID = '00000000-0000-4000-8000-0000000000f7';
const BASE = '/api/v1/admin/product-feeds';

describe('feed delivery configuration [contract]', () => {
  let h: BackendServerHandle;
  let feedId: string;

  beforeAll(async () => {
    // The credentials module refuses to process a secret field without a key,
    // and the harness deliberately does not load `backend/.env`. Every suite
    // that writes a credential sets one the same way (`pim_ergonode`).
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();

    const role = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/delivery_reader',
      ...ADMIN,
      payload: {
        code: 'delivery_reader',
        name: 'Delivery reader',
        permissions: ['product_feeds:read'],
      },
    });
    expect(role.statusCode).toBe(200);
    const roleId = (role.json() as { data: { id: string } }).data.id;

    const em = h.em();
    em.create(AdminUser, {
      id: READER_ID,
      email: 'delivery-reader@example.com',
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Delivery',
      lastName: 'Reader',
      adminRoleId: roleId,
      status: 'active',
    });
    await em.flush();
    ADMIN_COOKIES['stub-delivery-reader-session'] = { adminUserId: READER_ID };

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    const templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
    const channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;

    const created = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: 'Delivery contract feed',
        slug: 'delivery-contract-feed',
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'pl-PL',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(created.statusCode).toBe(201);
    feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;
  });

  afterAll(async () => {
    delete ADMIN_COOKIES['stub-delivery-reader-session'];
    await teardownBackendServer(h);
  });

  // -------------------------------------------------------------------------
  // The unconfigured state
  // -------------------------------------------------------------------------

  it('answers 200 with null for a feed that has no delivery — not a 404', async () => {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/${feedId}/delivery`, ...ADMIN });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown }).data).toBeNull();
  });

  it('refuses a connection test when nothing is configured', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `${BASE}/${feedId}/delivery/test`,
      ...ADMIN,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // AS-4 — the address is refused at write time, with a reason
  // -------------------------------------------------------------------------

  it('refuses an HTTP target pointing at the cloud metadata endpoint, naming it', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${feedId}/delivery`,
      ...ADMIN,
      payload: {
        enabled: true,
        protocol: 'http',
        requestUrl: 'https://169.254.169.254/latest/meta-data/',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { message: expect.stringContaining('169.254.169.254') },
    });
    // Nothing was written: a refused address must not leave a half-configuration.
    const em = h.em();
    em.clear();
    expect(await em.findOne(FeedDelivery, { productFeedId: feedId })).toBeNull();
  });

  it('refuses a plaintext http:// target (SR-4)', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${feedId}/delivery`,
      ...ADMIN,
      payload: { enabled: true, protocol: 'http', requestUrl: 'http://partner.example/ingest' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses active FTP rather than storing a mode the transport will not honour', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${feedId}/delivery`,
      ...ADMIN,
      payload: {
        enabled: true,
        protocol: 'ftp',
        host: 'ftp.partner.example',
        username: 'acme',
        password: 'hunter2',
        passiveMode: false,
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { message: string } }).error.message).toContain('passive');
  });

  // -------------------------------------------------------------------------
  // FR-107 / AS-5 — the secret is written once and never readable
  // -------------------------------------------------------------------------

  describe('once an SFTP target is saved', () => {
    beforeAll(async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
        payload: {
          enabled: true,
          protocol: 'sftp',
          host: 'sftp.partner.example',
          port: 2222,
          username: 'acme',
          password: 'first-password',
          directoryPath: '/incoming/feeds',
        },
      });
      expect(res.statusCode).toBe(200);
    });

    it('reads back the target with the password as a boolean, never a value', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Record<string, unknown> };
      expect(body.data).toMatchObject({
        protocol: 'sftp',
        host: 'sftp.partner.example',
        port: 2222,
        username: 'acme',
        directoryPath: '/incoming/feeds',
        enabled: true,
        passwordSet: true,
        privateKeySet: false,
      });
      expect(res.payload).not.toContain('first-password');
    });

    it('does not expose the password through the credentials endpoint either', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/credentials',
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      expect(res.payload).not.toContain('first-password');
    });

    it('keeps the stored password when a later save omits it (write-only semantics)', async () => {
      const before = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
      });
      const version = (before.json() as { data: { version: number } }).data.version;

      const res = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
        payload: {
          enabled: true,
          protocol: 'sftp',
          host: 'sftp.partner.example',
          port: 2222,
          username: 'acme',
          directoryPath: '/incoming/other',
          expectedVersion: version,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { directoryPath: string; passwordSet: boolean } };
      expect(body.data.directoryPath).toBe('/incoming/other');
      // Editing a directory path must not silently erase the password.
      expect(body.data.passwordSet).toBe(true);
    });

    it('rotates the password without either value becoming readable (AS-5)', async () => {
      const before = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
      });
      const version = (before.json() as { data: { version: number } }).data.version;

      const res = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
        payload: {
          enabled: true,
          protocol: 'sftp',
          host: 'sftp.partner.example',
          port: 2222,
          username: 'acme',
          password: 'second-password',
          directoryPath: '/incoming/other',
          expectedVersion: version,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.payload).not.toContain('second-password');

      const after = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
      });
      expect(after.payload).not.toContain('first-password');
      expect(after.payload).not.toContain('second-password');
    });

    it('keeps exactly one configuration row per feed (FR-100)', async () => {
      const em = h.em();
      em.clear();
      const rows = await em.find(FeedDelivery, { productFeedId: feedId });
      expect(rows).toHaveLength(1);
    });

    it('refuses a stale expectedVersion rather than overwriting another edit', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
        payload: {
          enabled: true,
          protocol: 'sftp',
          host: 'sftp.partner.example',
          username: 'acme',
          expectedVersion: 0,
        },
      });
      expect(res.statusCode).toBe(409);
    });

    // ---------------------------------------------------------------------
    // AS-7 — a read-only administrator
    // ---------------------------------------------------------------------

    it('lets a read-only administrator see the target and its history', async () => {
      const config = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery`,
        ...READER,
      });
      expect(config.statusCode).toBe(200);
      expect((config.json() as { data: { host: string } }).data.host).toBe(
        'sftp.partner.example',
      );

      const attempts = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery/attempts`,
        ...READER,
      });
      expect(attempts.statusCode).toBe(200);
    });

    it('refuses every write and the connection test for a read-only administrator', async () => {
      const save = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/${feedId}/delivery`,
        ...READER,
        payload: { enabled: false, protocol: 'sftp', host: 'x.example', username: 'a' },
      });
      expect(save.statusCode).toBe(403);

      const test = await h.app.inject({
        method: 'POST',
        url: `${BASE}/${feedId}/delivery/test`,
        ...READER,
        payload: {},
      });
      expect(test.statusCode).toBe(403);

      const removed = await h.app.inject({
        method: 'DELETE',
        url: `${BASE}/${feedId}/delivery`,
        ...READER,
      });
      expect(removed.statusCode).toBe(403);
    });

    // ---------------------------------------------------------------------
    // FR-106 — the connection test records an attempt either way
    // ---------------------------------------------------------------------

    it('records a failed attempt when the transport refuses, and returns the reason', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `${BASE}/${feedId}/delivery/test`,
        ...ADMIN,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: { ok: boolean; failureReason: string; attempt: { isTest: boolean; target: string } };
      };
      // The harness's transports refuse on purpose — no test in this repository
      // opens a socket — so the interesting assertion is that the refusal is
      // recorded as a test attempt with a redacted target.
      expect(body.data.ok).toBe(false);
      expect(body.data.failureReason).toBe('connection_failed');
      expect(body.data.attempt.isTest).toBe(true);
      expect(body.data.attempt.target).toBe('sftp://acme@sftp.partner.example:2222/incoming/other');

      const attempts = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery/attempts`,
        ...ADMIN,
      });
      const rows = (attempts.json() as { data: Array<{ isTest: boolean }> }).data;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.isTest).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Headers — FR-107's rule-driven split
  // -------------------------------------------------------------------------

  describe('an HTTP target with an authenticating header', () => {
    beforeAll(async () => {
      const before = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
      });
      const version = (before.json() as { data: { version: number } }).data.version;
      const res = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
        payload: {
          enabled: true,
          protocol: 'http',
          httpLabel: 'graphql',
          requestUrl: 'https://partner.example/graphql',
          headers: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Authorization', value: 'Bearer super-secret-token' },
          ],
          expectedVersion: version,
        },
      });
      expect(res.statusCode).toBe(200);
    });

    it('never stores the authenticating header in the configuration row', async () => {
      const em = h.em();
      em.clear();
      const row = await em.findOneOrFail(FeedDelivery, { productFeedId: feedId });
      expect(row.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.stringify(row.headers)).not.toContain('super-secret-token');
    });

    it('reads the header back by name with the value masked, never in plaintext', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
      });
      const body = res.json() as {
        data: { headers: Array<{ name: string; value: string | null; secret: boolean }> };
      };
      const auth = body.data.headers.find((header) => header.name === 'Authorization');
      expect(auth).toMatchObject({ secret: true, value: null, isSet: true });
      expect(res.payload).not.toContain('super-secret-token');
    });

    it('keeps the header when the operator submits it back as [redacted]', async () => {
      const before = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
      });
      const version = (before.json() as { data: { version: number } }).data.version;
      const res = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
        payload: {
          enabled: true,
          protocol: 'http',
          httpLabel: 'graphql',
          requestUrl: 'https://partner.example/graphql',
          headers: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Authorization', value: FEED_DELIVERY_REDACTED },
          ],
          expectedVersion: version,
        },
      });
      expect(res.statusCode).toBe(200);
      const headers = (
        res.json() as { data: { headers: Array<{ name: string; isSet: boolean }> } }
      ).data.headers;
      expect(headers.find((header) => header.name === 'Authorization')?.isSet).toBe(true);
    });

    it('refuses a duplicate header name rather than silently keeping one of them', async () => {
      const before = await h.app.inject({
        method: 'GET',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
      });
      const version = (before.json() as { data: { version: number } }).data.version;
      const res = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/${feedId}/delivery`,
        ...ADMIN,
        payload: {
          enabled: true,
          protocol: 'http',
          requestUrl: 'https://partner.example/graphql',
          headers: [
            { name: 'X-Shop', value: 'a' },
            { name: 'x-shop', value: 'b' },
          ],
          expectedVersion: version,
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Removal
  // -------------------------------------------------------------------------

  it('removes the configuration and its credential, and keeps the attempt history', async () => {
    const attemptsBefore = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/delivery/attempts`,
      ...ADMIN,
    });
    const countBefore = (attemptsBefore.json() as { data: unknown[] }).data.length;
    expect(countBefore).toBeGreaterThan(0);

    const res = await h.app.inject({
      method: 'DELETE',
      url: `${BASE}/${feedId}/delivery`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(204);

    const em = h.em();
    em.clear();
    expect(await em.findOne(FeedDelivery, { productFeedId: feedId })).toBeNull();
    expect(
      await em.findOne(CredentialConfiguration, { code: `product_feeds.delivery.${feedId}` }),
    ).toBeNull();

    // FR-105 — "did the partner get last month's file?" is still a fair
    // question after delivery has been switched off.
    const attemptsAfter = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/delivery/attempts`,
      ...ADMIN,
    });
    expect((attemptsAfter.json() as { data: unknown[] }).data).toHaveLength(countBefore);
  });
});
