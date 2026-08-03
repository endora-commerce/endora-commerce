import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRODUCT_FEED_SETTING_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  googleTaxonomyFile,
  metaTaxonomyFile,
  ScriptedTaxonomyFetcher,
} from '../../helpers/taxonomy-fixtures.js';
import { TAXONOMY_REFRESH_SCHEDULER_ID } from '../../../src/modules/product_feeds/workers/taxonomy-refresh-worker.js';
import { FeedTaxonomy } from '../../../src/modules/product_feeds/entities/feed-taxonomy.entity.js';
import { FeedTaxonomyCheck } from '../../../src/modules/product_feeds/entities/feed-taxonomy-check.entity.js';

/**
 * Feature 067 Phase 11 / T125 — **off is the shipped default, and off is a
 * fully supported state** (FR-087, SC-017).
 *
 * This is not a formality. It is the test that keeps air-gapped installations
 * working, and it is the reason the master switch defaults to `false`: a
 * supported configuration that is never the default is a configuration that
 * rots. Every dev environment and every CI run exercises this state, because it
 * is the state the platform ships in.
 *
 * What "off" has to mean, structurally rather than by care:
 *
 *  - **no Job Scheduler exists** — not a job that wakes weekly and returns
 *    early, which would still be a scheduled task an operator has to explain to
 *    their security review;
 *  - `POST /checks` is refused, naming the setting;
 *  - the egress transport is **never called**, across boot, a scheduling
 *    reconcile and a full generation run.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } } as const;
const ACTOR = { actorAdminUserId: null } as const;

const fetcher = new ScriptedTaxonomyFetcher();

describe('taxonomy fetch, switched off [integration]', () => {
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

  beforeEach(async () => {
    fetcher.reset();
    fetcher
      .serve('google', googleTaxonomyFile())
      .serve('facebook', metaTaxonomyFile())
      .otherwise({ kind: 'body', body: googleTaxonomyFile() });
    const em = h.em();
    await em.getConnection().execute('delete from "product_feed_taxonomy_checks"');
    em.clear();
  });

  afterEach(async () => {
    // The whole suite shares one database and one settings table. Leaving the
    // switch on would turn every later file into a test of the on state.
    await setEnabled(false);
  });

  it('ships off — the manifest default is `false` (FR-087)', async () => {
    const value = await h.settings.settingsService.get(
      PRODUCT_FEED_SETTING_CODES.TAXONOMY_FETCH_ENABLED,
      '00000000-0000-0000-0000-000000000000',
      (await import('zod')).z.boolean(),
    );
    expect(value).toBe(false);
  });

  it('installs no `product_feeds:taxonomy-refresh` scheduler while off', async () => {
    await setEnabled(false);
    const outcome = await h.productFeeds.schedules.reconcileTaxonomyRefreshSchedule();
    // With no Redis in the harness the port is the no-op, so what is asserted
    // is the DECISION: off resolves to "remove", never to "install".
    expect(outcome).toBe('removed');
    expect(TAXONOMY_REFRESH_SCHEDULER_ID).toBe('product_feeds:taxonomy-refresh');
  });

  it('installs the scheduler when the switch goes on, and removes it when it goes off', async () => {
    const calls: Array<'ensure' | 'remove'> = [];
    const { FeedScheduleReconciler } = await import(
      '../../../src/modules/product_feeds/services/feed-schedule-reconciler.js'
    );
    let enabled = true;
    const reconciler = new FeedScheduleReconciler({
      emFactory: h.em,
      scheduler: h.productFeeds.scheduler,
      taxonomyRefreshSchedule: {
        async ensure() {
          calls.push('ensure');
        },
        async remove() {
          calls.push('remove');
        },
      },
      taxonomyRefreshSettings: {
        enabled: async () => enabled,
        cron: async () => '0 4 * * 1',
      },
    });

    expect(await reconciler.reconcileTaxonomyRefreshSchedule()).toBe('installed');
    enabled = false;
    expect(await reconciler.reconcileTaxonomyRefreshSchedule()).toBe('removed');
    expect(calls).toEqual(['ensure', 'remove']);
  });

  it('refuses `POST /checks` with `409 taxonomy_fetch_disabled`, naming the setting', async () => {
    await setEnabled(false);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/feed-taxonomies/checks',
      ...ADMIN,
      payload: { providerCode: 'google_merchant' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { details?: { reason?: string }; message: string } };
    expect(body.error.details?.reason).toBe('taxonomy_fetch_disabled');
    // The operator has to be able to find the switch from the refusal alone.
    expect(body.error.message).toContain('Check for new taxonomy revisions');
    expect(fetcher.requests).toEqual([]);
  });

  it('makes zero outbound requests across boot, a scheduling reconcile and a generation run (SC-017)', async () => {
    await setEnabled(false);

    // Boot-shaped work: the bundled reconcile and the schedule reconcile.
    await h.productFeeds.reconcileTaxonomies();
    await h.productFeeds.schedules.reconcileTaxonomyRefreshSchedule();

    // A full generation run over the seeded catalogue, if one is configured.
    const feeds = await h.productFeeds.feeds.listRows(1);
    const feedId = feeds[0]?.feed.id;
    if (feedId) {
      await h.productFeeds.generation
        .generateNow(feedId, { trigger: 'manual' })
        .catch(() => undefined);
    }

    expect(fetcher.requests).toEqual([]);
  });

  it('leaves the revisions surface fully readable — off removes a capability, never information', async () => {
    await setEnabled(false);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-taxonomies/revisions?providerCode=google_merchant',
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const checks = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-taxonomies/checks?providerCode=google_merchant',
      ...ADMIN,
    });
    expect(checks.statusCode).toBe(200);
  });

  it('records nothing and creates no revision when a check is somehow reached while off', async () => {
    // Belt and braces: with the switch off no scheduler exists, so this path is
    // unreachable in production. It stays covered because "no outbound request
    // whatsoever" must not depend on the reconciler having run.
    await setEnabled(false);
    const em = h.em();
    const before = await em.count(FeedTaxonomy, { providerCode: 'google_merchant' });

    const result = await h.productFeeds.taxonomyRefresh.runCheck({
      providerCode: 'google_merchant',
      trigger: 'scheduled',
    });

    expect(result.outcome).toBe('failed');
    expect(fetcher.requests).toEqual([]);
    em.clear();
    expect(await em.count(FeedTaxonomy, { providerCode: 'google_merchant' })).toBe(before);
    const check = await em.findOneOrFail(FeedTaxonomyCheck, { id: result.checkId });
    expect(check.finishedAt).not.toBeNull();
  });
});
