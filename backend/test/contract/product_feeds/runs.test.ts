import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';

/**
 * Feature 067 / T103 — the run, issue and artefact surface
 * (`contracts/admin-runs.md` §1; FR-051, FR-053, FR-054).
 *
 * Two things are pinned here that nothing else pins:
 *
 *  - **every documented counter and timestamp is present and correct** on both
 *    the list and the detail endpoint, and `templateSnapshot` appears on the
 *    detail only — an operator has to be able to see which field set produced a
 *    historical file (FR-076);
 *  - **downloads require `product_feeds:write`, not `:read`** (FR-051, US6
 *    AS-7). An artefact carries resolved prices for the whole selection, so a
 *    read-only operator may see that a run succeeded and why items were
 *    skipped, without being handed the priced catalogue. The issue list is
 *    `:read`; the issue *export* is `:write` for the same reason as the
 *    artefact — it names SKUs and prices in bulk.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const READER = { cookies: { b2b_session: 'stub-run-reader-session' } };
const READER_ID = '00000000-0000-4000-8000-0000000000e5';

const BASE = '/api/v1/admin/product-feeds';

interface RunBody {
  id: string;
  status: string;
  trigger: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  consideredCount: number;
  emittedCount: number;
  skippedCount: number;
  warningCount: number;
  failureCode: string | null;
  failureDetail: string | null;
  skipReason: string | null;
  issueOverflow: boolean;
  productFeedId: string;
  triggeredByAdminUserId: string | null;
  templateSnapshot?: unknown;
  artefact: {
    id: string;
    byteSize: number;
    itemCount: number;
    contentType: string;
    producedAt: string;
    isPublished: boolean;
  } | null;
}

describe('feed runs, issues and artefacts — admin [contract]', () => {
  let h: BackendServerHandle;
  let feedId: string;
  let runId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    await seedFeedPrices(em, { code: 'feed_runs_contract' });

    const role = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/product_feeds_run_reader',
      ...ADMIN,
      payload: {
        code: 'product_feeds_run_reader',
        name: 'Product feeds run reader',
        permissions: ['product_feeds:read'],
      },
    });
    expect(role.statusCode).toBe(200);
    em.create(AdminUser, {
      id: READER_ID,
      email: 'run-reader@example.com',
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Run',
      lastName: 'Reader',
      adminRoleId: (role.json() as { data: { id: string } }).data.id,
      status: 'active',
    });
    await em.flush();
    ADMIN_COOKIES['stub-run-reader-session'] = { adminUserId: READER_ID };

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
        name: 'Runs contract feed',
        slug: `runs-contract-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(created.statusCode).toBe(201);
    feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;

    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    runId = run.id;
  });

  afterAll(async () => {
    delete ADMIN_COOKIES['stub-run-reader-session'];
    await teardownBackendServer(h);
  });

  // -------------------------------------------------------------------------
  // Run list and detail (FR-053)
  // -------------------------------------------------------------------------

  it('lists runs with every documented counter and timestamp', async () => {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/${feedId}/runs`, ...ADMIN });
    expect(res.statusCode).toBe(200);
    const [row] = (res.json() as { data: RunBody[] }).data;
    expect(row).toBeTruthy();
    for (const key of [
      'id',
      'status',
      'trigger',
      'startedAt',
      'finishedAt',
      'createdAt',
      'durationMs',
      'consideredCount',
      'emittedCount',
      'skippedCount',
      'warningCount',
      'failureCode',
      'failureDetail',
      'skipReason',
      'issueOverflow',
      'artefact',
    ]) {
      expect(row, key).toHaveProperty(key);
    }
    expect(row!.trigger).toBe('manual');
    expect(row!.emittedCount).toBeGreaterThan(0);
    expect(row!.durationMs).not.toBeNull();
    // The heavy snapshot stays off the list — it is per-run field JSON.
    expect(row).not.toHaveProperty('templateSnapshot');
  });

  it('returns the template snapshot on the detail endpoint (FR-076)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${runId}`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const run = (res.json() as { data: RunBody }).data;
    expect(run.id).toBe(runId);
    expect(run.productFeedId).toBe(feedId);
    expect(run.templateSnapshot).toBeTruthy();
    expect(run.artefact).not.toBeNull();
    expect(run.artefact?.isPublished).toBe(true);
    expect(run.artefact?.byteSize).toBeGreaterThan(0);
  });

  it('404s a run that belongs to another feed', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/00000000-0000-4000-8000-00000000dead`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Issues (FR-054)
  // -------------------------------------------------------------------------

  it('lists the run issues and filters them by severity and reason', async () => {
    const all = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${runId}/issues`,
      ...ADMIN,
    });
    expect(all.statusCode).toBe(200);
    const issues = (
      all.json() as { data: Array<{ severity: string; reason: string; sku: string | null }> }
    ).data;
    // The seeded catalogue carries no images, so the shipped Google template
    // raises `missing_image` per item — a warning, never a skip.
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(issues.map((issue) => issue.reason)).toContain('missing_image');
    expect(issues.every((issue) => issue.sku !== null)).toBe(true);

    const bySeverity = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${runId}/issues?severity=skip`,
      ...ADMIN,
    });
    expect(bySeverity.statusCode).toBe(200);
    expect((bySeverity.json() as { data: unknown[] }).data).toHaveLength(0);

    const byReason = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${runId}/issues?reason=missing_image`,
      ...ADMIN,
    });
    expect(byReason.statusCode).toBe(200);
    const filtered = (byReason.json() as { data: Array<{ reason: string }> }).data;
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((issue) => issue.reason === 'missing_image')).toBe(true);
  });

  it('refuses an unknown filter value rather than silently ignoring it', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${runId}/issues?severity=whatever`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(400);
  });

  it('exports the issue list as a CSV file', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${runId}/issues/export`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(String(res.headers['content-disposition'])).toContain('.csv');
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe('severity,reason,sku,productId,variantId,outputName,detail');
    expect(lines.length).toBeGreaterThan(1);
    expect(res.body).toContain('missing_image');
  });

  // -------------------------------------------------------------------------
  // Downloads need `:write` (FR-051, US6 AS-7)
  // -------------------------------------------------------------------------

  it('lets a read-only administrator read runs and issues', async () => {
    for (const url of [
      `${BASE}/${feedId}/runs`,
      `${BASE}/${feedId}/runs/${runId}`,
      `${BASE}/${feedId}/runs/${runId}/issues`,
    ]) {
      const res = await h.app.inject({ method: 'GET', url, ...READER });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('refuses every download for a read-only administrator', async () => {
    for (const url of [
      `${BASE}/${feedId}/artefact`,
      `${BASE}/${feedId}/runs/${runId}/artefact`,
      `${BASE}/${feedId}/runs/${runId}/issues/export`,
    ]) {
      const res = await h.app.inject({ method: 'GET', url, ...READER });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it('serves a specific run’s artefact, not only the published one', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${runId}/artefact`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('private');
    const published = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(published.statusCode).toBe(200);
    expect(res.body).toBe(published.body);
  });

  it('404s the artefact of a run that produced none', async () => {
    // A `skipped` run never writes an object, so its download must be a plain
    // not-found rather than a stream of the previous run's file.
    const skipped = await h.em().getConnection().execute(
      `insert into "product_feed_runs" ("id", "product_feed_id", "trigger", "status", "skip_reason", "created_at")
       values (gen_random_uuid(), ?, 'scheduled', 'skipped', 'already_running', now())
       returning "id"`,
      [feedId],
    );
    const skippedId = (skipped as Array<{ id: string }>)[0]!.id;
    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${skippedId}/artefact`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(404);
  });
});
