import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  feedTaxonomyCheckSchema,
  feedTaxonomyRevisionImpactResponseSchema,
  feedTaxonomyRevisionSchema,
  PRODUCT_FEED_SETTING_CODES,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  googleTaxonomyFile,
  ScriptedTaxonomyFetcher,
} from '../../helpers/taxonomy-fixtures.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { FeedTaxonomy, FeedTaxonomyCheck } from '../../helpers/package-entities.js';

/**
 * Feature 067 Phase 11 / T127 — the five revision routes (FR-096, FR-099).
 *
 * The permission split is the point: reading a revision and its impact is
 * `product_feeds:read`, because a read-only administrator evaluating whether to
 * adopt a taxonomy is a real and useful role (US7 AS9). Promoting one, and
 * asking the platform to make an outbound request, are `:write`.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const READER = { cookies: { b2b_session: 'stub-revision-reader-session' } };
const READER_ID = '00000000-0000-4000-8000-0000000000f5';
const BASE = '/api/v1/admin/feed-taxonomies';
const ACTOR = { actorAdminUserId: null } as const;

const fetcher = new ScriptedTaxonomyFetcher();

describe('feed taxonomy revisions [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ taxonomySourceFetcher: fetcher });

    const role = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/product_feeds_revision_reader',
      ...ADMIN,
      payload: {
        code: 'product_feeds_revision_reader',
        name: 'Feed revision reader',
        permissions: ['product_feeds:read'],
      },
    });
    expect(role.statusCode).toBe(200);

    const em = h.em();
    em.create(AdminUser, {
      id: READER_ID,
      email: 'revision-reader@example.com',
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Revision',
      lastName: 'Reader',
      adminRoleId: (role.json() as { data: { id: string } }).data.id,
      status: 'active',
    });
    await em.flush();
    ADMIN_COOKIES['stub-revision-reader-session'] = { adminUserId: READER_ID };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES['stub-revision-reader-session'];
    await teardownBackendServer(h);
  });

  async function setEnabled(value: boolean): Promise<void> {
    await h.settings.adminService.setValueForAllChannels(
      PRODUCT_FEED_SETTING_CODES.TAXONOMY_FETCH_ENABLED,
      value,
      null,
      ACTOR,
    );
  }

  async function clearTaxonomies(): Promise<void> {
    const em = h.em();
    await em.getConnection().execute('delete from "product_feed_taxonomy_checks"');
    await em.getConnection().execute('delete from "product_feed_taxonomy_mappings"');
    await em.getConnection().execute('update "product_feed_templates" set "taxonomy_id" = null');
    await em.getConnection().execute('delete from "product_feed_taxonomies"');
    em.clear();
  }

  beforeEach(async () => {
    fetcher.reset();
    fetcher.serve('google', googleTaxonomyFile({ label: '2026-01-01' }));
    await clearTaxonomies();
    await setEnabled(true);
  });

  afterEach(async () => {
    await setEnabled(false);
    await clearTaxonomies();
  });

  async function installRevision(label: string): Promise<string> {
    fetcher.reset();
    fetcher.serve('google', googleTaxonomyFile({ label }));
    const result = await h.productFeeds.taxonomyRefresh.runCheck({
      providerCode: 'google_merchant',
      trigger: 'scheduled',
    });
    expect(result.outcome).toBe('installed');
    return result.installedTaxonomyId!;
  }

  describe('GET /revisions', () => {
    it('returns every retained revision in the published shape (FR-078)', async () => {
      await installRevision('2026-01-01');
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/revisions?providerCode=google_merchant`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: unknown[] };
      expect(body.data.length).toBeGreaterThan(0);
      for (const row of body.data) {
        expect(feedTaxonomyRevisionSchema.safeParse(row).success).toBe(true);
      }
    });

    it('is `product_feeds:read` — a read-only administrator can see it', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/revisions?providerCode=google_merchant`,
        ...READER,
      });
      expect(res.statusCode).toBe(200);
    });

    it('refuses an unknown provider rather than answering an empty list', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/revisions?providerCode=amazon`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /revisions/:taxonomyId/impact', () => {
    it('answers the published shape and performs zero writes (FR-094)', async () => {
      const taxonomyId = await installRevision('2026-01-01');
      const em = h.em();
      const auditBefore = await em.count(AuditLogEntry, {});
      const revisionsBefore = await em.count(FeedTaxonomy, {});
      em.clear();

      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/revisions/${taxonomyId}/impact`,
        ...READER,
      });
      expect(res.statusCode).toBe(200);
      expect(feedTaxonomyRevisionImpactResponseSchema.safeParse(res.json()).success).toBe(true);

      const after = h.em();
      expect(await after.count(AuditLogEntry, {})).toBe(auditBefore);
      expect(await after.count(FeedTaxonomy, {})).toBe(revisionsBefore);
    });

    it('answers 404 for a revision that does not exist', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/revisions/00000000-0000-4000-8000-00000000dead/impact`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /revisions/:taxonomyId/promote', () => {
    it('is `product_feeds:write` — a read-only administrator is refused', async () => {
      const taxonomyId = await installRevision('2026-01-01');
      const res = await h.app.inject({
        method: 'POST',
        url: `${BASE}/revisions/${taxonomyId}/promote`,
        ...READER,
        payload: { expectedStaleMappingCount: 0 },
      });
      expect(res.statusCode).toBe(403);
      expect(
        (await h.em().findOneOrFail(FeedTaxonomy, { id: taxonomyId })).isCurrent,
      ).toBe(false);
    });

    it('requires the acknowledgement in the body', async () => {
      const taxonomyId = await installRevision('2026-01-01');
      const res = await h.app.inject({
        method: 'POST',
        url: `${BASE}/revisions/${taxonomyId}/promote`,
        ...ADMIN,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('promotes and answers the revision, now current', async () => {
      const taxonomyId = await installRevision('2026-01-01');
      const res = await h.app.inject({
        method: 'POST',
        url: `${BASE}/revisions/${taxonomyId}/promote`,
        ...ADMIN,
        payload: { expectedStaleMappingCount: 0 },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: unknown };
      const parsed = feedTaxonomyRevisionSchema.safeParse(body.data);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.isCurrent).toBe(true);
    });
  });

  describe('POST /checks', () => {
    it('is `product_feeds:write` — a read-only administrator cannot ask for outbound traffic', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `${BASE}/checks`,
        ...READER,
        payload: { providerCode: 'google_merchant' },
      });
      expect(res.statusCode).toBe(403);
      expect(fetcher.requests).toEqual([]);
    });

    it('answers 202 with the check row and audits `product_feeds.taxonomy_check.start`', async () => {
      const before = await h
        .em()
        .count(AuditLogEntry, { action: 'product_feeds.taxonomy_check.start' });

      const res = await h.app.inject({
        method: 'POST',
        url: `${BASE}/checks`,
        ...ADMIN,
        payload: { providerCode: 'google_merchant' },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json() as { data: unknown };
      const parsed = feedTaxonomyCheckSchema.safeParse(body.data);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.trigger).toBe('manual');

      const em = h.em();
      expect(
        await em.count(AuditLogEntry, { action: 'product_feeds.taxonomy_check.start' }),
      ).toBe(before + 1);
      // Addressable by the check it created — not `pending`.
      const entry = await em.findOneOrFail(AuditLogEntry, {
        action: 'product_feeds.taxonomy_check.start',
        objectId: parsed.success ? parsed.data.id : '',
      });
      expect(entry.objectType).toBe('product_feed_taxonomy_check');
    });

    it('records no audit entry for a scheduled check (FR-060)', async () => {
      const before = await h
        .em()
        .count(AuditLogEntry, { action: 'product_feeds.taxonomy_check.start' });
      await h.productFeeds.taxonomyRefresh.runCheck({
        providerCode: 'google_merchant',
        trigger: 'scheduled',
      });
      expect(
        await h.em().count(AuditLogEntry, { action: 'product_feeds.taxonomy_check.start' }),
      ).toBe(before);
    });

    it('refuses an overlapping check for the same provider (FR-096)', async () => {
      // The route opens the row and hands the work to the worker, so a second
      // request while the first is in flight would ask the provider for the
      // same file twice.
      const first = await h.app.inject({
        method: 'POST',
        url: `${BASE}/checks`,
        ...ADMIN,
        payload: { providerCode: 'google_merchant' },
      });
      expect(first.statusCode).toBe(202);

      const second = await h.app.inject({
        method: 'POST',
        url: `${BASE}/checks`,
        ...ADMIN,
        payload: { providerCode: 'google_merchant' },
      });
      expect(second.statusCode).toBe(409);
      const body = second.json() as { error: { details?: { reason?: string } } };
      expect(body.error.details?.reason).toBe('taxonomy_check_in_progress');

      // The other provider is unaffected — the predicate is per provider.
      const other = await h.app.inject({
        method: 'POST',
        url: `${BASE}/checks`,
        ...ADMIN,
        payload: { providerCode: 'meta' },
      });
      expect(other.statusCode).toBe(202);
    });
  });

  describe('GET /checks', () => {
    it('lists the history in the published shape, `product_feeds:read`', async () => {
      await installRevision('2026-01-01');
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/checks?providerCode=google_merchant`,
        ...READER,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: unknown[] };
      expect(body.data.length).toBeGreaterThan(0);
      for (const row of body.data) {
        expect(feedTaxonomyCheckSchema.safeParse(row).success).toBe(true);
      }
    });

    it('caps the history it will return per provider, whatever the caller asks for', async () => {
      const em = h.em();
      for (let index = 0; index < 25; index += 1) {
        em.create(FeedTaxonomyCheck, {
          providerCode: 'google_merchant',
          trigger: 'scheduled',
          startedAt: new Date(Date.now() - index * 1000),
          finishedAt: new Date(),
          outcome: 'unchanged',
        });
      }
      await em.flush();

      // Twenty weekly checks is roughly five months of history, which is
      // longer than any question anyone asks of it, and the table can never
      // become a growth surface — so a caller cannot page past the cap.
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/checks?providerCode=google_merchant&limit=50`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: unknown[] }).data.length).toBeLessThanOrEqual(20);

      const capped = await h.app.inject({
        method: 'GET',
        url: `${BASE}/checks?providerCode=google_merchant`,
        ...ADMIN,
      });
      expect((capped.json() as { data: unknown[] }).data.length).toBeLessThanOrEqual(20);
    });
  });

  it('adds no permission code — the existing read/write pair gates every route (FR-099)', async () => {
    const { REGISTERED_MANIFESTS } = await import(
      '../../../src/modules/_lifecycle/registered-manifests.js'
    );
    const { listAssignablePermissionCodes } = await import(
      '../../../src/modules/admin_roles/services/permission-catalogue.service.js'
    );
    const codes = listAssignablePermissionCodes(REGISTERED_MANIFESTS).filter((code) =>
      code.startsWith('product_feeds'),
    );
    expect(codes.sort()).toEqual(['product_feeds:read', 'product_feeds:write']);
  });
});
