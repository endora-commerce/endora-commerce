import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';
import { FeedArtefact, FeedRun, ProductFeed } from '../../helpers/package-entities.js';

/**
 * Feature 160 (FR-029), owner ruling 2026-10-23 — a feed whose pinned price
 * book does not apply at generation time **withdraws** its published file.
 *
 * The file carries prices that no longer apply, so it must not keep serving.
 * Such a run is not a failed run, and FR-035/FR-038's "the previous file keeps
 * serving" is a rule about failed runs: the run ends `withdrawn`, names the
 * publishability reason, and moves the publish pointer to nothing, so the
 * public URL answers exactly as it does for a feed that has never been
 * generated. The previous artefact is detached, not orphaned: its row and its
 * bytes stay together under FR-052's retention. When the book applies again,
 * the next run publishes as usual.
 *
 * A genuine failure — a configuration error, the skip threshold — still keeps
 * the last good file (FR-035, FR-038). Both paths are asserted here, on the
 * same kind of feed, so they cannot quietly converge.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const PUBLISHING_STATUSES = ['completed', 'completed_with_warnings'];
const PRODUCTS = [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID];

describe('product feeds — a pinned book that stops applying withdraws the published file [integration]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let retailChannelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    retailChannelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    const templates = await h.app.inject({ method: 'GET', url: '/api/v1/admin/feed-templates', ...ADMIN });
    templateId = (templates.json() as { data: Array<{ id: string; systemCode: string | null }> }).data.find(
      (t) => t.systemCode === 'google_merchant_v1',
    )!.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);

  const book = (amount: string, productIds: readonly string[] = PRODUCTS) =>
    seedPriceBookSql(h.em(), {
      name: `Pinned ${Math.random().toString(36).slice(2, 8)}`,
      audience: 'everyone',
      channelIds: [retailChannelId],
      rows: productIds.map((productId) => ({ productId, fixed: amount })),
    });

  async function createFeed(priceListId: string): Promise<{ id: string; token: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Withdrawal feed ${Math.random().toString(36).slice(2, 8)}`,
        slug: `withdrawal-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: retailChannelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        priceListId,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { feed: { id: string }; issuedToken: { token: string } } };
    return { id: body.data.feed.id, token: body.data.issuedToken.token };
  }

  const generate = (feedId: string, overrideSalesChannelId?: string) =>
    h.productFeeds.generation.generateNow(feedId, {
      trigger: 'scheduled',
      ...(overrideSalesChannelId ? { overrideSalesChannelId } : {}),
    });

  /** The public answer, as a provider sees it: status, the headers that matter, the body. */
  async function fetchPublic(token: string) {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/public/product-feeds/${token}` });
    return {
      statusCode: res.statusCode,
      contentType: res.headers['content-type'],
      cacheControl: res.headers['cache-control'],
      etag: res.headers['etag'],
      lastModified: res.headers['last-modified'],
      body: res.body,
    };
  }

  async function feedRow(feedId: string) {
    const em = h.em();
    em.clear();
    return em.findOneOrFail(ProductFeed, { id: feedId });
  }

  async function adminFeed(feedId: string) {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/product-feeds/${feedId}`, ...ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> & { feed?: Record<string, unknown> } }).data;
    return (data.feed ?? data) as {
      publishedArtefactId: string | null;
      pinnedPriceBookWarning: string | null;
      lastRun: { id: string; status: string; failureCode: string | null; withdrawalReason: string | null } | null;
    };
  }

  it('withdraws the file: the URL answers as for a never-generated feed, and the run names the reason', async () => {
    const bookId = await book('77.0000');
    const neverGenerated = await createFeed(bookId);
    const notGeneratedAnswer = await fetchPublic(neverGenerated.token);
    expect(notGeneratedAnswer.statusCode).toBe(404);

    const feed = await createFeed(bookId);
    const good = await generate(feed.id);
    expect(PUBLISHING_STATUSES).toContain(good.status);
    const served = await fetchPublic(feed.token);
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain('77.00 PLN');
    const publishedBefore = (await feedRow(feed.id)).publishedArtefactId;
    expect(publishedBefore).toBe(good.artefactId);

    await sql(`update "price_lists" set "status" = 'draft' where "id" = ?`, [bookId]);
    const withdrawn = await generate(feed.id);

    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.withdrawalReason).toBe('not_active');
    expect(withdrawn.failureCode ?? null).toBeNull();
    expect(withdrawn.artefactId ?? null).toBeNull();
    expect(withdrawn.consideredCount).toBe(0);
    expect(withdrawn.emittedCount).toBe(0);

    const row = await feedRow(feed.id);
    expect(row.publishedArtefactId ?? null).toBeNull();
    expect(row.currentRunId ?? null).toBeNull();
    expect(row.lastRunId).toBe(withdrawn.id);

    // Exactly the never-generated answer — nothing tells the provider a file existed.
    expect(await fetchPublic(feed.token)).toEqual(notGeneratedAnswer);

    // Detached, not orphaned: the earlier artefact keeps its row (and so its
    // bytes) for the run history and FR-052's retention, and the withdrawing
    // run produced none of its own.
    const artefacts = await h.em().find(FeedArtefact, { productFeedId: feed.id });
    expect(artefacts.map((a) => a.id)).toEqual([publishedBefore]);

    const admin = await adminFeed(feed.id);
    expect(admin.publishedArtefactId).toBeNull();
    expect(admin.pinnedPriceBookWarning).toBe('not_active');
    expect(admin.lastRun).toMatchObject({ id: withdrawn.id, status: 'withdrawn', failureCode: null, withdrawalReason: 'not_active' });

    const runDetail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/product-feeds/${feed.id}/runs/${withdrawn.id}`,
      ...ADMIN,
    });
    expect(runDetail.statusCode, runDetail.body).toBe(200);
    expect((runDetail.json() as { data: Record<string, unknown> }).data).toMatchObject({
      status: 'withdrawn',
      withdrawalReason: 'not_active',
      failureCode: null,
      artefact: null,
    });

    // The book applies again: the next run publishes as usual.
    await sql(`update "price_lists" set "status" = 'active' where "id" = ?`, [bookId]);
    const again = await generate(feed.id);
    expect(PUBLISHING_STATUSES).toContain(again.status);
    expect(again.withdrawalReason ?? null).toBeNull();
    expect((await feedRow(feed.id)).publishedArtefactId).toBe(again.artefactId);
    const servedAgain = await fetchPublic(feed.token);
    expect(servedAgain.statusCode).toBe(200);
    expect(servedAgain.body).toContain('77.00 PLN');
    expect((await adminFeed(feed.id)).pinnedPriceBookWarning).toBeNull();
  });

  it('names the reason the book does not apply — here, its window has closed', async () => {
    const bookId = await book('66.0000');
    const feed = await createFeed(bookId);
    expect(PUBLISHING_STATUSES).toContain((await generate(feed.id)).status);

    await sql(
      `update "price_lists" set "starts_at" = now() - interval '2 days', "ends_at" = now() - interval '1 day' where "id" = ?`,
      [bookId],
    );
    const withdrawn = await generate(feed.id);
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.withdrawalReason).toBe('outside_schedule');
    expect((await fetchPublic(feed.token)).statusCode).toBe(404);
  });

  it('a withdrawal on a feed that never published leaves it unpublished', async () => {
    const bookId = await book('55.0000');
    await sql(`update "price_lists" set "status" = 'draft' where "id" = ?`, [bookId]);
    const feed = await createFeed(bookId);
    const run = await generate(feed.id);
    expect(run.status).toBe('withdrawn');
    expect(run.withdrawalReason).toBe('not_active');
    expect((await feedRow(feed.id)).publishedArtefactId ?? null).toBeNull();
    expect(await h.em().find(FeedArtefact, { productFeedId: feed.id })).toHaveLength(0);
  });

  it('a genuine failure keeps the last good file serving (FR-035, FR-038)', async () => {
    const bookId = await book('88.0000');
    const feed = await createFeed(bookId);
    const good = await generate(feed.id);
    expect(PUBLISHING_STATUSES).toContain(good.status);
    const served = await fetchPublic(feed.token);
    expect(served.statusCode).toBe(200);

    // A configuration failure (FR-027).
    const channelGone = await generate(feed.id, '00000000-0000-4000-8000-0000000000cc');
    expect(channelGone.status).toBe('failed');
    expect(channelGone.failureCode).toBe('channel_unavailable');
    expect(channelGone.withdrawalReason ?? null).toBeNull();
    expect((await feedRow(feed.id)).publishedArtefactId).toBe(good.artefactId);
    expect(await fetchPublic(feed.token)).toEqual(served);

    // The skip threshold for a reason other than the pinned book: the book
    // still applies, it just prices one product of three.
    const narrowBookId = await book('99.0000', [SEED_PRODUCT_101_ID]);
    await sql(`update "product_feeds" set "price_list_id" = ? where "id" = ?`, [narrowBookId, feed.id]);
    const overThreshold = await generate(feed.id);
    expect(overThreshold.status).toBe('failed');
    expect(overThreshold.failureCode).toBe('skip_threshold_exceeded');
    expect(overThreshold.withdrawalReason ?? null).toBeNull();
    expect((await feedRow(feed.id)).publishedArtefactId).toBe(good.artefactId);
    expect(await fetchPublic(feed.token)).toEqual(served);

    const stored = await h.em().findOneOrFail(FeedRun, { id: overThreshold.id });
    expect(stored.status).toBe('failed');
  });
});
