import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { FeedTaxonomy } from '../../../src/modules/product_feeds/entities/feed-taxonomy.entity.js';
import { FeedTaxonomyNode } from '../../../src/modules/product_feeds/entities/feed-taxonomy-node.entity.js';
import { TaxonomyReconcilerService } from '../../../src/modules/product_feeds/services/taxonomy-reconciler.service.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';

/**
 * Feature 067 / T052 — the **shipped** taxonomy data (FR-077, FR-078, FR-083).
 *
 * Every other taxonomy test runs against three-line fixtures, deliberately: the
 * shared harness points `taxonomyDataRoot` at a path that does not exist — and
 * hands the module an egress transport that cannot make a request — so no test
 * can read 1.5 MB of vendor text, or download it, by accident. This file is the single
 * exception, and it exists because installing ~17 000 rows across four files is
 * a materially different piece of work from installing six, and "it worked on
 * the fixture" is not evidence about the thing that actually ships.
 *
 * What is checked here that a fixture cannot show:
 *
 *  - both vendor formats parse **as published** — Google's `id - path > path`
 *    text and Meta's CSV with a UTF-8 BOM and a header row;
 *  - the measured node counts and tree depths match what `PROVENANCE.md`
 *    records, so a re-drop that silently truncates a file fails here;
 *  - Polish labels survive the round trip through JSONB with their diacritics;
 *  - external ids are unique within a revision, which is what makes the id the
 *    join key for a stored mapping (FR-085);
 *  - a real Google node id reaches a generated feed through
 *    `g:google_product_category` (FR-083);
 *  - the install completes in a time an operator would accept at boot, and the
 *    figure is printed rather than merely asserted.
 *
 * Skips itself, with no failure, when the data is not bundled: `PROVENANCE.md`
 * documents how to back the drop out if the licensing question is answered the
 * other way, and that removal must not turn the suite red.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = join(HERE, '../../../src/modules/product_feeds/data/taxonomies');
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/** From `data/taxonomies/PROVENANCE.md` — the drop measured on 2026-08-02. */
const EXPECTED = {
  google_merchant: { revision: '2021-09-21', nodes: 5595, levels: 7 },
  meta: { revision: '2026-08-02', nodes: 2967, levels: 6 },
} as const;

/**
 * Absent data is a packaging decision, not a defect: the whole file steps aside
 * rather than reddening a suite over a drop somebody deliberately removed.
 */
const dataBundled = (['google_merchant', 'meta'] as const).every((provider) =>
  existsSync(join(DATA_ROOT, provider)),
);

describe.skipIf(!dataBundled)('bundled provider taxonomies [integration]', () => {
  let h: BackendServerHandle;
  let reconciler: TaxonomyReconcilerService;
  let installMs = 0;

  beforeAll(async () => {
    h = await setupBackendServer();
    reconciler = new TaxonomyReconcilerService({
      emFactory: () => h.em(),
      dataRoot: DATA_ROOT,
    });

    const em = h.em();
    await em.getConnection().execute('delete from "product_feed_taxonomy_mappings"');
    await em.getConnection().execute('delete from "product_feed_taxonomies"');
    em.clear();

    const startedAt = performance.now();
    const result = await reconciler.reconcile();
    installMs = performance.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(
      `[taxonomy/install] providers=${result.installed.length} ` +
        `nodes=${result.installed.reduce((sum, entry) => sum + entry.nodeCount, 0)} ` +
        `elapsed=${installMs.toFixed(0)}ms skipped=${JSON.stringify(result.skipped)}`,
    );
    await reconciler.linkTemplatesToCurrentTaxonomies();
  }, 120_000);

  afterAll(async () => {
    if (h) {
      await h.em().getConnection().execute('delete from "product_feed_taxonomy_mappings"');
      await h.em().getConnection().execute('delete from "product_feed_taxonomies"');
      await teardownBackendServer(h);
    }
  });

  it('has the bundled revisions on disk', () => {
    // If this fails, the drop was removed (see PROVENANCE.md § Licensing) and
    // every case below is meaningless rather than merely failing.
    expect(reconciler.listBundledRevisions('google_merchant')).toContain(
      EXPECTED.google_merchant.revision,
    );
    expect(reconciler.listBundledRevisions('meta')).toContain(EXPECTED.meta.revision);
  });

  it('installs both providers within a sane boot budget', () => {
    // Not a micro-benchmark: the claim is only that a first boot is not made
    // unusable by it. The measured figure is printed above for the record.
    expect(installMs).toBeLessThan(60_000);
  });

  for (const [providerCode, expected] of Object.entries(EXPECTED)) {
    describe(providerCode, () => {
      it('matches the node count and depth PROVENANCE.md records', async () => {
        const em = h.em();
        em.clear();
        const taxonomy = await em.findOneOrFail(FeedTaxonomy, {
          providerCode: providerCode as 'google_merchant' | 'meta',
          isCurrent: true,
        });
        expect(taxonomy.revision).toBe(expected.revision);
        expect(taxonomy.nodeCount).toBe(expected.nodes);

        const rows = (await em
          .getConnection()
          .execute(
            `select count(*)::int as total, max("depth")::int as max_depth,
                    count(distinct "external_id")::int as distinct_ids
               from "product_feed_taxonomy_nodes" where "taxonomy_id" = ?`,
            [taxonomy.id],
          )) as Array<{ total: number; max_depth: number; distinct_ids: number }>;
        expect(rows[0]!.total).toBe(expected.nodes);
        // `depth` is stored 0-based (a root is 0) while PROVENANCE.md counts
        // levels, so the deepest path has `levels - 1` as its stored depth.
        expect(rows[0]!.max_depth).toBe(expected.levels - 1);
        // The external id is the join key a stored mapping survives a revision
        // change by (FR-085); a duplicate would make that ambiguous.
        expect(rows[0]!.distinct_ids).toBe(expected.nodes);
      });

      it('carries both languages, with Polish diacritics intact', async () => {
        const em = h.em();
        em.clear();
        const taxonomy = await em.findOneOrFail(FeedTaxonomy, {
          providerCode: providerCode as 'google_merchant' | 'meta',
          isCurrent: true,
        });
        const nodes = await em.find(
          FeedTaxonomyNode,
          { taxonomyId: taxonomy.id },
          { limit: 400, orderBy: { externalId: 'asc' } },
        );
        expect(nodes.length).toBeGreaterThan(100);
        for (const node of nodes) {
          expect(node.label['en'], `${node.externalId} has no English label`).toBeTruthy();
          expect(node.label['pl'], `${node.externalId} has no Polish label`).toBeTruthy();
          expect(node.fullPath['en']).toBeTruthy();
          expect(node.fullPath['pl']).toBeTruthy();
        }

        // A mangled encoding would still be "truthy" above, so look for the
        // characters that only survive a correct UTF-8 round trip.
        const polish = (await em
          .getConnection()
          .execute(
            `select count(*)::int as total from "product_feed_taxonomy_nodes"
              where "taxonomy_id" = ? and "label"->>'pl' ~ '[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]'`,
            [taxonomy.id],
          )) as Array<{ total: number }>;
        expect(polish[0]!.total).toBeGreaterThan(50);
      });
    });
  }

  it('re-installing the same drop is a no-op (FR-078)', async () => {
    const em = h.em();
    em.clear();
    const before = await em.find(FeedTaxonomy, {});
    const second = await reconciler.reconcile();
    expect(second.installed).toEqual([]);
    expect(second.skipped).toEqual([]);
    em.clear();
    const after = await em.find(FeedTaxonomy, {});
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
  });

  it('reaches a generated feed as a real Google category id (FR-083)', async () => {
    // The end-to-end claim: an operator maps a shop category to a node from the
    // shipped Google file, and the id appears in the file Merchant Center reads.
    const em = h.em();
    const categoryId = (await em.findOneOrFail(Category, { slug: 'small-widgets' })).id;
    const channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    await setChannelStorefrontUrl(h, 'pl_retail');
    const priceListId = await seedFeedPrices(em, { code: 'feed_bundled_taxonomy' });

    // 166 — "Apparel & Accessories > Clothing" in Google's 2021-09-21 file.
    const node = await em.findOneOrFail(FeedTaxonomyNode, { externalId: '166' });
    expect(node.label['en']).toBeTruthy();

    const mapped = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/feed-taxonomies/mappings',
      ...ADMIN,
      payload: { providerCode: 'google_merchant', categoryId, nodeExternalId: '166' },
    });
    expect(mapped.statusCode, mapped.body).toBe(200);

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    const templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: 'Bundled taxonomy feed',
        slug: `bundled-taxonomy-${Math.random().toString(36).slice(2, 8)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        priceListId,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;

    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(['completed', 'completed_with_warnings']).toContain(run.status);

    const artefact = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/product-feeds/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(artefact.statusCode).toBe(200);
    expect(artefact.body).toContain('<g:google_product_category>166</g:google_product_category>');
  });
});
