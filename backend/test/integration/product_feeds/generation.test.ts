import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { PriceList } from '../../../src/modules/price_lists/entities/price-list.entity.js';
import { PriceListProduct } from '../../../src/modules/price_lists/entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../../../src/modules/price_lists/entities/price-list-price-bracket.entity.js';
import { ProductFeed } from '../../../src/modules/product_feeds/entities/product-feed.entity.js';
import { FeedRun } from '../../../src/modules/product_feeds/entities/feed-run.entity.js';
import { FeedArtefact } from '../../../src/modules/product_feeds/entities/feed-artefact.entity.js';
import { setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';

/**
 * Feature 067 / T027 — generation against a real database
 * (FR-020, FR-026, FR-027, FR-035).
 *
 * Three things are proved here that no unit test can:
 *  - the **eligibility floor** is server-side and not expressible in a rule:
 *    draft, inactive, archived, non-public and other-channel products are
 *    absent no matter what the operator asked for (FR-026, Principle XII);
 *  - prices come from the named list when there is one, and from the anonymous
 *    channel resolution when there is not (FR-020);
 *  - an artefact is published **only** on a successful run (FR-035, FR-039).
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/** The two statuses that move the publish pointer (FR-035). */
const PUBLISHING_STATUSES = ['completed', 'completed_with_warnings'];

describe('product feed generation [integration]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let retailChannelId: string;
  let vipChannelId: string;
  let namedListId: string;

  const DRAFT_ID = '00000000-0000-4000-8000-0000000f0001';
  const INACTIVE_ID = '00000000-0000-4000-8000-0000000f0002';
  const ARCHIVED_ID = '00000000-0000-4000-8000-0000000f0003';
  const PRIVATE_ID = '00000000-0000-4000-8000-0000000f0004';
  const VIP_ONLY_ID = '00000000-0000-4000-8000-0000000f0005';

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    await setChannelStorefrontUrl(h, 'pl_b2b_vip');
    const em = h.em();

    const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    const vip = await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' });
    retailChannelId = retail.id;
    vipChannelId = vip.id;

    // --- Products that must never appear, whatever the selection rule says ---
    const ineligible = [
      { id: DRAFT_ID, sku: 'FEED-DRAFT', slug: 'feed-draft', status: 'draft' as const },
      { id: INACTIVE_ID, sku: 'FEED-INACTIVE', slug: 'feed-inactive', status: 'inactive' as const },
      { id: ARCHIVED_ID, sku: 'FEED-ARCHIVED', slug: 'feed-archived', status: 'active' as const },
      { id: PRIVATE_ID, sku: 'FEED-PRIVATE', slug: 'feed-private', status: 'active' as const },
      { id: VIP_ONLY_ID, sku: 'FEED-VIPONLY', slug: 'feed-viponly', status: 'active' as const },
    ];
    for (const row of ineligible) {
      em.create(Product, {
        id: row.id,
        sku: row.sku,
        slug: row.slug,
        type: 'simple',
        status: row.status,
        name: { 'en-US': row.sku },
        description: { 'en-US': row.sku },
        visibility: row.id === PRIVATE_ID ? 'logged_in_only' : 'public',
        ...(row.id === ARCHIVED_ID ? { archivedAt: new Date() } : {}),
      });
    }
    await em.flush();

    const conn = em.getConnection();
    // Everything except the VIP-only product belongs to the retail channel, so
    // "absent" cannot be explained away by missing membership.
    for (const id of [DRAFT_ID, INACTIVE_ID, ARCHIVED_ID, PRIVATE_ID]) {
      await conn.execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?,?)`,
        [retailChannelId, id],
      );
    }
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?)`,
      [vipChannelId, VIP_ONLY_ID],
    );

    // --- Price lists -------------------------------------------------------
    // The anonymous/default list every channel resolves to when a feed names
    // none, and a named list a feed can point at verbatim (FR-020).
    //
    // Catch-all, *not* `isSystem` (issue #50): what makes this the list the
    // anonymous resolution lands on is `{kind:'all'}` plus `status: 'active'`,
    // and the flag was never read on this path. It marks the platform's one
    // seeded `Default` row, which is now a database singleton — a fixture
    // claiming it left a second system row behind for the next file to trip on.
    const defaultList = em.create(PriceList, {
      code: 'feed_default',
      name: 'Feed default list',
      currency: 'PLN',
      type: 'base',
      status: 'active',
      applicationRule: { kind: 'all' },
      modifiedAt: new Date(),
    });
    const namedList = em.create(PriceList, {
      code: 'feed_named',
      name: 'Feed named list',
      currency: 'PLN',
      type: 'base',
      status: 'active',
      // Deliberately unreachable by the anonymous resolution: it names an
      // organization nobody is. A feed that points AT this list must still use
      // it verbatim (FR-020), which is precisely the distinction under test.
      applicationRule: {
        kind: 'criterion',
        type: 'organization',
        values: ['00000000-0000-4000-8000-0000000000ff'],
      },
      modifiedAt: new Date(),
    });
    await em.persistAndFlush([defaultList, namedList]);
    namedListId = namedList.id;

    const priced = [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID, VIP_ONLY_ID];
    // Assignments first, then brackets: the bracket table cascades off
    // `price_list_products`, and MikroORM batches inserts by entity type.
    for (const productId of priced) {
      for (const list of [defaultList, namedList]) {
        em.create(PriceListProduct, { priceListId: list.id, productId });
      }
    }
    await em.flush();
    for (const productId of priced) {
      for (const [list, amount] of [
        [defaultList, '100.0000'],
        [namedList, '55.0000'],
      ] as const) {
        em.create(PriceListPriceBracket, {
          priceListId: list.id,
          productId,
          currencyCode: 'PLN',
          minQuantity: 1,
          amount,
        });
      }
    }
    await em.flush();

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createFeed(over: Record<string, unknown> = {}): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Feed ${Math.random().toString(36).slice(2, 8)}`,
        slug: `feed-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: retailChannelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { feed: { id: string } } }).data.feed.id;
  }

  async function readArtefact(feedId: string): Promise<string> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/product-feeds/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  describe('the eligibility floor (FR-026, FR-027)', () => {
    it('emits only active, public, non-archived products of the feed’s channel', async () => {
      const feedId = await createFeed();
      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      // The seeded catalogue carries no images, so the shipped Google template
      // legitimately raises a `missing_image` warning per item — a publishing
      // status, not a failure.
      expect(PUBLISHING_STATUSES).toContain(run.status);
      expect(run.emittedCount).toBe(3);

      const document = await readArtefact(feedId);
      for (const sku of ['EXAMPLE-SIMPLE-001', 'EXAMPLE-BLUE-002', 'EXAMPLE-LARGE-003']) {
        expect(document).toContain(sku);
      }
      for (const sku of [
        'FEED-DRAFT',
        'FEED-INACTIVE',
        'FEED-ARCHIVED',
        'FEED-PRIVATE',
        'FEED-VIPONLY',
      ]) {
        expect(document, `${sku} must not be in the feed`).not.toContain(sku);
      }
    });

    it('never widens to the whole catalogue for a different channel', async () => {
      const feedId = await createFeed({ salesChannelId: vipChannelId });
      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(PUBLISHING_STATUSES).toContain(run.status);
      const document = await readArtefact(feedId);
      // The VIP channel carries the three seeded products plus FEED-VIPONLY.
      expect(document).toContain('FEED-VIPONLY');
      expect(run.emittedCount).toBe(4);
    });

    it('fails the run closed when the channel no longer exists (FR-027)', async () => {
      const feedId = await createFeed();
      const em = h.em();
      const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
      feed.salesChannelId = '00000000-0000-4000-8000-0000000000cc';
      // The FK would refuse a persisted write, so drive the service with the
      // unresolvable id directly — the point is that generation must not
      // interpret "no channel" as "every product".
      const run = await h.productFeeds.generation.generateNow(feedId, {
        trigger: 'manual',
        overrideSalesChannelId: '00000000-0000-4000-8000-0000000000cc',
      });
      em.clear();
      expect(run.status).toBe('failed');
      expect(run.failureCode).toBe('channel_unavailable');
      const artefacts = await h.em().find(FeedArtefact, { productFeedId: feedId });
      expect(artefacts).toHaveLength(0);
    });
  });

  describe('prices (FR-020)', () => {
    it('uses the named price list verbatim when the feed names one', async () => {
      const feedId = await createFeed({ priceListId: namedListId });
      await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      const document = await readArtefact(feedId);
      expect(document).toContain('55.00 PLN');
      expect(document).not.toContain('100.00 PLN');
    });

    it('falls back to the anonymous channel resolution when no list is named', async () => {
      const feedId = await createFeed();
      await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      const document = await readArtefact(feedId);
      expect(document).toContain('100.00 PLN');
    });

    it('applies the tax country on a gross feed (FR-044)', async () => {
      const feedId = await createFeed({
        priceListId: namedListId,
        pricePresentation: 'gross',
        taxCountry: 'PL',
      });
      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(run.emittedCount).toBe(3);
      const document = await readArtefact(feedId);
      // No tax rule is seeded, so the rate resolves to `none`: the price stays
      // net-valued but every item carries the warning rather than pretending.
      expect(document).toContain('55.00 PLN');
      expect(run.warningCount).toBeGreaterThan(0);
    });
  });

  describe('run rows and publication (FR-035, FR-039)', () => {
    it('records the counters and publishes exactly one artefact', async () => {
      const feedId = await createFeed();
      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      const em = h.em();
      em.clear();

      const stored = await em.findOneOrFail(FeedRun, { id: run.id });
      expect(PUBLISHING_STATUSES).toContain(stored.status);
      expect(stored.consideredCount).toBe(3);
      expect(stored.emittedCount).toBe(3);
      expect(stored.skippedCount).toBe(0);
      expect(stored.startedAt).not.toBeNull();
      expect(stored.finishedAt).not.toBeNull();
      expect(stored.durationMs).not.toBeNull();
      expect(stored.templateSnapshot).toBeTruthy();

      const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.publishedArtefactId).toBe(stored.artefactId);
      expect(feed.currentRunId ?? null).toBeNull();
      expect(feed.lastRunId).toBe(stored.id);

      const artefact = await em.findOneOrFail(FeedArtefact, { id: String(stored.artefactId) });
      expect(artefact.itemCount).toBe(3);
      expect(Number(artefact.byteSize)).toBeGreaterThan(0);
      expect(artefact.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does not replace a good artefact with an empty run (FR-039)', async () => {
      const feedId = await createFeed();
      const good = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(PUBLISHING_STATUSES).toContain(good.status);
      const publishedBefore = (await h.em().findOneOrFail(ProductFeed, { id: feedId }))
        .publishedArtefactId;

      // Narrow the selection to nothing at all.
      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
        payload: {
          selectionRule: {
            kind: 'condition',
            field: { kind: 'builtin', key: 'brand' },
            op: 'eq',
            values: ['no-such-brand-at-all'],
          },
        },
      });
      const empty = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(empty.status).toBe('empty');
      expect(empty.emittedCount).toBe(0);

      h.em().clear();
      const feed = await h.em().findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.publishedArtefactId).toBe(publishedBefore);
      expect(feed.currentRunId ?? null).toBeNull();
    });

    it('records the run against the acting administrator for a manual trigger', async () => {
      const feedId = await createFeed();
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/product-feeds/${feedId}/generate`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(202);
      const runId = (res.json() as { data: { runId: string } }).data.runId;
      const stored = await h.em().findOneOrFail(FeedRun, { id: runId });
      expect(stored.trigger).toBe('manual');
      expect(stored.triggeredByAdminUserId).not.toBeNull();
    });
  });

  it('carries no organization dimension anywhere (Principle XI)', async () => {
    const conn = h.em().getConnection();
    const columns = (await conn.execute(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name like 'product_feed%'`,
    )) as Array<{ table_name: string; column_name: string }>;
    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) {
      expect(
        column.column_name,
        `${column.table_name}.${column.column_name}`,
      ).not.toMatch(/organization_id|customer_account_id/);
    }
  });
});
