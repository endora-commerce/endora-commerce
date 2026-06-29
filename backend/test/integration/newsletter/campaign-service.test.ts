import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTokenHelper } from '../../../src/modules/newsletter/services/token.helper.js';
import { NewsletterOptInService } from '../../../src/modules/newsletter/services/opt-in.service.js';
import { NewsletterAudienceResolver } from '../../../src/modules/newsletter/services/audience-resolver.js';
import { NewsletterContentService } from '../../../src/modules/newsletter/services/content.service.js';
import { NewsletterCampaignDispatchService } from '../../../src/modules/newsletter/services/campaign-dispatch.service.js';
import { NewsletterCampaignService } from '../../../src/modules/newsletter/services/campaign.service.js';
import { InMemoryNewsletterProvider } from '../../../src/modules/newsletter/services/provider/console-provider.js';
import type { SettingsService } from '../../../src/modules/settings/services/settings.service.js';
import { NewsletterSubscriber } from '../../../src/modules/newsletter/entities/newsletter-subscriber.entity.js';
import { NewsletterTag } from '../../../src/modules/newsletter/entities/newsletter-tag.entity.js';
import { NewsletterSubscriberTag } from '../../../src/modules/newsletter/entities/newsletter-subscriber-tag.entity.js';

function textTree(text: string): Record<string, unknown> {
  return { root: { props: {} }, content: [{ type: 'EmailText', props: { id: 't', text } }], zones: {} };
}

describe('newsletter campaign service (US2)', () => {
  let db: TestDb;
  let provider: InMemoryNewsletterProvider;
  let providerConfigured: boolean;
  let service: NewsletterCampaignService;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    provider = new InMemoryNewsletterProvider();
    providerConfigured = true;
    const optIn = new NewsletterOptInService({} as unknown as SettingsService, new NewsletterTokenHelper('s'));
    const content = new NewsletterContentService();
    const dispatch = new NewsletterCampaignDispatchService({
      emFactory: () => db.em(),
      audience: new NewsletterAudienceResolver(() => db.em()),
      content,
      optIn,
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
      resolveProvider: async () => provider,
      resolveSender: async () => ({ fromEmail: 'n@s.test', fromName: '' }),
    });
    service = new NewsletterCampaignService({
      emFactory: () => db.em(),
      dispatch,
      content,
      isProviderConfigured: async () => providerConfigured,
      // no enqueuePlan → inline dispatch
    });
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('creates a draft, edits with version check, and rejects stale writes', async () => {
    const created = await service.create({
      name: 'C',
      language: 'en-US',
      subject: 'S',
      content: textTree('B'),
      targetType: 'all',
    });
    expect(created.status).toBe('draft');
    expect(created.version).toBe(1);

    const updated = await service.update(created.id, { name: 'C2', expectedVersion: 1 });
    expect(updated.name).toBe('C2');
    expect(updated.version).toBe(2);

    await expect(service.update(created.id, { name: 'x', expectedVersion: 1 })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('blocks send when no provider is configured', async () => {
    providerConfigured = false;
    const c = await service.create({ name: 'C', language: 'en-US', subject: 'S', content: textTree('B'), targetType: 'all' });
    await expect(service.send(c.id, c.version)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('sends inline to the resolved audience and marks the campaign sent', async () => {
    const em = db.em();
    const tag = em.create(NewsletterTag, { code: 'promo', name: 'P' });
    const s1 = em.create(NewsletterSubscriber, { email: '1@x.test', status: 'active' });
    await em.flush();
    em.create(NewsletterSubscriberTag, { subscriberId: s1.id, tagId: tag.id });
    await em.flush();

    const c = await service.create({
      name: 'C',
      language: 'en-US',
      subject: 'Hi',
      content: textTree('B'),
      targetType: 'tag',
      targetTagIds: [tag.id],
    });
    const sent = await service.send(c.id, c.version);
    expect(sent.status).toBe('sent');
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.to).toBe('1@x.test');
  });

  it('cancels a draft campaign', async () => {
    const c = await service.create({ name: 'C', language: 'en-US', subject: 'S', content: textTree('B'), targetType: 'all' });
    const cancelled = await service.cancel(c.id, c.version);
    expect(cancelled.status).toBe('cancelled');
  });
});
