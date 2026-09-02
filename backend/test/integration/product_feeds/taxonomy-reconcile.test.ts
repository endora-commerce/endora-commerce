import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Category } from '../../helpers/package-entities.js';
import { TaxonomyReconcilerService } from '../../../../packages/modules/product_feeds/src/backend/services/taxonomy-reconciler.service.js';
import { FeedTaxonomy, FeedTaxonomyMapping, FeedTaxonomyNode } from '../../helpers/package-entities.js';

/**
 * Feature 067 / T050 — taxonomy install and revision change
 * (FR-077, FR-078, FR-085).
 *
 * Runs entirely against **small fixtures** in `test/fixtures/product_feeds/`.
 * It never reads the shipped data files and never touches the network.
 *
 * The "zero outbound HTTP" assertions below are about **this** path and are
 * still exactly right: the bundled reconciler loads files from disk and opens
 * no socket, which is what keeps boot independent of anybody's uptime. The
 * other way a revision can arrive — an optional, off-by-default check that
 * downloads the provider's published files — lives in
 * `taxonomy-refresh.service.ts` and is covered by `taxonomy-fetch-check.test.ts`
 * and `taxonomy-fetch-disabled.test.ts`. It can only ever add an **inactive**
 * revision, so neither path changes what a feed emits without an operator
 * promoting it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_V1 = join(HERE, '../../fixtures/product_feeds/taxonomies-v1');
const FIXTURE_V2 = join(HERE, '../../fixtures/product_feeds/taxonomies-v2');

describe('taxonomy reconciler [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * Each case starts from an empty taxonomy space so revision ordering is under
   * this test's control. It is cleared BEFORE as well as after: the whole suite
   * shares one database, and `test/contract/product_feeds/taxonomies.test.ts`
   * installs a fixture of its own — without this, the first case here would
   * find those rows already present and its reconcile would be a no-op.
   */
  async function clearTaxonomies(): Promise<void> {
    const em = h.em();
    await em.getConnection().execute('delete from "product_feed_taxonomy_mappings"');
    await em.getConnection().execute('delete from "product_feed_taxonomies"');
    em.clear();
  }

  beforeEach(clearTaxonomies);

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTaxonomies();
  });

  function reconciler(dataRoot: string): TaxonomyReconcilerService {
    return new TaxonomyReconcilerService({ emFactory: () => h.em(), dataRoot });
  }

  describe('install (FR-077, FR-078)', () => {
    it('installs both providers with en and pl labels', async () => {
      const result = await reconciler(FIXTURE_V1).reconcile();
      expect(result.installed.map((i) => i.providerCode).sort()).toEqual([
        'google_merchant',
        'meta',
      ]);
      expect(result.skipped).toEqual([]);

      const em = h.em();
      em.clear();
      const taxonomies = await em.find(FeedTaxonomy, {});
      expect(taxonomies).toHaveLength(2);
      for (const taxonomy of taxonomies) {
        expect(taxonomy.isCurrent).toBe(true);
        expect(taxonomy.installedAt).toBeInstanceOf(Date);
        expect(taxonomy.nodeCount).toBeGreaterThan(0);
      }

      const google = taxonomies.find((t) => t.providerCode === 'google_merchant')!;
      expect(google.revision).toBe('2020-01-01');
      const nodes = await em.find(FeedTaxonomyNode, { taxonomyId: google.id });
      expect(nodes).toHaveLength(4);

      const birds = nodes.find((n) => n.externalId === '3')!;
      expect(birds.label['en']).toBe('Bird Supplies');
      expect(birds.label['pl']).toBe('Artykuły dla ptaków');
      expect(birds.fullPath['en']).toBe(
        'Animals & Pet Supplies > Pet Supplies > Bird Supplies',
      );
      expect(birds.fullPath['pl']).toContain('Artykuły dla ptaków');
      expect(birds.depth).toBe(2);
      // Parentage comes from the authoritative language, by external id.
      expect(birds.parentExternalId).toBe('2');

      const root = nodes.find((n) => n.externalId === '1')!;
      expect(root.parentExternalId ?? null).toBeNull();
      expect(root.depth).toBe(0);
    });

    it('parses Meta’s CSV shape, header and all', async () => {
      await reconciler(FIXTURE_V1).reconcile();
      const em = h.em();
      em.clear();
      const meta = await em.findOneOrFail(FeedTaxonomy, { providerCode: 'meta' });
      const nodes = await em.find(FeedTaxonomyNode, { taxonomyId: meta.id });
      // Two data rows; the `category_id,category` header must not become a node.
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.externalId).sort()).toEqual(['101', '102']);
      expect(nodes.some((n) => n.label['en'] === 'category')).toBe(false);
    });

    it('makes zero outbound HTTP requests during a bundled install (FR-077)', async () => {
      // `node:http`'s ESM namespace is frozen, so it cannot be spied on; the
      // global `fetch` can be, and the source assertion below covers the rest.
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const result = await reconciler(FIXTURE_V1).reconcile();
      expect(result.installed.length).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('has no network call anywhere in the reconciler source', () => {
      // A source assertion as well as a runtime one: the runtime spy only
      // proves this run made no request, while the grep proves the capability
      // is absent from the BUNDLED path. Egress lives in one file
      // (`taxonomy-source-fetcher.ts`), behind one injected seam, and this is
      // what keeps it from spreading into the path that runs at boot.
      const source = readFileSync(
        join(
          HERE,
          '../../../../packages/modules/product_feeds/src/backend/services/taxonomy-reconciler.service.ts',
        ),
        'utf8',
      );
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/node:https?/);
      expect(source).not.toMatch(/axios|undici|got\b/);
    });

    it('is a no-op when the same revision is already installed (FR-078)', async () => {
      const first = await reconciler(FIXTURE_V1).reconcile();
      expect(first.installed).toHaveLength(2);

      const em = h.em();
      em.clear();
      const before = await em.findOneOrFail(FeedTaxonomy, {
        providerCode: 'google_merchant',
      });

      const second = await reconciler(FIXTURE_V1).reconcile();
      expect(second.installed).toEqual([]);

      em.clear();
      const after = await em.findOneOrFail(FeedTaxonomy, {
        providerCode: 'google_merchant',
      });
      expect(after.id).toBe(before.id);
      expect(after.installedAt.getTime()).toBe(before.installedAt.getTime());
      const nodes = await em.find(FeedTaxonomyNode, { taxonomyId: after.id });
      expect(nodes).toHaveLength(4);
    });

    it('installs nothing, and does not throw, when no data is bundled', async () => {
      const result = await reconciler(join(HERE, 'no-such-directory')).reconcile();
      expect(result.installed).toEqual([]);
      expect(result.skipped).toEqual([]);
    });
  });

  describe('revision change and staleness (FR-085)', () => {
    let categoryId: string;

    beforeAll(async () => {
      const em = h.em();
      const category = em.create(Category, {
        name: { 'en-US': 'Live animals' },
        slug: `taxonomy-stale-${Math.random().toString(36).slice(2, 8)}`,
      });
      await em.persistAndFlush(category);
      categoryId = category.id;
    });

    async function mapTo(nodeExternalId: string): Promise<void> {
      const em = h.em();
      em.create(FeedTaxonomyMapping, {
        taxonomyProviderCode: 'google_merchant',
        categoryId,
        nodeExternalId,
      });
      await em.flush();
      em.clear();
    }

    afterEach(async () => {
      await h
        .em()
        .getConnection()
        .execute('delete from "product_feed_taxonomy_mappings"');
      h.em().clear();
    });

    it('keeps a mapping whose node vanished, flagged stale — never remapped, never deleted', async () => {
      await reconciler(FIXTURE_V1).reconcile();
      // `3237` exists in 2020-01-01 and is dropped in 2020-06-01.
      await mapTo('3237');

      const result = await reconciler(FIXTURE_V2).reconcile();
      expect(result.installed).toEqual([
        expect.objectContaining({ providerCode: 'google_merchant', revision: '2020-06-01' }),
      ]);
      // **Installing the newer revision changes nothing on its own** (FR-086).
      // The provider already has a revision in force, so 2020-06-01 lands
      // inactive and staleness — a property of the revision IN FORCE — does not
      // move. Before Phase 11 a platform upgrade activated it here, which is
      // precisely the silent change this feature removed.
      expect(result.markedStale).toBe(0);

      const em0 = h.em();
      expect(
        (
          await em0.findOneOrFail(FeedTaxonomy, {
            providerCode: 'google_merchant',
            isCurrent: true,
          })
        ).revision,
      ).toBe('2020-01-01');
      const candidate = await em0.findOneOrFail(FeedTaxonomy, { revision: '2020-06-01' });
      em0.clear();

      // The operator promotes, and *that* is what makes the mapping stale.
      await h.productFeeds.taxonomyRevisions.promote({
        taxonomyId: candidate.id,
        expectedStaleMappingCount: 1,
      });

      const em = h.em();
      em.clear();
      const mappings = await em.find(FeedTaxonomyMapping, {
        taxonomyProviderCode: 'google_merchant',
      });
      // The row survives.
      expect(mappings).toHaveLength(1);
      expect(mappings[0]!.categoryId).toBe(categoryId);
      // Pointing at exactly what the operator chose, not at a substitute.
      expect(mappings[0]!.nodeExternalId).toBe('3237');
      expect(mappings[0]!.stale).toBe(true);
    });

    it('leaves a mapping live when its node survives the revision', async () => {
      await reconciler(FIXTURE_V1).reconcile();
      await mapTo('3');

      const result = await reconciler(FIXTURE_V2).reconcile();
      expect(result.markedStale).toBe(0);
      // …and it stays live once the operator promotes, because `3` survives.
      const promoteEm = h.em();
      const candidate = await promoteEm.findOneOrFail(FeedTaxonomy, { revision: '2020-06-01' });
      promoteEm.clear();
      await h.productFeeds.taxonomyRevisions.promote({
        taxonomyId: candidate.id,
        expectedStaleMappingCount: 0,
      });

      const em = h.em();
      em.clear();
      const mapping = await em.findOneOrFail(FeedTaxonomyMapping, {
        taxonomyProviderCode: 'google_merchant',
      });
      expect(mapping.stale).toBe(false);
    });

    it('un-stales a mapping whose node reappears in a later revision', async () => {
      // Install the newer revision first, so `3237` is absent from the start.
      await reconciler(FIXTURE_V2).reconcile();
      await mapTo('3237');
      const marked = await reconciler(FIXTURE_V2).reconcile();
      expect(marked.markedStale).toBe(1);

      // A revision that contains it again. (Ordering is by label, so this needs
      // its own root: the point is the re-evaluation, not the ordering.)
      const em = h.em();
      await em.getConnection().execute('delete from "product_feed_taxonomies"');
      em.clear();
      const restored = await reconciler(FIXTURE_V1).reconcile();
      expect(restored.markedLive).toBe(1);

      em.clear();
      const mapping = await em.findOneOrFail(FeedTaxonomyMapping, {
        taxonomyProviderCode: 'google_merchant',
      });
      expect(mapping.stale).toBe(false);
    });

    it('marks exactly one revision current per provider, and a later bundled drop does not take over', async () => {
      await reconciler(FIXTURE_V1).reconcile();
      await reconciler(FIXTURE_V2).reconcile();

      const em = h.em();
      em.clear();
      const all = await em.find(FeedTaxonomy, { providerCode: 'google_merchant' });
      expect(all.length).toBeGreaterThanOrEqual(2);
      // The partial unique index guarantees the "exactly one"; what this pins
      // is WHICH one. A revision shipped in a platform image installs beside
      // the one in force, not over it: activation is deliberate (FR-086,
      // contract §2), and a deploy is not a decision anybody made about
      // taxonomies. On a fresh database — the common case — the first bundled
      // revision still becomes current immediately, which the install cases
      // above cover.
      expect(all.filter((t) => t.isCurrent)).toHaveLength(1);
      expect(all.find((t) => t.isCurrent)!.revision).toBe('2020-01-01');
      expect(all.find((t) => t.revision === '2020-06-01')!.promotedAt ?? null).toBeNull();
    });
  });

  it('logs and skips a malformed revision rather than aborting boot', async () => {
    const warn = vi.fn();
    const badRoot = join(HERE, '../../fixtures/product_feeds/taxonomies-broken');
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    mkdirSync(join(badRoot, 'google_merchant', '2020-01-01'), { recursive: true });
    writeFileSync(join(badRoot, 'google_merchant', '2020-01-01', 'en.txt'), 'not a taxonomy\n');
    try {
      const service = new TaxonomyReconcilerService({
        emFactory: () => h.em(),
        dataRoot: badRoot,
        logger: { warn },
      });
      const result = await service.reconcile();
      expect(result.installed).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.providerCode).toBe('google_merchant');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(badRoot, { recursive: true, force: true });
    }
  });
});
