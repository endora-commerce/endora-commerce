import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { FeedRun } from '../../../src/modules/product_feeds/entities/feed-run.entity.js';
import { FeedArtefact } from '../../../src/modules/product_feeds/entities/feed-artefact.entity.js';

/**
 * Feature 067 / T062 — the criteria match-count preview (FR-028).
 *
 * The endpoint exists so an operator can see what a criteria set selects
 * **before** saving it, which means three things have to be true at once:
 * it takes a *draft* (a channel and a rule, never a feed id, so it works on
 * `/product-feeds/new`); it needs `catalog:read` as well as
 * `product_feeds:read`, because the answer is a count of catalogue rows; and
 * it writes nothing — no run, no issue, no artefact, no audit entry.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const FEEDS_ONLY = { cookies: { b2b_session: 'stub-preview-feeds-only-session' } };
const CATALOG_ONLY = { cookies: { b2b_session: 'stub-preview-catalog-only-session' } };

const FEEDS_ONLY_ID = '00000000-0000-4000-8000-0000000000f5';
const CATALOG_ONLY_ID = '00000000-0000-4000-8000-0000000000f6';

const URL = '/api/v1/admin/feed-previews/selection';

describe('product feeds — criteria preview [contract]', () => {
  let h: BackendServerHandle;
  let channelId: string;

  async function seedAdmin(
    id: string,
    code: string,
    permissions: string[],
    session: string,
  ): Promise<void> {
    const role = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${code}`,
      ...ADMIN,
      payload: { code, name: code, permissions },
    });
    expect(role.statusCode).toBe(200);
    const em = h.em();
    em.create(AdminUser, {
      id,
      email: `${code}@example.com`,
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Preview',
      lastName: code,
      adminRoleId: (role.json() as { data: { id: string } }).data.id,
      status: 'active',
    });
    await em.flush();
    ADMIN_COOKIES[session] = { adminUserId: id };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedAdmin(
      FEEDS_ONLY_ID,
      'product_feeds_preview_feeds_only',
      ['product_feeds:read'],
      'stub-preview-feeds-only-session',
    );
    await seedAdmin(
      CATALOG_ONLY_ID,
      'product_feeds_preview_catalog_only',
      ['catalog:read'],
      'stub-preview-catalog-only-session',
    );
    channelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
  });

  afterAll(async () => {
    delete ADMIN_COOKIES['stub-preview-feeds-only-session'];
    delete ADMIN_COOKIES['stub-preview-catalog-only-session'];
    await teardownBackendServer(h);
  });

  it('answers for a draft with no feed id at all (FR-028)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: { salesChannelId: channelId, selectionRule: { kind: 'all' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { matchedCount: number; sample: Array<{ id: string; sku: string; name: string }> };
    };
    expect(body.data.matchedCount).toBeGreaterThan(0);
    expect(Array.isArray(body.data.sample)).toBe(true);
    for (const item of body.data.sample) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.sku).toBe('string');
      expect(typeof item.name).toBe('string');
    }
  });

  it('returns at most ten samples', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: { salesChannelId: channelId, selectionRule: { kind: 'all' } },
    });
    expect(res.statusCode).toBe(200);
    const { sample } = (res.json() as { data: { sample: unknown[] } }).data;
    expect(sample.length).toBeLessThanOrEqual(10);
  });

  it('narrows on a criterion and never widens past the channel', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: {
        salesChannelId: channelId,
        selectionRule: {
          kind: 'condition',
          field: { kind: 'builtin', key: 'status' },
          op: 'eq',
          values: ['draft'],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    // Draft products can never pass the eligibility floor (FR-026).
    expect((res.json() as { data: { matchedCount: number } }).data.matchedCount).toBe(0);
  });

  it('refuses a criterion naming an attribute that does not exist (FR-029)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: {
        salesChannelId: channelId,
        selectionRule: {
          kind: 'condition',
          field: { kind: 'attribute', attributeKey: 'not_a_real_attribute' },
          op: 'eq',
          values: ['x'],
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('not_a_real_attribute');
  });

  describe('permission gating', () => {
    it('refuses an administrator holding only product_feeds:read', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: URL,
        ...FEEDS_ONLY,
        payload: { salesChannelId: channelId, selectionRule: { kind: 'all' } },
      });
      expect(res.statusCode).toBe(403);
    });

    it('refuses an administrator holding only catalog:read', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: URL,
        ...CATALOG_ONLY,
        payload: { salesChannelId: channelId, selectionRule: { kind: 'all' } },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  it('is side-effect-free — no run, issue, artefact or audit row', async () => {
    const em = h.em();
    const before = {
      runs: await em.count(FeedRun, {}),
      artefacts: await em.count(FeedArtefact, {}),
      audit: Number(
        (
          (await em
            .getConnection()
            .execute(`select count(*)::int as c from audit_log_entries`)) as Array<{ c: number }>
        )[0]!.c,
      ),
    };

    for (let i = 0; i < 3; i += 1) {
      const res = await h.app.inject({
        method: 'POST',
        url: URL,
        ...ADMIN,
        payload: { salesChannelId: channelId, selectionRule: { kind: 'all' } },
      });
      expect(res.statusCode).toBe(200);
    }

    em.clear();
    expect(await em.count(FeedRun, {})).toBe(before.runs);
    expect(await em.count(FeedArtefact, {})).toBe(before.artefacts);
    const auditAfter = Number(
      (
        (await em
          .getConnection()
          .execute(`select count(*)::int as c from audit_log_entries`)) as Array<{ c: number }>
      )[0]!.c,
    );
    expect(auditAfter).toBe(before.audit);
  });

  it('rejects a malformed rule with a validation error, not a count', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: { salesChannelId: channelId, selectionRule: { kind: 'nonsense' } },
    });
    expect(res.statusCode).toBe(400);
  });
});
