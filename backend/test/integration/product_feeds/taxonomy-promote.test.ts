import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRODUCT_FEED_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  googleTaxonomyFile,
  ScriptedTaxonomyFetcher,
} from '../../helpers/taxonomy-fixtures.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { Category } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { FeedTaxonomy, FeedTaxonomyMapping, FeedTemplate } from '../../helpers/package-entities.js';

/**
 * Feature 067 Phase 11 / T126 — promotion is the only thing that changes what a
 * feed emits (FR-078, FR-086, FR-094, FR-095; SC-018, SC-020, SC-022).
 *
 * The two properties this file exists to hold:
 *
 *  1. **An installing check changes nothing.** A feed generated immediately
 *     before and immediately after produces byte-identical output — which is
 *     what makes the whole fetch path safe to leave running unattended.
 *  2. **Promotion is atomic, audited exactly once, and reversible.** Rollback is
 *     the same Command against the earlier revision, which is why staleness is
 *     re-evaluated at promotion rather than at install time.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } } as const;
const ACTOR = { actorAdminUserId: null } as const;
const fetcher = new ScriptedTaxonomyFetcher();

describe('taxonomy revision promotion [integration]', () => {
  let h: BackendServerHandle;
  let categoryId: string;

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

  async function clearTaxonomies(): Promise<void> {
    const em = h.em();
    await em.getConnection().execute('delete from "product_feed_taxonomy_checks"');
    await em.getConnection().execute('delete from "product_feed_taxonomy_mappings"');
    await em.getConnection().execute('update "product_feed_templates" set "taxonomy_id" = null');
    await em.getConnection().execute('delete from "product_feed_taxonomies"');
    em.clear();
  }

  /** Node `2` exists in v1 and is dropped by v2, so a mapping onto it goes stale. */
  async function installBaseRevision(): Promise<void> {
    fetcher.reset();
    fetcher.serve('google', googleTaxonomyFile({ label: '2026-01-01' }));
    const first = await h.productFeeds.taxonomyRefresh.runCheck({
      providerCode: 'google_merchant',
      trigger: 'scheduled',
    });
    expect(first.outcome).toBe('installed');
    // Nothing is in force yet, so promote the base revision deliberately —
    // which is itself the proof that an install does not activate.
    await h.productFeeds.taxonomyRevisions.promote({
      taxonomyId: first.installedTaxonomyId!,
      expectedStaleMappingCount: 0,
    });
  }

  async function installCandidateDropping(node: string): Promise<string> {
    fetcher.reset();
    fetcher.serve(
      'google',
      googleTaxonomyFile({ label: '2026-06-01', omit: new Set([node]) }),
    );
    const result = await h.productFeeds.taxonomyRefresh.runCheck({
      providerCode: 'google_merchant',
      trigger: 'scheduled',
    });
    expect(result.outcome).toBe('installed');
    return result.installedTaxonomyId!;
  }

  beforeEach(async () => {
    await clearTaxonomies();
    await setEnabled(true);
    const em = h.em();
    const category = await em.findOne(Category, { deletedAt: null });
    categoryId = category!.id;
    em.clear();
  });

  afterEach(async () => {
    await setEnabled(false);
    await clearTaxonomies();
  });

  it('a bundled revision arriving on a provider that already has one installs INACTIVE too', async () => {
    await installBaseRevision();
    const em = h.em();
    const currentBefore = await em.findOneOrFail(FeedTaxonomy, {
      providerCode: 'google_merchant',
      isCurrent: true,
    });
    em.clear();

    // The boot reconciler's own install path. A platform upgrade must not
    // silently activate the revision that shipped in the image — activation is
    // deliberate, which is the whole point of Phase 11 (contract §2).
    await h.productFeeds.taxonomyReconciler.installRevision({
      providerCode: 'google_merchant',
      revision: 'bundled-2030-01-01',
      drafts: [
        { externalId: '1', parentExternalId: null, label: { en: 'Root' }, fullPath: { en: 'Root' }, depth: 0 },
      ],
      markCurrent: false,
    });

    const after = h.em();
    const currentAfter = await after.findOneOrFail(FeedTaxonomy, {
      providerCode: 'google_merchant',
      isCurrent: true,
    });
    expect(currentAfter.id).toBe(currentBefore.id);
    const bundled = await after.findOneOrFail(FeedTaxonomy, { revision: 'bundled-2030-01-01' });
    expect(bundled.isCurrent).toBe(false);
    expect(bundled.promotedAt ?? null).toBeNull();
  });

  it('an installing check leaves the revision in force, mapping flags and template links untouched (SC-018)', async () => {
    await installBaseRevision();
    await h.productFeeds.taxonomies.setMapping({
      providerCode: 'google_merchant',
      categoryId,
      nodeExternalId: '2',
    });

    const em = h.em();
    const currentBefore = await em.findOneOrFail(FeedTaxonomy, {
      providerCode: 'google_merchant',
      isCurrent: true,
    });
    const templatesBefore = (await em.find(FeedTemplate, { providerCode: 'google_merchant' })).map(
      (row) => [row.id, row.taxonomyId] as const,
    );
    em.clear();

    await installCandidateDropping('2');

    const after = h.em();
    expect(
      (await after.findOneOrFail(FeedTaxonomy, { providerCode: 'google_merchant', isCurrent: true }))
        .id,
    ).toBe(currentBefore.id);
    expect(
      (await after.findOneOrFail(FeedTaxonomyMapping, { categoryId, taxonomyProviderCode: 'google_merchant' }))
        .stale,
    ).toBe(false);
    expect(
      (await after.find(FeedTemplate, { providerCode: 'google_merchant' })).map(
        (row) => [row.id, row.taxonomyId] as const,
      ),
    ).toEqual(templatesBefore);
  });

  it('produces byte-identical feed output before and after an installing check (SC-018)', async () => {
    await installBaseRevision();
    await h.productFeeds.taxonomies.setMapping({
      providerCode: 'google_merchant',
      categoryId,
      nodeExternalId: '2',
    });
    await h.productFeeds.taxonomyReconciler.linkTemplatesToCurrentTaxonomies();

    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    const channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    await seedFeedPrices(em, { code: `feed_promote_${Date.now()}` });
    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    const templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((row) => row.systemCode === 'google_merchant_v1')!.id;

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Promote guard ${Date.now()}`,
        slug: `promote-guard-${Date.now()}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(created.statusCode).toBe(201);
    const feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;

    const readArtefact = async (): Promise<string> => {
      await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/product-feeds/${feedId}/artefact`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      return res.body;
    };

    const before = await readArtefact();
    await installCandidateDropping('2');
    const after = await readArtefact();

    // The whole safety argument in one assertion: a provider can publish a new
    // taxonomy overnight, the platform can download and install it, and what
    // Google receives does not move by one byte until somebody decides.
    expect(after).toBe(before);
  });

  it('the impact preview matches post-promotion reality exactly (SC-020) and writes nothing', async () => {
    await installBaseRevision();
    await h.productFeeds.taxonomies.setMapping({
      providerCode: 'google_merchant',
      categoryId,
      nodeExternalId: '2',
    });
    const candidateId = await installCandidateDropping('2');

    const em = h.em();
    const auditBefore = await em.count(AuditLogEntry, {});
    em.clear();

    const impact = await h.productFeeds.taxonomyRevisions.impact(candidateId, 'en');
    expect(impact.mappings.wouldBecomeStale).toBe(1);
    expect(impact.nodesRemoved).toBe(1);
    expect(impact.affected[0]).toMatchObject({ effect: 'becomes_stale', nodeExternalId: '2' });
    // The path comes from the revision in force — which is exactly why FR-097
    // refuses to purge the revision that still holds the label.
    expect(impact.affected[0]?.nodeFullPath).toContain('Category 2');

    // The preview performs zero writes (FR-094).
    expect(await h.em().count(AuditLogEntry, {})).toBe(auditBefore);

    await h.productFeeds.taxonomyRevisions.promote({
      taxonomyId: candidateId,
      expectedStaleMappingCount: impact.mappings.wouldBecomeStale,
    });

    const stale = await h.em().find(FeedTaxonomyMapping, {
      taxonomyProviderCode: 'google_merchant',
      stale: true,
    });
    expect(stale).toHaveLength(impact.mappings.wouldBecomeStale);
  });

  it('is atomic and produces exactly one audit entry attributed to the acting administrator (SC-022)', async () => {
    await installBaseRevision();
    const candidateId = await installCandidateDropping('2');

    const before = await h.em().count(AuditLogEntry, { action: 'product_feeds.taxonomy_revision.promote' });
    const result = await h.productFeeds.taxonomyRevisions.promote({
      taxonomyId: candidateId,
      expectedStaleMappingCount: 0,
    });

    const em = h.em();
    const entries = await em.find(AuditLogEntry, {
      action: 'product_feeds.taxonomy_revision.promote',
    });
    expect(entries).toHaveLength(before + 1);
    const entry = entries[entries.length - 1]!;
    expect(entry.objectType).toBe('product_feed_taxonomy');
    expect(entry.objectId).toBe(candidateId);
    // "What did that promotion cost", answerable without a database session.
    expect(entry.stateAfter).toMatchObject({ isCurrent: true, revision: result.revision });

    const promoted = await em.findOneOrFail(FeedTaxonomy, { id: candidateId });
    expect(promoted.isCurrent).toBe(true);
    expect(promoted.promotedAt).not.toBeNull();
    const demoted = await em.findOneOrFail(FeedTaxonomy, { revision: '2026-01-01' });
    expect(demoted.isCurrent).toBe(false);
    expect(demoted.supersededAt).not.toBeNull();
    // Templates follow the revision in force in the same transaction.
    for (const template of await em.find(FeedTemplate, { providerCode: 'google_merchant' })) {
      expect(template.taxonomyId).toBe(candidateId);
    }
  });

  it('refuses a promotion whose acknowledgement no longer matches, and changes nothing', async () => {
    await installBaseRevision();
    await h.productFeeds.taxonomies.setMapping({
      providerCode: 'google_merchant',
      categoryId,
      nodeExternalId: '2',
    });
    const candidateId = await installCandidateDropping('2');

    // The operator's preview said 1. A colleague then removed the mapping, so
    // the real figure is 0 — the case the acknowledgement exists to catch.
    await h.productFeeds.taxonomies.setMapping({
      providerCode: 'google_merchant',
      categoryId,
      nodeExternalId: null,
    });

    await expect(
      h.productFeeds.taxonomyRevisions.promote({
        taxonomyId: candidateId,
        expectedStaleMappingCount: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409, details: { reason: 'impact_changed' } });

    const em = h.em();
    expect(
      (await em.findOneOrFail(FeedTaxonomy, { providerCode: 'google_merchant', isCurrent: true }))
        .revision,
    ).toBe('2026-01-01');
  });

  it('refuses promoting the revision that is already in force', async () => {
    await installBaseRevision();
    const em = h.em();
    const current = await em.findOneOrFail(FeedTaxonomy, {
      providerCode: 'google_merchant',
      isCurrent: true,
    });
    em.clear();

    await expect(
      h.productFeeds.taxonomyRevisions.promote({
        taxonomyId: current.id,
        expectedStaleMappingCount: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'taxonomy_revision_already_current' },
    });
  });

  it('rolls back by the same route: promoting the previous revision restores its flags', async () => {
    await installBaseRevision();
    await h.productFeeds.taxonomies.setMapping({
      providerCode: 'google_merchant',
      categoryId,
      nodeExternalId: '2',
    });
    const candidateId = await installCandidateDropping('2');
    const em = h.em();
    const original = await em.findOneOrFail(FeedTaxonomy, { revision: '2026-01-01' });
    em.clear();

    await h.productFeeds.taxonomyRevisions.promote({
      taxonomyId: candidateId,
      expectedStaleMappingCount: 1,
    });
    expect(
      (await h.em().findOneOrFail(FeedTaxonomyMapping, { categoryId })).stale,
    ).toBe(true);

    // Rollback is not a special mode — research §R26 makes it the same Command,
    // and staleness is a property of the revision in force, so it comes back.
    await h.productFeeds.taxonomyRevisions.promote({
      taxonomyId: original.id,
      expectedStaleMappingCount: 0,
    });

    const after = h.em();
    expect((await after.findOneOrFail(FeedTaxonomyMapping, { categoryId })).stale).toBe(false);
    expect(
      (await after.findOneOrFail(FeedTaxonomy, { providerCode: 'google_merchant', isCurrent: true }))
        .id,
    ).toBe(original.id);
  });
});
