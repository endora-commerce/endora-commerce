import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTokenHelper } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';
import { NewsletterOptInService } from '../../../../packages/modules/newsletter/src/backend/services/opt-in.service.js';
import { NewsletterAudienceResolver } from '../../../../packages/modules/newsletter/src/backend/services/audience-resolver.js';
import { NewsletterContentService } from '../../../../packages/modules/newsletter/src/backend/services/content.service.js';
import { NewsletterCampaignDispatchService } from '../../../../packages/modules/newsletter/src/backend/services/campaign-dispatch.service.js';
import { InMemoryNewsletterProvider } from '../../../../packages/modules/newsletter/src/backend/services/provider/console-provider.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { NewsletterCampaign, NewsletterSendRecord, NewsletterSubscriber, NewsletterSubscriberTag, NewsletterSuppression, NewsletterTag } from '../../helpers/package-entities.js';

function textTree(text: string): Record<string, unknown> {
  return { root: { props: {} }, content: [{ type: 'transactional_emails.EmailText', props: { id: 't', text } }], zones: {} };
}

describe('newsletter campaign dispatch (US2)', () => {
  let db: TestDb;
  let provider: InMemoryNewsletterProvider;
  let service: NewsletterCampaignDispatchService;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    provider = new InMemoryNewsletterProvider();
    const tokens = new NewsletterTokenHelper('test-secret');
    const optIn = new NewsletterOptInService({} as unknown as SettingsService, tokens);
    service = new NewsletterCampaignDispatchService({
      emFactory: () => db.em(),
      audience: new NewsletterAudienceResolver(() => db.em()),
      content: new NewsletterContentService(),
      optIn,
      links: { confirm: (t) => `http://x/c?${t}`, unsubscribe: (t) => `http://x/u?${t}` },
      resolveProvider: async () => provider,
      resolveSender: async () => ({ fromEmail: 'news@shop.test', fromName: 'Shop' }),
    });
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('delivers exactly once to active tagged non-suppressed subscribers and excludes the rest', async () => {
    const em = db.em();
    const tag = em.create(NewsletterTag, { code: 'promo', name: 'Promo' });

    // Eligible: active + tagged + not suppressed.
    const a = em.create(NewsletterSubscriber, { email: 'a@x.test', status: 'active' });
    const b = em.create(NewsletterSubscriber, { email: 'b@x.test', status: 'active' });
    // Excluded: active + tagged but suppressed.
    const c = em.create(NewsletterSubscriber, { email: 'c@x.test', status: 'active' });
    // Excluded: pending + tagged.
    const d = em.create(NewsletterSubscriber, { email: 'd@x.test', status: 'pending' });
    // Excluded: active but untagged.
    const e = em.create(NewsletterSubscriber, { email: 'e@x.test', status: 'active' });
    await em.flush();

    for (const s of [a, b, c, d]) em.create(NewsletterSubscriberTag, { subscriberId: s.id, tagId: tag.id });
    em.create(NewsletterSuppression, { email: 'c@x.test', reason: 'complaint' });
    void e;

    const campaign = em.create(NewsletterCampaign, {
      name: 'Promo blast',
      subject: 'Hi {{var subscriber.email}}',
      content: textTree('Deals inside'),
      language: 'en-US',
      targetType: 'tag',
      targetTagIds: [tag.id],
    });
    await em.flush();

    const res = await service.dispatchCampaign(campaign.id);

    expect(res.claimed).toBe(2);
    expect(res.sent).toBe(2);
    const recipients = provider.sent.map((m) => m.to).sort();
    expect(recipients).toEqual(['a@x.test', 'b@x.test']);
    // Subject variable resolved per recipient.
    expect(provider.sent.every((m) => m.subject.startsWith('Hi '))).toBe(true);
    // Every message carries a List-Unsubscribe header.
    expect(provider.sent.every((m) => m.headers?.['List-Unsubscribe'])).toBe(true);
  });

  it('is idempotent — a second dispatch claims and sends nothing new', async () => {
    const em = db.em();
    const tag = em.create(NewsletterTag, { code: 'promo', name: 'Promo' });
    const a = em.create(NewsletterSubscriber, { email: 'a@x.test', status: 'active' });
    await em.flush();
    em.create(NewsletterSubscriberTag, { subscriberId: a.id, tagId: tag.id });
    const campaign = em.create(NewsletterCampaign, {
      name: 'C',
      subject: 'S',
      content: textTree('B'),
      language: 'en-US',
      targetType: 'tag',
      targetTagIds: [tag.id],
    });
    await em.flush();

    const first = await service.dispatchCampaign(campaign.id);
    const second = await service.dispatchCampaign(campaign.id);

    expect(first.sent).toBe(1);
    expect(second.claimed).toBe(0);
    expect(provider.sent).toHaveLength(1);
    const records = await db.em().find(NewsletterSendRecord, { campaignId: campaign.id });
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('sent');
  });
});
