import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FeedDeliveryProtocol } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import type {
  FeedDeliveryAdapter,
  FeedDeliverySendInput,
  FeedDeliveryTarget,
} from '../../../../packages/modules/product_feeds/src/backend/services/delivery/delivery-adapter.interface.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { FeedDeliveryAttempt, ProductFeed } from '../../helpers/package-entities.js';

/**
 * Composition checklist item 7 — delivery fails closed when `credentials` is
 * absent (Constitution XVII).
 *
 * Every delivery target's password lives in `credentials` (FR-107), so
 * `resolveTarget` goes through `credentialsService`, a gated port whose owner an
 * operator can switch off. `deliver()` wraps the whole attempt in a catch-all
 * because FR-103 is absolute — a defect here must not fail a run whose artefact
 * is already published — and until the repair that catch-all absorbed the
 * presence answer too: the operator was told `internal_error`, which reads as a
 * defect in Product Feeds, for a capability they had withdrawn themselves, and
 * every retry said it again.
 *
 * Three assertions, and each is needed. The refusal, so the answer reaches the
 * caller. **No attempt row**, because a recorded attempt would be this module
 * writing down that it tried to deliver when it never resolved a target — the
 * fail-open the refusal exists to prevent. And the successful delivery on either
 * side of it, so the refusal cannot pass by breaking delivery outright.
 *
 * Absence is driven on the **platform** axis, for the reason
 * `catalog-off-selection.test.ts` records: a core module's operator axis is
 * forced `true`, so a seeded deactivation would pass while the module was
 * present throughout.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BASE = '/api/v1/admin/product-feeds';

/** Records what it was asked to send, and drains the body as a real adapter does. */
class RecordingAdapter implements FeedDeliveryAdapter {
  readonly protocol: FeedDeliveryProtocol = 'sftp';
  sends = 0;

  async send(input: FeedDeliverySendInput): Promise<void> {
    for await (const chunk of input.body) void (chunk as Buffer).length;
    this.sends += 1;
  }

  async check(_target: FeedDeliveryTarget): Promise<void> {
    return undefined;
  }
}

describe('product_feeds — an absent `credentials` refuses the delivery [integration]', () => {
  let h: BackendServerHandle;
  let feedId: string;
  let artefactId: string;
  const sftp = new RecordingAdapter();

  const attemptCount = async (): Promise<number> => {
    const em = h.em();
    em.clear();
    return em.count(FeedDeliveryAttempt, { productFeedId: feedId });
  };

  const deliver = async (): ReturnType<
    NonNullable<BackendServerHandle['productFeeds']['delivery']>['service']['deliver']
  > =>
    h.productFeeds.delivery!.service.deliver({
      feedId,
      runId: null,
      artefactId,
      attempt: 1,
      maxAttempts: 1,
    });

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer({
      feedDeliveryAdapters: new Map<FeedDeliveryProtocol, FeedDeliveryAdapter>([['sftp', sftp]]),
    });
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    await seedFeedPrices(em, { code: 'feed_credentials_off_default' });

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    const templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
    const channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;

    const created = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: 'Credentials presence feed',
        slug: `credentials-off-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(created.statusCode).toBe(201);
    feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;

    const configured = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${feedId}/delivery`,
      ...ADMIN,
      payload: {
        enabled: true,
        protocol: 'sftp',
        host: 'sftp.partner.example',
        username: 'acme',
        password: 'hunter2',
        directoryPath: '/incoming',
      },
    });
    expect(configured.statusCode).toBe(200);

    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(['completed', 'completed_with_warnings']).toContain(run.status);
    em.clear();
    artefactId = (await em.findOneOrFail(ProductFeed, { id: feedId })).publishedArtefactId!;
    expect(artefactId).toBeTruthy();
  }, 120_000);

  afterEach(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  it('delivers while `credentials` is present', async () => {
    await expect(deliver()).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('answers the presence question to the caller while `credentials` is absent', async () => {
    const before = await attemptCount();
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'credentials'));

    await expect(deliver()).rejects.toMatchObject({
      statusCode: 503,
      code: 'MODULE_DISABLED',
    });

    // Nothing was tried, so nothing is written down as having been tried.
    registryCache.__setEnabledForTesting(ALL_IDS);
    expect(await attemptCount()).toBe(before);
  });

  it('records the absence as a failed attempt on the inline path, naming the module', async () => {
    // Feature 134 D18: with no queue, generation delivers right after the run
    // is published. There is no job to fail and the run must not, so the
    // presence answer is written down where the operator reads delivery
    // history — a failed attempt that says which module is off — instead of
    // being discarded. The queued path above is unchanged.
    const before = await attemptCount();
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'credentials'));

    const outcome = await h.productFeeds.delivery!.service.deliverInline({
      feedId,
      runId: null,
      artefactId,
      attempt: 1,
      maxAttempts: 1,
    });

    registryCache.__setEnabledForTesting(ALL_IDS);
    expect(outcome).toMatchObject({ status: 'failed', failureReason: 'not_configured' });
    expect(outcome.failureDetail).toContain('"credentials"');
    expect(await attemptCount()).toBe(before + 1);
  });

  it('delivers again once `credentials` is back', async () => {
    await expect(deliver()).resolves.toMatchObject({ status: 'succeeded' });
  });
});
