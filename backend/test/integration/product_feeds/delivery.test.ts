import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FeedDeliveryProtocol } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { FeedDeliveryAttempt } from '../../../src/modules/product_feeds/entities/feed-delivery-attempt.entity.js';
import { ProductFeed } from '../../../src/modules/product_feeds/entities/product-feed.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import {
  FeedDeliveryError,
  type FeedDeliveryAdapter,
  type FeedDeliverySendInput,
  type FeedDeliveryTarget,
} from '../../../src/modules/product_feeds/services/delivery/delivery-adapter.interface.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';

/**
 * Feature 070 — publish → deliver, end to end (FR-102, FR-103, FR-105, FR-108,
 * AS-1, AS-2, AS-6).
 *
 * The transport is a **recording stub**, not a container. What is being tested
 * here is not that `ssh2` can talk SFTP — that is the library's job — but the
 * four rules this module owns:
 *
 *  - delivery happens on the publishing branch and nowhere else;
 *  - a transport failure leaves the run published and successful;
 *  - every attempt is recorded, successful or not;
 *  - nothing recorded is a credential.
 *
 * The stub drains the body it is handed, because the real adapters do and a
 * stub that did not would let a stream leak past this test.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BASE = '/api/v1/admin/product-feeds';

interface RecordedSend {
  filename: string;
  contentType: string;
  bytes: number;
  target: FeedDeliveryTarget;
}

/** Scriptable transport: records what it was asked to send, or refuses. */
class RecordingAdapter implements FeedDeliveryAdapter {
  readonly sends: RecordedSend[] = [];
  readonly checks: FeedDeliveryTarget[] = [];
  failWith: FeedDeliveryError | null = null;

  constructor(readonly protocol: FeedDeliveryProtocol) {}

  async send(input: FeedDeliverySendInput): Promise<void> {
    let bytes = 0;
    for await (const chunk of input.body) {
      bytes += (chunk as Buffer).length;
    }
    if (this.failWith) throw this.failWith;
    this.sends.push({
      filename: input.filename,
      contentType: input.contentType,
      bytes,
      target: input.target,
    });
  }

  async check(target: FeedDeliveryTarget): Promise<void> {
    this.checks.push(target);
    if (this.failWith) throw this.failWith;
  }

  reset(): void {
    this.sends.length = 0;
    this.checks.length = 0;
    this.failWith = null;
  }
}

describe('feed delivery [integration]', () => {
  let h: BackendServerHandle;
  let feedId: string;
  const sftp = new RecordingAdapter('sftp');

  const attempts = async (): Promise<FeedDeliveryAttempt[]> => {
    const em = h.em();
    em.clear();
    return em.find(
      FeedDeliveryAttempt,
      { productFeedId: feedId },
      { orderBy: { startedAt: 'asc', id: 'asc' } },
    );
  };

  const configureDelivery = async (payload: Record<string, unknown>): Promise<void> => {
    const current = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/delivery`,
      ...ADMIN,
    });
    const existing = (current.json() as { data: { version: number } | null }).data;
    const res = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${feedId}/delivery`,
      ...ADMIN,
      payload: { ...payload, ...(existing ? { expectedVersion: existing.version } : {}) },
    });
    expect(res.statusCode).toBe(200);
  };

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer({
      feedDeliveryAdapters: new Map<FeedDeliveryProtocol, FeedDeliveryAdapter>([['sftp', sftp]]),
    });
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    await seedFeedPrices(em, { code: 'feed_delivery_default' });

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
        name: 'Delivery feed',
        slug: `delivery-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(created.statusCode).toBe(201);
    feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  // -------------------------------------------------------------------------
  // FR-100 — absent configuration means today's behaviour, exactly
  // -------------------------------------------------------------------------

  it('delivers nothing and records nothing when no target is configured', async () => {
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(['completed', 'completed_with_warnings']).toContain(run.status);
    expect(sftp.sends).toHaveLength(0);
    expect(await attempts()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AS-1 — a successful run delivers, and the attempt says so
  // -------------------------------------------------------------------------

  it('sends the published artefact after a successful run and records the attempt', async () => {
    sftp.reset();
    await configureDelivery({
      enabled: true,
      protocol: 'sftp',
      host: 'sftp.partner.example',
      username: 'acme',
      password: 'hunter2-not-in-any-row',
      directoryPath: '/incoming/feeds',
    });

    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(['completed', 'completed_with_warnings']).toContain(run.status);

    expect(sftp.sends).toHaveLength(1);
    const sent = sftp.sends[0]!;
    // The name the partner's directory receives is the same one a browser
    // download gets — `<slug>.<ext>` from the artefact's media type.
    const feed = await h.em().findOneOrFail(ProductFeed, { id: feedId });
    expect(sent.filename).toBe(`${feed.slug}.xml`);
    expect(sent.bytes).toBeGreaterThan(0);
    // The transport gets the decrypted secret; nothing else does.
    expect(sent.target.password).toBe('hunter2-not-in-any-row');

    const recorded = await attempts();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      status: 'succeeded',
      protocol: 'sftp',
      isTest: false,
      attempt: 1,
    });
    // `null` on the row, `undefined` on the hydrated entity — MikroORM maps an
    // absent optional column to `undefined`, so assert on the absence itself.
    expect(recorded[0]?.failureReason ?? null).toBeNull();
    expect(recorded[0]?.feedArtefactId).toBe(feed.publishedArtefactId);
    expect(recorded[0]?.feedRunId).toBe(run.id);
  });

  // -------------------------------------------------------------------------
  // FR-108 — nothing recorded is a credential
  // -------------------------------------------------------------------------

  it('records a redacted target that carries no password', async () => {
    const recorded = await attempts();
    const last = recorded[recorded.length - 1]!;
    expect(last.target).toBe('sftp://acme@sftp.partner.example/incoming/feeds');
    expect(last.target).not.toContain('hunter2');
  });

  // -------------------------------------------------------------------------
  // AS-2 / FR-103 — a transport failure leaves the run published
  // -------------------------------------------------------------------------

  it('leaves the run successful and published when the target is unreachable', async () => {
    sftp.reset();
    sftp.failWith = new FeedDeliveryError(
      'connection_failed',
      'The target could not be reached.',
      new Error('connect ECONNREFUSED with password hunter2-not-in-any-row'),
    );

    const before = await attempts();
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });

    // The run is what it would have been with no delivery configured at all.
    expect(['completed', 'completed_with_warnings']).toContain(run.status);
    expect(run.failureCode ?? null).toBeNull();
    const feed = await h.em().findOneOrFail(ProductFeed, { id: feedId });
    expect(feed.publishedArtefactId).toBe(run.artefactId);

    // …and the download a provider would make still works.
    const download = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(download.statusCode).toBe(200);

    const after = await attempts();
    expect(after.length).toBe(before.length + 1);
    const failure = after[after.length - 1]!;
    expect(failure.status).toBe('failed');
    expect(failure.failureReason).toBe('connection_failed');
    // FR-108 — the transport put the password in its own error message.
    expect(failure.failureDetail ?? '').not.toContain('hunter2-not-in-any-row');
    expect(failure.failureDetail ?? '').toContain('ECONNREFUSED');
  });

  // -------------------------------------------------------------------------
  // FR-101 — off keeps the configuration and sends nothing
  // -------------------------------------------------------------------------

  it('sends nothing while delivery is switched off, and keeps the target', async () => {
    sftp.reset();
    await configureDelivery({
      enabled: false,
      protocol: 'sftp',
      host: 'sftp.partner.example',
      username: 'acme',
      directoryPath: '/incoming/feeds',
    });

    const before = await attempts();
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(['completed', 'completed_with_warnings']).toContain(run.status);
    expect(sftp.sends).toHaveLength(0);
    expect(await attempts()).toHaveLength(before.length);

    // The configuration — and the password — survived being switched off.
    const view = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/delivery`,
      ...ADMIN,
    });
    expect(view.json()).toMatchObject({
      data: { enabled: false, host: 'sftp.partner.example', passwordSet: true },
    });
  });

  // -------------------------------------------------------------------------
  // AS-6 — a skipped run delivers nothing
  // -------------------------------------------------------------------------

  it('delivers nothing for a run that was skipped because one was already going', async () => {
    sftp.reset();
    await configureDelivery({
      enabled: true,
      protocol: 'sftp',
      host: 'sftp.partner.example',
      username: 'acme',
      directoryPath: '/incoming/feeds',
    });

    // Claim the feed so the next generation is skipped, exactly as a colliding
    // scheduled tick would be (FR-033).
    const em = h.em();
    const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
    feed.currentRunId = feed.lastRunId ?? null;
    await em.persistAndFlush(feed);

    const before = await attempts();
    try {
      const skipped = await h.productFeeds.generation.generateNow(feedId, { trigger: 'scheduled' });
      expect(skipped.status).toBe('skipped');
    } finally {
      const release = h.em();
      const held = await release.findOneOrFail(ProductFeed, { id: feedId });
      held.currentRunId = null;
      await release.persistAndFlush(held);
    }

    expect(sftp.sends).toHaveLength(0);
    expect(await attempts()).toHaveLength(before.length);
  });

  // -------------------------------------------------------------------------
  // FR-105 — the history is bounded but never empty
  // -------------------------------------------------------------------------

  it('keeps the newest attempts and reports them newest-first to the admin', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/delivery/attempts`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: Array<{ startedAt: string }> }).data;
    expect(rows.length).toBeGreaterThan(0);
    const timestamps = rows.map((row) => Date.parse(row.startedAt));
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });
});
