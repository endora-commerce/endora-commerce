import { readFileSync, readdirSync } from 'node:fs';
import { PriceList, PriceListPriceBracket, PriceListProduct } from '../../helpers/package-entities.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProductSelectionRule } from '@endora-commerce/contracts';
import { codeOnly } from '../../../scripts/lib/source-text.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Category } from '../../helpers/package-entities.js';
import { Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { ProductFeed } from '../../helpers/package-entities.js';

/**
 * Feature 067 / T112 — sales-channel isolation (FR-026, FR-027, Principle XII).
 *
 * This is the file that catches a Principle XII regression, and it is written
 * on the assumption that another one is hiding. Phase 5 already found a real
 * fail-open here: the floor, the rule and the keyset cursor were composed with
 * an **object spread**, so a category criterion — which compiles to
 * `{ id: { $in: … } }` — overwrote the floor's own `id` key and dropped channel
 * scoping altogether. Nothing about the output looked wrong; the feed simply
 * contained another channel's catalogue.
 *
 * The stakes are why the coverage here is deliberately more than "a feed on
 * channel A does not contain channel B's product": the public feed endpoint is
 * **unauthenticated and internet-reachable**, so a leak is a leak to anybody who
 * has the URL, and a shop's whole price list is the thing that leaks.
 *
 * So every shape that has ever been able to widen a query is exercised:
 * a category criterion (an `id` predicate), a negated one (`notIn`), an `$or`
 * with a refinement branch (the second Phase-5 bug), a channel with no members
 * at all (must be `empty`, never "everything"), and an inactive channel (must
 * fail closed). Then the same isolation is asserted at the two boundaries an
 * operator and the internet actually see: the criteria preview and the public
 * URL.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const PUBLISHING_STATUSES = ['completed', 'completed_with_warnings'];

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = join(HERE, '../../../../packages/modules/product_feeds/src/backend');

/** Exclusive to channel A. Must never appear anywhere near channel B. */
const ONLY_A_ID = '00000000-0000-4000-8000-0000000c1001';
/** Exclusive to channel B. The product a leak would show up as. */
const ONLY_B_ID = '00000000-0000-4000-8000-0000000c1002';

describe('product feed channel isolation [integration]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let channelAId: string;
  let channelBId: string;
  /** A channel that exists, is active, and carries no products at all. */
  let emptyChannelId: string;
  /** A channel this file switches off half-way through. */
  let closingChannelId: string;
  let priceListId: string;
  let categoryId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    channelAId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    channelBId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    categoryId = (await em.findOneOrFail(Category, { slug: 'small-widgets' })).id;

    const emptyChannel = em.create(SalesChannel, {
      code: 'iso_empty',
      name: { 'en-US': 'Isolation empty' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    const closingChannel = em.create(SalesChannel, {
      code: 'iso_closing',
      name: { 'en-US': 'Isolation closing' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    await em.persistAndFlush([emptyChannel, closingChannel]);
    emptyChannelId = emptyChannel.id;
    closingChannelId = closingChannel.id;

    for (const code of ['pl_retail', 'pl_b2b_vip', 'iso_empty', 'iso_closing']) {
      await setChannelStorefrontUrl(h, code);
    }

    // Two products in the SAME category, each in exactly one channel. Sharing
    // the category is the point: a category criterion is the predicate that
    // used to overwrite the channel floor, so it must not be able to reach
    // across the boundary even when the rule matches both products.
    for (const [id, sku] of [
      [ONLY_A_ID, 'ISO-ONLY-A'],
      [ONLY_B_ID, 'ISO-ONLY-B'],
    ] as const) {
      em.create(Product, {
        id,
        sku,
        slug: sku.toLowerCase(),
        type: 'simple',
        status: 'active',
        visibility: 'public',
        name: { 'en-US': sku },
        description: { 'en-US': `${sku} description` },
      });
    }
    await em.flush();

    const conn = em.getConnection();
    for (const [productId, channelId] of [
      [ONLY_A_ID, channelAId],
      [ONLY_B_ID, channelBId],
    ] as const) {
      await conn.execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?,?)`,
        [channelId, productId],
      );
      await conn.execute(
        `insert into product_categories (product_id, category_id) values (?,?)`,
        [productId, categoryId],
      );
    }
    // `iso_closing` needs one sellable product so its first run publishes; the
    // test then switches the channel off and asserts what the next run does.
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?)`,
      [closingChannelId, ONLY_A_ID],
    );

    // One price list covering everything, named by every feed here, so an
    // absent price can never be mistaken for channel scoping doing its job.
    // Catch-all rather than `isSystem` (issue #50): the system flag marks the
    // platform's one seeded `Default` row and is now a database singleton.
    const priceList = em.create(PriceList, {
      code: 'feed_isolation_list',
      name: 'Feed isolation list',
      currency: 'PLN',
      type: 'base',
      status: 'active',
      applicationRule: { kind: 'all' },
      modifiedAt: new Date(),
    });
    await em.persistAndFlush(priceList);
    priceListId = priceList.id;

    const allProducts = await em.find(Product, { status: 'active' });
    for (const product of allProducts) {
      em.create(PriceListProduct, { priceListId, productId: product.id });
    }
    await em.flush();
    for (const product of allProducts) {
      em.create(PriceListPriceBracket, {
        priceListId,
        productId: product.id,
        currencyCode: 'PLN',
        minQuantity: 1,
        amount: '42.0000',
      });
    }
    await em.flush();
    em.clear();

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

  async function createFeed(
    salesChannelId: string,
    rule?: ProductSelectionRule,
  ): Promise<{ id: string; token: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Isolation ${Math.random().toString(36).slice(2, 8)}`,
        slug: `isolation-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        priceListId,
        ...(rule ? { selectionRule: rule } : {}),
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as {
      data: { feed: { id: string }; issuedToken: { token: string } };
    };
    return { id: body.data.feed.id, token: body.data.issuedToken.token };
  }

  async function generateAndRead(
    feedId: string,
  ): Promise<{ status: string; emitted: number; document: string }> {
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    if (!PUBLISHING_STATUSES.includes(run.status)) {
      return { status: run.status, emitted: run.emittedCount, document: '' };
    }
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/product-feeds/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    return { status: run.status, emitted: run.emittedCount, document: res.body };
  }

  const categoryRule: ProductSelectionRule = {
    kind: 'condition',
    field: { kind: 'builtin', key: 'category' },
    op: 'in',
    values: [],
  };

  describe('a criterion can narrow the channel, never widen it (FR-026)', () => {
    it('keeps a category criterion inside the channel — the Phase-5 spread regression', async () => {
      const feed = await createFeed(channelAId, { ...categoryRule, values: [categoryId] });
      const { status, document } = await generateAndRead(feed.id);
      expect(PUBLISHING_STATUSES).toContain(status);
      // Both products are in this category; only one is in this channel.
      expect(document).toContain('ISO-ONLY-A');
      expect(document).not.toContain('ISO-ONLY-B');
    });

    it('keeps a negated category criterion inside the channel', async () => {
      // `notIn` is the shape that turns into "everything except…", which is one
      // careless composition away from "everything".
      const feed = await createFeed(channelAId, {
        kind: 'condition',
        field: { kind: 'builtin', key: 'category' },
        op: 'notIn',
        values: [categoryId],
      });
      const { document } = await generateAndRead(feed.id);
      expect(document).not.toContain('ISO-ONLY-A');
      expect(document).not.toContain('ISO-ONLY-B');
    });

    it('keeps an OR group with a refinement branch inside the channel', async () => {
      // The second Phase-5 bug: a stock/price leaf inside `$or` contributed
      // `{}`, which the query builder collapses. Composed wrongly, an `$or`
      // branch is the other classic way a floor disappears.
      const feed = await createFeed(channelAId, {
        kind: 'group',
        op: 'OR',
        children: [
          { ...categoryRule, values: [categoryId] },
          {
            kind: 'condition',
            field: { kind: 'builtin', key: 'price' },
            op: 'gte',
            values: ['0'],
          },
        ],
      });
      const { document } = await generateAndRead(feed.id);
      expect(document).toContain('ISO-ONLY-A');
      expect(document).not.toContain('ISO-ONLY-B');
    });

    it('gives each channel its own catalogue for one identical rule', async () => {
      const rule = { ...categoryRule, values: [categoryId] };
      const feedA = await createFeed(channelAId, rule);
      const feedB = await createFeed(channelBId, rule);

      const a = await generateAndRead(feedA.id);
      const b = await generateAndRead(feedB.id);

      expect(a.document).toContain('ISO-ONLY-A');
      expect(a.document).not.toContain('ISO-ONLY-B');
      expect(b.document).toContain('ISO-ONLY-B');
      expect(b.document).not.toContain('ISO-ONLY-A');
    });
  });

  describe('a channel that resolves to nothing produces nothing (FR-027)', () => {
    it('treats "no members" as empty, never as the whole catalogue', async () => {
      const feed = await createFeed(emptyChannelId);
      const run = await h.productFeeds.generation.generateNow(feed.id, { trigger: 'manual' });
      expect(run.status).toBe('empty');
      expect(run.emittedCount).toBe(0);
      // FR-039: an empty run never publishes, so there is nothing to leak.
      h.em().clear();
      const stored = await h.em().findOneOrFail(ProductFeed, { id: feed.id });
      expect(stored.publishedArtefactId ?? null).toBeNull();
    });

    it('fails closed when the channel is switched off, and keeps serving the old file', async () => {
      const feed = await createFeed(closingChannelId);
      const first = await generateAndRead(feed.id);
      expect(PUBLISHING_STATUSES).toContain(first.status);
      expect(first.document).toContain('ISO-ONLY-A');
      h.em().clear();
      const publishedBefore = (await h.em().findOneOrFail(ProductFeed, { id: feed.id }))
        .publishedArtefactId;

      await h
        .em()
        .getConnection()
        .execute('update sales_channels set active = false where id = ?', [closingChannelId]);
      h.em().clear();

      const run = await h.productFeeds.generation.generateNow(feed.id, { trigger: 'manual' });
      expect(run.status).toBe('failed');
      expect(run.failureCode).toBe('channel_unavailable');
      expect(run.emittedCount).toBe(0);

      // The previously published artefact is untouched — failing closed must not
      // mean losing the last good file (FR-035).
      h.em().clear();
      const after = await h.em().findOneOrFail(ProductFeed, { id: feed.id });
      expect(after.publishedArtefactId).toBe(publishedBefore);

      const served = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/product-feeds/${feed.id}/artefact`,
        ...ADMIN,
      });
      expect(served.statusCode).toBe(200);
      expect(served.body).toContain('ISO-ONLY-A');

      await h
        .em()
        .getConnection()
        .execute('update sales_channels set active = true where id = ?', [closingChannelId]);
      h.em().clear();
    });
  });

  describe('the boundaries an operator and the internet see', () => {
    it('scopes the criteria preview to the requested channel (FR-028)', async () => {
      // The preview is a separate code path from the run, and it is the one an
      // operator trusts before saving. It has to answer per channel too.
      const ask = async (salesChannelId: string): Promise<string[]> => {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/feed-previews/selection',
          ...ADMIN,
          payload: {
            salesChannelId,
            selectionRule: { ...categoryRule, values: [categoryId] },
          },
        });
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { data: { sample: Array<{ sku: string }> } }).data.sample.map(
          (row) => row.sku,
        );
      };

      expect(await ask(channelAId)).toContain('ISO-ONLY-A');
      expect(await ask(channelAId)).not.toContain('ISO-ONLY-B');
      expect(await ask(channelBId)).toContain('ISO-ONLY-B');
      expect(await ask(channelBId)).not.toContain('ISO-ONLY-A');
      expect(await ask(emptyChannelId)).toEqual([]);
    });

    it('never serves one channel’s catalogue on another channel’s public URL (FR-046)', async () => {
      const rule = { ...categoryRule, values: [categoryId] };
      const feedA = await createFeed(channelAId, rule);
      const feedB = await createFeed(channelBId, rule);
      await h.productFeeds.generation.generateNow(feedA.id, { trigger: 'manual' });
      await h.productFeeds.generation.generateNow(feedB.id, { trigger: 'manual' });

      const fetchPublic = async (token: string): Promise<string> => {
        const res = await h.app.inject({
          method: 'GET',
          url: `/api/v1/public/product-feeds/${token}`,
        });
        expect(res.statusCode).toBe(200);
        return res.body;
      };

      const publicA = await fetchPublic(feedA.token);
      const publicB = await fetchPublic(feedB.token);

      expect(publicA).toContain('ISO-ONLY-A');
      expect(publicA).not.toContain('ISO-ONLY-B');
      expect(publicB).toContain('ISO-ONLY-B');
      expect(publicB).not.toContain('ISO-ONLY-A');
      // Two different feeds, two different files: a token that resolved to the
      // wrong artefact would otherwise pass every assertion above.
      expect(publicA).not.toBe(publicB);
    });
  });

  describe('the sanctioned accessor (Principle XII)', () => {
    function moduleSources(dir: string, out: string[] = []): string[] {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) moduleSources(full, out);
        else if (entry.name.endsWith('.ts')) out.push(full);
      }
      return out;
    }

    it('never reads a sales-channel bridge table directly', () => {
      // The module reads membership exclusively through the injected
      // `SalesChannelMembershipService.listEntityIdsForChannel` port. A raw
      // bridge read would be invisible to the port's own tests, so it is
      // asserted at the source level — the same posture as the taxonomy
      // reconciler's "no network call anywhere in the source".
      for (const file of moduleSources(MODULE_ROOT)) {
        const source = readFileSync(file, 'utf8');
        // Prose in comments is allowed to name the table (the service header
        // explains precisely why it must not be queried); a SQL string is not.
        // The parser decides which spans are comments — this used to be a
        // line-prefix filter, one of the four hand-rolled comment strippers
        // issue #241 swept. It left a trailing `// … from sales_channel_x` in
        // place, which would have failed this assertion over a sentence, and it
        // dropped any line beginning with `*`, comment or not.
        const sql = codeOnly(source, file);
        expect(sql, `${file} must not query sales_channel_* directly`).not.toMatch(
          /from\s+"?sales_channel_\w+"?|join\s+"?sales_channel_\w+"?|into\s+"?sales_channel_\w+"?/i,
        );
      }
    });

    // This file used to run `eslint-rules/no-unscoped-channel-query.js` by path
    // — the only live reader that rule ever had. D-87 deleted it: it was wired
    // into no ESLint config, it never looked at a bridge table, and the
    // Constitution had credited it with enforcing the accessor clause since
    // feature 005. The repo-wide mechanism is `check:module-boundary`'s `sql`
    // predicate, which resolves `sales_channel_*` to its owner from the DDL and
    // ledgers every raw reach. The source-level assertion above stays: it is
    // this module's own, and it is cheaper to read than a ledger diff.
  });
});
