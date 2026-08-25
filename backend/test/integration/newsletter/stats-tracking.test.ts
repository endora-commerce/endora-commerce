import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTrackingService } from '../../../../packages/modules/newsletter/src/backend/services/tracking.service.js';
import { NewsletterStatsService } from '../../../../packages/modules/newsletter/src/backend/services/stats.service.js';
import { NewsletterCampaign, NewsletterSendRecord, NewsletterSubscriber } from '../../helpers/package-entities.js';

describe('newsletter stats + tracking (US6)', () => {
  let db: TestDb;
  let tracking: NewsletterTrackingService;
  let stats: NewsletterStatsService;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    tracking = new NewsletterTrackingService(() => db.em());
    stats = new NewsletterStatsService(() => db.em());
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('aggregates sent/failed/opened/clicked + per-link clicks', async () => {
    const em = db.em();
    const campaign = em.create(NewsletterCampaign, {
      name: 'C',
      subject: 'S',
      content: {},
      language: 'en-US',
      targetType: 'all',
    });
    const subs = ['a', 'b', 'c'].map((n) => em.create(NewsletterSubscriber, { email: `${n}@x.test`, status: 'active' }));
    await em.flush();
    const r1 = em.create(NewsletterSendRecord, { campaignId: campaign.id, subscriberId: subs[0]!.id, status: 'sent' });
    em.create(NewsletterSendRecord, { campaignId: campaign.id, subscriberId: subs[1]!.id, status: 'sent' });
    em.create(NewsletterSendRecord, { campaignId: campaign.id, subscriberId: subs[2]!.id, status: 'failed' });
    await em.flush();

    // Record an open + two clicks (one link) for record 1.
    await tracking.recordOpen(r1.id);
    await tracking.recordClick(r1.id, 'cta', 'https://shop.test/deal');
    await tracking.recordClick(r1.id, 'cta', 'https://shop.test/deal');

    const s = await stats.campaignStats(campaign.id);
    expect(s.sent).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.opened).toBe(1);
    expect(s.clicked).toBe(1);
    expect(s.openRate).toBe(0.5); // 1 open / 2 sent
    expect(s.perLinkClicks).toEqual([{ url: 'https://shop.test/deal', clicks: 2 }]);

    db.em().clear();
    const rec = await db.em().findOneOrFail(NewsletterSendRecord, { id: r1.id });
    expect(rec.openedAt).not.toBeNull();
    expect(rec.clickCount).toBe(2);
  });
});
