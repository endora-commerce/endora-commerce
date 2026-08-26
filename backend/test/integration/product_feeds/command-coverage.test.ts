import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { TaxonomyReconcilerService } from '../../../../packages/modules/product_feeds/src/backend/services/taxonomy-reconciler.service.js';
import {
  analyzeSource,
  MIGRATED_MODULES,
} from '../../../scripts/check-command-coverage.js';

/**
 * Feature 067 / T113 — uniform write auditing (FR-059, FR-060, Principle XIII).
 *
 * Three claims, each of which fails in a different, quiet way if it is not
 * tested:
 *
 *  1. **Every operator write leaves exactly one audit entry, attributed to the
 *     administrator who made it.** Zero entries means an unauditable change;
 *     two means an operator reading the trail cannot tell one edit from two,
 *     which is precisely what FR-010 of the Command Bus feature forbids.
 *  2. **A run nobody asked for records nothing** (FR-060). A feed on a
 *     quarter-hourly schedule executes ninety-six times a day; auditing those
 *     would bury the writes a person actually performed.
 *  3. **The writes that are deliberately not Commands say why.** The
 *     `command-coverage-ignore` escape hatch is only honest if every use of it
 *     carries a reason, so the static checker's own analyzer is run here over
 *     this module — the same code CI runs, pinned as a test.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '../../..');
const MODULE_ROOT = join(BACKEND_ROOT, '../packages/modules/product_feeds/src/backend');
const FIXTURE_TAXONOMIES = join(HERE, '../../fixtures/product_feeds/taxonomies-v1');

describe('product feeds command coverage [integration]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let channelId: string;
  let priceListId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    priceListId = await seedFeedPrices(em, { code: 'feed_command_coverage' });

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

  /** Audit rows this module wrote, newest first. */
  async function moduleAuditEntries(): Promise<AuditLogEntry[]> {
    const em = h.em();
    em.clear();
    const entries = await em.find(AuditLogEntry, {}, { orderBy: { actedAt: 'asc', id: 'asc' } });
    return entries.filter((entry) => entry.action.startsWith('product_feeds.'));
  }

  /**
   * Runs one operator action and returns the audit rows it produced — the whole
   * delta, so "exactly one" is a claim the caller can make rather than assume.
   */
  async function auditDeltaOf(
    action: () => Promise<void>,
  ): Promise<Array<{ action: string; objectType: string; actorAdminUserId: string | null }>> {
    const before = new Set((await moduleAuditEntries()).map((entry) => entry.id));
    await action();
    const after = await moduleAuditEntries();
    return after
      .filter((entry) => !before.has(entry.id))
      .map((entry) => ({
        action: entry.action,
        objectType: entry.objectType,
        actorAdminUserId: entry.actorAdminUserId ?? null,
      }));
  }

  async function createFeed(): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Coverage ${Math.random().toString(36).slice(2, 8)}`,
        slug: `coverage-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        priceListId,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { feed: { id: string } } }).data.feed.id;
  }

  describe('every operator write is one Command, attributed to the operator (FR-059)', () => {
    it('audits a feed create / update / duplicate / delete exactly once each', async () => {
      let feedId = '';
      let copyId = '';

      expect(await auditDeltaOf(async () => { feedId = await createFeed(); })).toEqual([
        { action: 'product_feeds.feed.create', objectType: 'product_feed', actorAdminUserId: TEST_ADMIN_ID },
      ]);

      expect(
        await auditDeltaOf(async () => {
          const res = await h.app.inject({
            method: 'PATCH',
            url: `/api/v1/admin/product-feeds/${feedId}`,
            ...ADMIN,
            payload: { name: 'Renamed by the operator' },
          });
          expect(res.statusCode, res.body).toBe(200);
        }),
      ).toEqual([
        { action: 'product_feeds.feed.update', objectType: 'product_feed', actorAdminUserId: TEST_ADMIN_ID },
      ]);

      expect(
        await auditDeltaOf(async () => {
          const res = await h.app.inject({
            method: 'POST',
            url: `/api/v1/admin/product-feeds/${feedId}/duplicate`,
            ...ADMIN,
            payload: { name: 'Duplicated feed', slug: `dup-${Math.random().toString(36).slice(2, 8)}` },
          });
          expect(res.statusCode, res.body).toBe(201);
          copyId = (res.json() as { data: { feed: { id: string } } }).data.feed.id;
        }),
      ).toEqual([
        { action: 'product_feeds.feed.duplicate', objectType: 'product_feed', actorAdminUserId: TEST_ADMIN_ID },
      ]);

      expect(
        await auditDeltaOf(async () => {
          const res = await h.app.inject({
            method: 'DELETE',
            url: `/api/v1/admin/product-feeds/${copyId}`,
            ...ADMIN,
          });
          expect(res.statusCode, res.body).toBe(204);
        }),
      ).toEqual([
        { action: 'product_feeds.feed.delete', objectType: 'product_feed', actorAdminUserId: TEST_ADMIN_ID },
      ]);
    });

    it('audits a token rotation and a revocation exactly once each (FR-047)', async () => {
      const feedId = await createFeed();

      expect(
        await auditDeltaOf(async () => {
          const res = await h.app.inject({
            method: 'POST',
            url: `/api/v1/admin/product-feeds/${feedId}/token/rotate`,
            ...ADMIN,
          });
          expect(res.statusCode, res.body).toBe(200);
        }),
      ).toEqual([
        { action: 'product_feeds.token.rotate', objectType: 'product_feed', actorAdminUserId: TEST_ADMIN_ID },
      ]);

      expect(
        await auditDeltaOf(async () => {
          const res = await h.app.inject({
            method: 'POST',
            url: `/api/v1/admin/product-feeds/${feedId}/token/revoke`,
            ...ADMIN,
          });
          expect(res.statusCode, res.body).toBe(200);
        }),
      ).toEqual([
        { action: 'product_feeds.token.revoke', objectType: 'product_feed', actorAdminUserId: TEST_ADMIN_ID },
      ]);
    });

    it('audits a manually triggered run exactly once (FR-060)', async () => {
      const feedId = await createFeed();
      const delta = await auditDeltaOf(async () => {
        const res = await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/product-feeds/${feedId}/generate`,
          ...ADMIN,
        });
        expect(res.statusCode, res.body).toBe(202);
      });
      expect(delta).toEqual([
        { action: 'product_feeds.run.start', objectType: 'product_feed', actorAdminUserId: TEST_ADMIN_ID },
      ]);
    });

    it('audits a template create / update / duplicate / delete exactly once each', async () => {
      let createdId = '';
      let version = 0;
      let copyId = '';
      let copyVersion = 0;

      expect(
        await auditDeltaOf(async () => {
          const res = await h.app.inject({
            method: 'POST',
            url: '/api/v1/admin/feed-templates',
            ...ADMIN,
            payload: {
              name: `Coverage template ${Math.random().toString(36).slice(2, 6)}`,
              providerCode: 'custom',
              outputFormat: 'csv',
              itemGranularity: 'product',
              fields: [
                { outputName: 'id', sourceKind: 'sku', providerRequired: true, sortOrder: 0 },
              ],
            },
          });
          expect(res.statusCode, res.body).toBe(201);
          // The template routes answer with the template itself under `data`,
          // not nested under `data.template` (the import route is the exception).
          const body = res.json() as { data: { id: string; version: number } };
          createdId = body.data.id;
          version = body.data.version;
        }),
      ).toEqual([
        { action: 'product_feeds.template.create', objectType: 'feed_template', actorAdminUserId: TEST_ADMIN_ID },
      ]);

      expect(
        await auditDeltaOf(async () => {
          const res = await h.app.inject({
            method: 'PUT',
            url: `/api/v1/admin/feed-templates/${createdId}`,
            ...ADMIN,
            headers: { 'if-match': `W/"${createdId}:${version}"` },
            payload: {
              name: `Coverage template renamed ${Math.random().toString(36).slice(2, 6)}`,
              fields: [
                { outputName: 'id', sourceKind: 'sku', providerRequired: true, sortOrder: 0 },
                { outputName: 'title', sourceKind: 'name', providerRequired: false, sortOrder: 1 },
              ],
            },
          });
          expect(res.statusCode, res.body).toBe(200);
        }),
      ).toEqual([
        { action: 'product_feeds.template.update', objectType: 'feed_template', actorAdminUserId: TEST_ADMIN_ID },
      ]);

      expect(
        await auditDeltaOf(async () => {
          const res = await h.app.inject({
            method: 'POST',
            url: `/api/v1/admin/feed-templates/${createdId}/duplicate`,
            ...ADMIN,
            payload: { name: `Coverage copy ${Math.random().toString(36).slice(2, 6)}` },
          });
          expect(res.statusCode, res.body).toBe(201);
          const copy = (res.json() as { data: { id: string; version: number } }).data;
          copyId = copy.id;
          copyVersion = copy.version;
        }),
      ).toEqual([
        { action: 'product_feeds.template.duplicate', objectType: 'feed_template', actorAdminUserId: TEST_ADMIN_ID },
      ]);

      expect(
        await auditDeltaOf(async () => {
          const res = await h.app.inject({
            method: 'DELETE',
            url: `/api/v1/admin/feed-templates/${copyId}`,
            ...ADMIN,
            // A template delete is version-gated like its update (FR-076).
            headers: { 'if-match': `W/"${copyId}:${copyVersion}"` },
          });
          expect(res.statusCode, res.body).toBe(204);
        }),
      ).toEqual([
        { action: 'product_feeds.template.delete', objectType: 'feed_template', actorAdminUserId: TEST_ADMIN_ID },
      ]);
    });

    it('audits a whole template import as one entry (FR-018)', async () => {
      const exported = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/feed-templates/${templateId}/export`,
        ...ADMIN,
      });
      expect(exported.statusCode, exported.body).toBe(200);
      const document = exported.json() as Record<string, unknown>;

      const delta = await auditDeltaOf(async () => {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/feed-templates/import',
          ...ADMIN,
          payload: { document, onNameConflict: 'create_copy' },
        });
        expect(res.statusCode, res.body).toBe(201);
      });
      // One entry for a document that creates a template and every one of its
      // fields — an import is one operator decision, not N row writes.
      expect(delta).toEqual([
        { action: 'product_feeds.template.import', objectType: 'feed_template', actorAdminUserId: TEST_ADMIN_ID },
      ]);
    });

    it('audits a taxonomy mapping decision exactly once (FR-079)', async () => {
      // The mapping surface needs an installed taxonomy; the small fixture is
      // used rather than the shipped data files, as everywhere else.
      await new TaxonomyReconcilerService({
        emFactory: () => h.em(),
        dataRoot: FIXTURE_TAXONOMIES,
      }).reconcile();
      const categoryId = (await h.em().findOneOrFail(Category, { slug: 'small-widgets' })).id;

      const delta = await auditDeltaOf(async () => {
        const res = await h.app.inject({
          method: 'PUT',
          url: '/api/v1/admin/feed-taxonomies/mappings',
          ...ADMIN,
          payload: { providerCode: 'google_merchant', categoryId, nodeExternalId: '3' },
        });
        expect(res.statusCode, res.body).toBe(200);
      });
      expect(delta).toEqual([
        {
          action: 'product_feeds.taxonomy_mapping.set',
          objectType: 'product_feed_taxonomy_mapping',
          actorAdminUserId: TEST_ADMIN_ID,
        },
      ]);
    });
  });

  describe('work nobody asked for is not audited (FR-060)', () => {
    it('records nothing for a scheduled run', async () => {
      const feedId = await createFeed();
      const delta = await auditDeltaOf(async () => {
        const run = await h.productFeeds.generation.generateNow(feedId, {
          trigger: 'scheduled',
          triggeredByAdminUserId: null,
        });
        // The run really happened — an audit-free no-op would prove nothing.
        expect(['completed', 'completed_with_warnings']).toContain(run.status);
        expect(run.emittedCount).toBeGreaterThan(0);
      });
      expect(delta).toEqual([]);
    });

    it('records nothing for the retention sweep, the reaper or the taxonomy install', async () => {
      const feedId = await createFeed();
      await h.productFeeds.generation.generateNow(feedId, { trigger: 'scheduled' });

      const delta = await auditDeltaOf(async () => {
        await h.productFeeds.retention.enforce(feedId, 'feed', null);
        await h.productFeeds.reaper.releaseStaleClaims();
        await new TaxonomyReconcilerService({
          emFactory: () => h.em(),
          dataRoot: FIXTURE_TAXONOMIES,
        }).reconcile();
      });
      expect(delta).toEqual([]);
    });
  });

  describe('the escape hatch is honest (Principle XIII)', () => {
    function moduleFiles(dir: string, out: string[] = []): string[] {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) moduleFiles(full, out);
        else if (entry.name.endsWith('.ts')) out.push(full);
      }
      return out;
    }

    it('is registered as a migrated module, so CI judges it build-breaking', () => {
      expect(MIGRATED_MODULES).toContain('product_feeds');
    });

    it('has no unaudited sensitive write and no double-audit', () => {
      // The checker CI runs (`pnpm --filter backend run check:command-coverage
      // -- --strict`), applied to this module only. Running its analyzer here
      // means a regression fails a test rather than only a pipeline stage.
      const services = moduleFiles(join(MODULE_ROOT, 'services'));
      // `[]` findings over `[]` files is the same green as a clean module, and
      // this root moved once already (into `packages/modules/`), so the walk is
      // asserted before its result is.
      expect(services.length, 'no service file read — a vacuous pass').toBeGreaterThan(10);
      const findings = services.flatMap((file) =>
        analyzeSource(relative(BACKEND_ROOT, file), readFileSync(file, 'utf8')).map(
          (finding) => `${finding.filePath}:${finding.line ?? '?'} ${finding.kind}: ${finding.message}`,
        ),
      );
      expect(findings).toEqual([]);
    });

    it('gives every `command-coverage-ignore` a reason', () => {
      const markers: Array<{ file: string; reason: string }> = [];
      for (const file of moduleFiles(MODULE_ROOT)) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          const match = /command-coverage-ignore:(.*)$/.exec(line);
          if (match) {
            markers.push({ file: relative(BACKEND_ROOT, file), reason: match[1]!.trim() });
          }
        }
      }
      // The module does use the hatch — an empty list here would make the
      // assertion below vacuous.
      expect(markers.length).toBeGreaterThan(0);
      for (const marker of markers) {
        // A reason, not a shrug: enough words to say what the write is and why
        // nobody could have performed it.
        expect(marker.reason.length, `${marker.file}: bare command-coverage-ignore`).toBeGreaterThan(20);
      }
    });
  });
});
