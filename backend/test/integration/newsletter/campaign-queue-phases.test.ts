import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTokenHelper } from '../../../src/modules/newsletter/services/token.helper.js';
import { NewsletterOptInService } from '../../../src/modules/newsletter/services/opt-in.service.js';
import { NewsletterAudienceResolver } from '../../../src/modules/newsletter/services/audience-resolver.js';
import { NewsletterContentService } from '../../../src/modules/newsletter/services/content.service.js';
import { NewsletterCampaignDispatchService } from '../../../src/modules/newsletter/services/campaign-dispatch.service.js';
import { InMemoryNewsletterProvider } from '../../../src/modules/newsletter/services/provider/console-provider.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { NewsletterSubscriber } from '../../../src/modules/newsletter/entities/newsletter-subscriber.entity.js';
import { NewsletterTag } from '../../../src/modules/newsletter/entities/newsletter-tag.entity.js';
import { NewsletterSubscriberTag } from '../../../src/modules/newsletter/entities/newsletter-subscriber-tag.entity.js';
import { NewsletterCampaign } from '../../../src/modules/newsletter/entities/newsletter-campaign.entity.js';

function textTree(text: string): Record<string, unknown> {
  return { root: { props: {} }, content: [{ type: 'EmailText', props: { id: 't', text } }], zones: {} };
}

/**
 * Validates the exact two-phase queue semantics the BullMQ campaign-plan and
 * send workers rely on: plan claims atomically (idempotent), send delivers one
 * record (idempotent on re-delivery).
 */
describe('newsletter campaign queue phases (US2 / Principle X)', () => {
  let db: TestDb;
  let provider: InMemoryNewsletterProvider;
  let dispatch: NewsletterCampaignDispatchService;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    provider = new InMemoryNewsletterProvider();
    const optIn = new NewsletterOptInService(
      {} as unknown as SettingsService,
      new NewsletterTokenHelper('s'),
    );
    dispatch = new NewsletterCampaignDispatchService({
      emFactory: () => db.em(),
      audience: new NewsletterAudienceResolver(() => db.em()),
      content: new NewsletterContentService(),
      optIn,
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
      resolveProvider: async () => provider,
      resolveSender: async () => ({ fromEmail: 'n@s.test', fromName: '' }),
    });
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('plan claims idempotently and send delivers each record once', async () => {
    const em = db.em();
    const tag = em.create(NewsletterTag, { code: 'promo', name: 'P' });
    const s1 = em.create(NewsletterSubscriber, { email: '1@x.test', status: 'active' });
    const s2 = em.create(NewsletterSubscriber, { email: '2@x.test', status: 'active' });
    await em.flush();
    em.create(NewsletterSubscriberTag, { subscriberId: s1.id, tagId: tag.id });
    em.create(NewsletterSubscriberTag, { subscriberId: s2.id, tagId: tag.id });
    const campaign = em.create(NewsletterCampaign, {
      name: 'C',
      subject: 'S',
      content: textTree('Body'),
      language: 'en-US',
      targetType: 'tag',
      targetTagIds: [tag.id],
    });
    await em.flush();

    // Phase 1: plan claims both; re-planning claims nothing new.
    const first = await dispatch.planCampaign(campaign.id);
    expect(first).toHaveLength(2);
    const again = await dispatch.planCampaign(campaign.id);
    expect(again).toHaveLength(0);

    db.em().clear();
    const sending = await db.em().findOneOrFail(NewsletterCampaign, { id: campaign.id });
    expect(sending.status).toBe('sending');

    // Phase 2: send each record once; re-sending the same record is a no-op.
    expect(await dispatch.sendRecord(first[0]!)).toBe('sent');
    expect(await dispatch.sendRecord(first[0]!)).toBe('skipped');
    expect(await dispatch.sendRecord(first[1]!)).toBe('sent');
    expect(provider.sent).toHaveLength(2);
  });
});
