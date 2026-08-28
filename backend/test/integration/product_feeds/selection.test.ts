import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProductSelectionRule } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Category } from '../../helpers/package-entities.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { setChannelStorefrontUrl, seedFeedPrices } from '../../helpers/seed-product-feeds.js';
import { ProductFeed } from '../../helpers/package-entities.js';

/**
 * Feature 067 / T063 — narrowing a feed to a subset (FR-024, FR-025, FR-028,
 * FR-029, FR-039).
 *
 * The property under test is not "the compiler produces some SQL" — that is
 * T061's job — but that the number an operator is shown before saving and the
 * number the next run emits are **the same number**. Everything else here
 * exists to make that claim non-vacuous: descendants must be included, the
 * eligibility floor must survive every criterion, and a rule that matches
 * nothing must leave the previously published file alone.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const PUBLISHING_STATUSES = ['completed', 'completed_with_warnings'];

describe('product feed selection [integration]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let channelId: string;
  let priceListId: string;
  let rootCategoryId: string;
  let smallCategoryId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    priceListId = await seedFeedPrices(em, { code: 'feed_selection_list', amount: '55.0000' });
    rootCategoryId = (await em.findOneOrFail(Category, { slug: 'widgets' })).id;
    smallCategoryId = (await em.findOneOrFail(Category, { slug: 'small-widgets' })).id;

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

  async function previewCount(rule: ProductSelectionRule): Promise<number> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/feed-previews/selection',
      ...ADMIN,
      payload: { salesChannelId: channelId, selectionRule: rule },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { matchedCount: number } }).data.matchedCount;
  }

  async function createFeed(rule: ProductSelectionRule): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Selection ${Math.random().toString(36).slice(2, 8)}`,
        slug: `selection-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        priceListId,
        selectionRule: rule,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { feed: { id: string } } }).data.feed.id;
  }

  describe('the empty rule (FR-024)', () => {
    it('means every eligible product of the channel', async () => {
      expect(await previewCount({ kind: 'all' })).toBe(3);
    });
  });

  describe('category criteria include descendants (FR-025)', () => {
    it('counts the whole subtree for a root category', async () => {
      expect(
        await previewCount({
          kind: 'condition',
          field: { kind: 'builtin', key: 'category' },
          op: 'in',
          values: [rootCategoryId],
        }),
      ).toBe(3);
    });

    it('counts only the branch for a child category', async () => {
      expect(
        await previewCount({
          kind: 'condition',
          field: { kind: 'builtin', key: 'category' },
          op: 'in',
          values: [smallCategoryId],
        }),
      ).toBe(2);
    });

    it('subtracts a subtree on `notIn`', async () => {
      expect(
        await previewCount({
          kind: 'condition',
          field: { kind: 'builtin', key: 'category' },
          op: 'notIn',
          values: [smallCategoryId],
        }),
      ).toBe(1);
    });
  });

  describe('attribute and custom-field criteria (FR-025)', () => {
    it('matches on an attribute value', async () => {
      expect(
        await previewCount({
          kind: 'condition',
          field: { kind: 'attribute', attributeKey: 'color' },
          op: 'eq',
          values: ['red'],
        }),
      ).toBe(1);
    });

    it('matches a set of attribute values', async () => {
      expect(
        await previewCount({
          kind: 'condition',
          field: { kind: 'attribute', attributeKey: 'color' },
          op: 'in',
          values: ['red', 'blue'],
        }),
      ).toBe(2);
    });

    it('reads a custom field from the same registry (feature 061)', async () => {
      expect(
        await previewCount({
          kind: 'condition',
          field: { kind: 'customField', fieldKey: 'material' },
          op: 'eq',
          values: ['plastic'],
        }),
      ).toBe(1);
    });
  });

  describe('AND / OR combination (FR-025)', () => {
    it('intersects on AND and unions on OR', async () => {
      const and: ProductSelectionRule = {
        kind: 'group',
        op: 'AND',
        children: [
          {
            kind: 'condition',
            field: { kind: 'attribute', attributeKey: 'color' },
            op: 'eq',
            values: ['red'],
          },
          {
            kind: 'condition',
            field: { kind: 'builtin', key: 'category' },
            op: 'in',
            values: [smallCategoryId],
          },
        ],
      };
      const or: ProductSelectionRule = { ...and, op: 'OR' };
      expect(await previewCount(and)).toBe(1);
      expect(await previewCount(or)).toBe(2);
    });
  });

  describe('stock and price criteria (FR-025)', () => {
    it('reads stock availability through the inventory port, never a column', async () => {
      // The point is that the criterion PARTITIONS the channel catalogue: a
      // refinement leaf that silently vanished would make both branches return
      // the whole 3, and one that failed closed would make both return 0.
      const inStock = await previewCount({
        kind: 'condition',
        field: { kind: 'builtin', key: 'stockState' },
        op: 'eq',
        values: ['in_stock'],
      });
      const outOfStock = await previewCount({
        kind: 'condition',
        field: { kind: 'builtin', key: 'stockState' },
        op: 'eq',
        values: ['out_of_stock'],
      });
      expect(inStock + outOfStock).toBe(3);
      expect(inStock).toBeGreaterThan(0);
      expect(outOfStock).toBeGreaterThan(0);
    });

    it('applies a price range against the resolved price', async () => {
      // The seeded list prices everything at 55.00 PLN.
      expect(
        await previewCount({
          kind: 'condition',
          field: { kind: 'builtin', key: 'price' },
          op: 'gte',
          values: [1_000],
        }),
      ).toBe(0);
      expect(
        await previewCount({
          kind: 'condition',
          field: { kind: 'builtin', key: 'price' },
          op: 'lte',
          values: [1_000],
        }),
      ).toBe(3);
    });

    it('keeps the eligibility floor under an OR with a refinement leaf', async () => {
      // `status = draft` can never pass the floor, and the OR must not let the
      // in-memory stage smuggle an ineligible product back in (FR-026).
      const count = await previewCount({
        kind: 'group',
        op: 'OR',
        children: [
          { kind: 'condition', field: { kind: 'builtin', key: 'status' }, op: 'eq', values: ['draft'] },
          {
            kind: 'condition',
            field: { kind: 'builtin', key: 'price' },
            op: 'lte',
            values: [1_000],
          },
        ],
      });
      expect(count).toBe(3);
    });
  });

  describe('the preview count is the run count (FR-028)', () => {
    it('matches what the next run emits on an unchanged catalogue', async () => {
      const rule: ProductSelectionRule = {
        kind: 'condition',
        field: { kind: 'builtin', key: 'category' },
        op: 'in',
        values: [smallCategoryId],
      };
      const predicted = await previewCount(rule);
      const feedId = await createFeed(rule);
      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(PUBLISHING_STATUSES).toContain(run.status);
      expect(run.emittedCount).toBe(predicted);
      expect(run.consideredCount).toBe(predicted);
    });

    it('matches for a rule the SQL stage can only approximate', async () => {
      const rule: ProductSelectionRule = {
        kind: 'condition',
        field: { kind: 'builtin', key: 'price' },
        op: 'lte',
        values: [1_000],
      };
      const predicted = await previewCount(rule);
      const feedId = await createFeed(rule);
      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(run.consideredCount).toBe(predicted);
      expect(run.emittedCount).toBe(predicted);
    });
  });

  describe('zero matches (FR-039)', () => {
    it('produces an `empty` run and keeps the previously published artefact', async () => {
      const feedId = await createFeed({ kind: 'all' });
      const good = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(PUBLISHING_STATUSES).toContain(good.status);
      const publishedBefore = (await h.em().findOneOrFail(ProductFeed, { id: feedId }))
        .publishedArtefactId;
      expect(publishedBefore).not.toBeNull();

      const narrow: ProductSelectionRule = {
        kind: 'condition',
        field: { kind: 'attribute', attributeKey: 'color' },
        op: 'eq',
        values: ['ultraviolet'],
      };
      expect(await previewCount(narrow)).toBe(0);

      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
        payload: { selectionRule: narrow },
      });
      expect(patch.statusCode, patch.body).toBe(200);

      const empty = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(empty.status).toBe('empty');
      expect(empty.emittedCount).toBe(0);

      h.em().clear();
      const feed = await h.em().findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.publishedArtefactId).toBe(publishedBefore);
    });
  });

  describe('a criterion naming something deleted (FR-029)', () => {
    it('fails the run with a configuration error rather than matching everything', async () => {
      const feedId = await createFeed({ kind: 'all' });
      const em = h.em();
      const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
      // Written straight to the row: the API refuses to *save* an unknown key
      // once T083 lands, but a definition can be deleted after the feed was
      // saved, which is exactly the case FR-029 is about.
      feed.selectionRule = {
        kind: 'condition',
        field: { kind: 'attribute', attributeKey: 'deleted_after_save' },
        op: 'eq',
        values: ['x'],
      };
      await em.flush();
      em.clear();

      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(run.status).toBe('failed');
      expect(run.failureCode).toBe('unknown_attribute');
      expect(run.failureDetail).toContain('deleted_after_save');
      expect(run.emittedCount).toBe(0);
    });
  });
});
