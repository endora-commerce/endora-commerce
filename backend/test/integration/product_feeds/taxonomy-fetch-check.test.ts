import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRODUCT_FEED_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  googleTaxonomyFile,
  metaTaxonomyFile,
  PLAUSIBLE_NODE_COUNT,
  ScriptedTaxonomyFetcher,
} from '../../helpers/taxonomy-fixtures.js';
import { FeedTaxonomy } from '../../../src/modules/product_feeds/entities/feed-taxonomy.entity.js';
import { FeedTaxonomyCheck } from '../../../src/modules/product_feeds/entities/feed-taxonomy-check.entity.js';
import { FeedTaxonomyMapping } from '../../../src/modules/product_feeds/entities/feed-taxonomy-mapping.entity.js';
import { FeedTemplate } from '../../../src/modules/product_feeds/entities/feed-template.entity.js';

/**
 * Feature 067 Phase 11 / T124 — one taxonomy check, end to end
 * (FR-086, FR-092, FR-093, FR-098).
 *
 * The invariant every case here defends: **a check may only add an inactive
 * revision.** It may not change `is_current`, a mapping's stale flag or a
 * template's taxonomy link, and a garbage response may not become an installed
 * revision at all. The egress transport is a scripted stub, so nothing here
 * reaches the network.
 */

const ACTOR = { actorAdminUserId: null } as const;
const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SRC = join(HERE, '../../../src/modules/product_feeds');

const fetcher = new ScriptedTaxonomyFetcher();

/** Newest modification time anywhere under a directory tree. */
function newestMtimeMs(root: string): number {
  let newest = 0;
  const walk = (path: string): void => {
    const stats = statSync(path);
    newest = Math.max(newest, stats.mtimeMs);
    if (!stats.isDirectory()) return;
    for (const entry of readdirSync(path)) walk(join(path, entry));
  };
  walk(root);
  return newest;
}

describe('taxonomy fetch check [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ taxonomySourceFetcher: fetcher });
  });

  afterAll(async () => {
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

  /** A clean taxonomy space so revision ordering is under this file's control. */
  async function clearTaxonomies(): Promise<void> {
    const em = h.em();
    await em.getConnection().execute('delete from "product_feed_taxonomy_checks"');
    await em.getConnection().execute('delete from "product_feed_taxonomy_mappings"');
    await em
      .getConnection()
      .execute('update "product_feed_templates" set "taxonomy_id" = null');
    await em.getConnection().execute('delete from "product_feed_taxonomies"');
    em.clear();
  }

  beforeEach(async () => {
    fetcher.reset();
    await clearTaxonomies();
    await setEnabled(true);
  });

  afterEach(async () => {
    await setEnabled(false);
    await clearTaxonomies();
  });

  async function check(providerCode: 'google_merchant' | 'meta' = 'google_merchant') {
    return h.productFeeds.taxonomyRefresh.runCheck({ providerCode, trigger: 'scheduled' });
  }

  describe('a changed file', () => {
    it('installs INACTIVE, with provenance, and changes nothing else (FR-086)', async () => {
      // Seed the state a check must leave untouched: a current revision, a
      // mapping against it, and a template linked to it.
      await h.productFeeds.taxonomyReconciler.installRevision({
        providerCode: 'google_merchant',
        revision: '2020-01-01',
        drafts: [
          { externalId: '1', parentExternalId: null, label: { en: 'Root' }, fullPath: { en: 'Root' }, depth: 0 },
        ],
        markCurrent: true,
      });
      await h.productFeeds.taxonomyReconciler.linkTemplatesToCurrentTaxonomies();

      const em = h.em();
      const currentBefore = await em.findOneOrFail(FeedTaxonomy, {
        providerCode: 'google_merchant',
        isCurrent: true,
      });
      const templatesBefore = (await em.find(FeedTemplate, { providerCode: 'google_merchant' })).map(
        (row) => [row.id, row.taxonomyId] as const,
      );
      em.clear();

      fetcher.serve('google', googleTaxonomyFile({ label: '2026-05-14' }), 'W/"v1"');
      const result = await check();

      expect(result.outcome).toBe('installed');
      expect(result.revision).toBe('2026-05-14');

      const after = h.em();
      const installed = await after.findOneOrFail(FeedTaxonomy, { id: result.installedTaxonomyId! });
      expect(installed.isCurrent).toBe(false);
      expect(installed.source).toBe('fetched');
      // MikroORM hydrates a null column by leaving the property unset, so the
      // whole codebase reads these through `?? null` — see `nextRunAt`.
      expect(installed.promotedAt ?? null).toBeNull();
      expect(installed.fetchedAt).not.toBeNull();
      expect(installed.sourceContentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(installed.sourceUrls['en']).toContain('http');
      expect(installed.nodeCount).toBe(PLAUSIBLE_NODE_COUNT);

      // Nothing else moved.
      const currentAfter = await after.findOneOrFail(FeedTaxonomy, {
        providerCode: 'google_merchant',
        isCurrent: true,
      });
      expect(currentAfter.id).toBe(currentBefore.id);
      const templatesAfter = (
        await after.find(FeedTemplate, { providerCode: 'google_merchant' })
      ).map((row) => [row.id, row.taxonomyId] as const);
      expect(templatesAfter).toEqual(templatesBefore);
      expect(await after.count(FeedTaxonomyMapping, { stale: true })).toBe(0);
    });

    it('records the check row with its outcome and content hash', async () => {
      fetcher.serve('google', googleTaxonomyFile());
      const result = await check();
      const row = await h.em().findOneOrFail(FeedTaxonomyCheck, { id: result.checkId });
      expect(row.outcome).toBe('installed');
      expect(row.reason ?? null).toBeNull();
      expect(row.finishedAt).not.toBeNull();
      expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.installedTaxonomyId).toBe(result.installedTaxonomyId);
      expect(row.trigger).toBe('scheduled');
    });

    it('flags a valid but much smaller list `shrink` rather than refusing it', async () => {
      // Research §R22: a well-formed smaller taxonomy is the provider's
      // decision to make. Refusing it would put the platform's opinion above
      // the provider's and leave the operator no way to adopt a legitimate
      // revision. It installs inactive, flagged, and the impact preview is
      // where it becomes a judgement.
      await h.productFeeds.taxonomyReconciler.installRevision({
        providerCode: 'google_merchant',
        revision: '2020-01-01',
        drafts: Array.from({ length: 2000 }, (_, index) => ({
          externalId: String(index + 1),
          parentExternalId: null,
          label: { en: `n${index}` },
          fullPath: { en: `n${index}` },
          depth: 0,
        })),
        markCurrent: true,
      });

      fetcher.serve('google', googleTaxonomyFile({ count: 600 }));
      const result = await check();

      expect(result.outcome).toBe('installed');
      const installed = await h.em().findOneOrFail(FeedTaxonomy, {
        id: result.installedTaxonomyId!,
      });
      expect(installed.flags).toEqual(['shrink']);
      expect(installed.isCurrent).toBe(false);
    });
  });

  describe('an identical file (SC-021)', () => {
    it('answers `unchanged` and creates nothing, over ten consecutive checks', async () => {
      fetcher.serve('google', googleTaxonomyFile());
      const first = await check();
      expect(first.outcome).toBe('installed');

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const again = await check();
        expect(again.outcome).toBe('unchanged');
        expect(again.installedTaxonomyId).toBeNull();
      }
      expect(await h.em().count(FeedTaxonomy, { providerCode: 'google_merchant' })).toBe(1);
    });

    it('treats a trailing-newline / CRLF-only difference as unchanged', async () => {
      fetcher.serve('google', googleTaxonomyFile());
      expect((await check()).outcome).toBe('installed');

      // A CDN edge re-encoding a BOM or a trailing newline produces different
      // bytes and an identical taxonomy. Installing that would put a row in
      // front of the operator whose impact reads "0 changes" — noise that
      // trains people to promote without reading.
      const cosmetic = `﻿${googleTaxonomyFile().split('\n').join('\r\n')}\r\n`;
      fetcher.reset();
      fetcher.serve('google', cosmetic);
      const again = await check();
      expect(again.outcome).toBe('unchanged');
      expect(await h.em().count(FeedTaxonomy, { providerCode: 'google_merchant' })).toBe(1);
    });

    it('does the same for the provider that publishes no revision label (Meta)', async () => {
      fetcher.serve('facebook', metaTaxonomyFile()).otherwise({
        kind: 'body',
        body: metaTaxonomyFile(),
      });
      const first = await check('meta');
      expect(first.outcome).toBe('installed');
      // `YYYY-MM-DD-<hash8>`: the date keeps it readable, the hash prefix keeps
      // two fetches on the same day distinguishable (FR-088).
      expect(first.revision).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await check('meta')).outcome).toBe('unchanged');
      }
      expect(await h.em().count(FeedTaxonomy, { providerCode: 'meta' })).toBe(1);
    });
  });

  describe('the validation gate — no garbage may become a revision (FR-092, SC-019)', () => {
    const badResponses: ReadonlyArray<[label: string, reason: string, script: () => void]> = [
      [
        'an HTML error page',
        'not_taxonomy',
        () =>
          fetcher.otherwise({
            kind: 'result',
            result: {
              ok: false,
              outcome: 'rejected',
              reason: 'not_taxonomy',
              detail: 'The address answered with markup rather than a category list.',
              httpStatus: 200,
              bytesRead: 42,
            },
          }),
      ],
      [
        'an empty body',
        'empty',
        () =>
          fetcher.otherwise({
            kind: 'result',
            result: {
              ok: false,
              outcome: 'rejected',
              reason: 'empty',
              detail: 'The address answered with an empty file.',
              httpStatus: 200,
              bytesRead: 0,
            },
          }),
      ],
      [
        'a truncated body',
        'truncated',
        () =>
          fetcher.otherwise({
            kind: 'result',
            result: {
              ok: false,
              outcome: 'rejected',
              reason: 'truncated',
              detail: 'The download stopped at 12 of 9999 bytes.',
              httpStatus: 200,
              bytesRead: 12,
            },
          }),
      ],
      [
        'a body over the size cap',
        'too_large',
        () =>
          fetcher.otherwise({
            kind: 'result',
            result: {
              ok: false,
              outcome: 'rejected',
              reason: 'too_large',
              detail: 'The file exceeded the download limit.',
              httpStatus: 200,
              bytesRead: 9_000_000,
            },
          }),
      ],
      [
        'a 404',
        'not_found',
        () =>
          fetcher.otherwise({
            kind: 'result',
            result: {
              ok: false,
              outcome: 'failed',
              reason: 'not_found',
              detail: 'The provider answered HTTP 404.',
              httpStatus: 404,
              bytesRead: null,
            },
          }),
      ],
      [
        'a DNS failure',
        'transport',
        () =>
          fetcher.otherwise({
            kind: 'result',
            result: {
              ok: false,
              outcome: 'failed',
              reason: 'transport',
              detail: 'Error: getaddrinfo ENOTFOUND www.google.com',
              httpStatus: null,
              bytesRead: null,
            },
          }),
      ],
      [
        'a file that parses to zero nodes',
        'no_nodes',
        () => fetcher.otherwise({ kind: 'body', body: 'not a taxonomy at all\nnor this line\n' }),
      ],
      [
        'a file below the plausibility floor',
        'implausible',
        () => fetcher.otherwise({ kind: 'body', body: googleTaxonomyFile({ count: 20 }) }),
      ],
    ];

    it.each(badResponses)(
      '%s is recorded as `%s`, creates no revision and completes the job',
      async (_label, reason, script) => {
        script();
        const before = await h.em().count(FeedTaxonomy, {});

        const result = await check();

        expect(result.reason).toBe(reason);
        expect(['rejected', 'failed']).toContain(result.outcome);
        expect(result.installedTaxonomyId).toBeNull();

        const em = h.em();
        em.clear();
        expect(await em.count(FeedTaxonomy, {})).toBe(before);
        const row = await em.findOneOrFail(FeedTaxonomyCheck, { id: result.checkId });
        expect(row.reason).toBe(reason);
        expect(row.finishedAt).not.toBeNull();
        // The detail is one operator-readable line, never a stack trace.
        expect(row.detail ?? '').not.toContain('    at ');
        expect((row.detail ?? '').length).toBeLessThanOrEqual(500);
      },
    );

    it('reports a translation that failed while the authoritative file arrived as `incomplete_languages`', async () => {
      fetcher.on('en-US', { kind: 'body', body: googleTaxonomyFile() }).on('pl-PL', {
        kind: 'result',
        result: {
          ok: false,
          outcome: 'failed',
          reason: 'transport',
          detail: 'Error: socket hang up',
          httpStatus: null,
          bytesRead: null,
        },
      });

      const result = await check();
      expect(result.outcome).toBe('rejected');
      expect(result.reason).toBe('incomplete_languages');
      expect(await h.em().count(FeedTaxonomy, { providerCode: 'google_merchant' })).toBe(0);
    });
  });

  it('writes nothing anywhere under `backend/src/` (FR-098)', async () => {
    const before = newestMtimeMs(MODULE_SRC);
    fetcher.serve('google', googleTaxonomyFile({ label: '2027-01-01' }));
    const result = await check();
    expect(result.outcome).toBe('installed');
    // The bundled directory is a read-only vendored artefact of the image, and
    // its PROVENANCE.md describes what shipped — not what was downloaded later.
    expect(newestMtimeMs(MODULE_SRC)).toBe(before);
  });
});
