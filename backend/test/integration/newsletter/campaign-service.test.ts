import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTokenHelper } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';
import { NewsletterOptInService } from '../../../../packages/modules/newsletter/src/backend/services/opt-in.service.js';
import { NewsletterAudienceResolver } from '../../../../packages/modules/newsletter/src/backend/services/audience-resolver.js';
import { NewsletterContentService } from '../../../../packages/modules/newsletter/src/backend/services/content.service.js';
import { NewsletterCampaignDispatchService } from '../../../../packages/modules/newsletter/src/backend/services/campaign-dispatch.service.js';
import { NewsletterCampaignService } from '../../../../packages/modules/newsletter/src/backend/services/campaign.service.js';
import { InMemoryNewsletterProvider } from '../../../../packages/modules/newsletter/src/backend/services/provider/console-provider.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { SettingsService as KernelSettingsService } from '../../../src/kernel/settings/settings.service.js';
import { BrandingService } from '../../../../packages/modules/transactional_emails/src/backend/services/branding.service.js';
import { NewsletterSubscriber, NewsletterSubscriberTag, NewsletterTag } from '../../helpers/package-entities.js';

function textTree(text: string): Record<string, unknown> {
  return { root: { props: {} }, content: [{ type: 'transactional_emails.EmailText', props: { id: 't', text } }], zones: {} };
}

/**
 * Issue #121 — the branding source a deployment actually composes: the real
 * `BrandingService` over the real settings reader, which is what refuses a
 * channel id that is neither a uuid nor `null`. The harness contributes no
 * branding source at all, so nothing else in this directory reaches that guard.
 * `asked` records the channel every read was made for.
 */
function deploymentBranding(db: TestDb): {
  resolve: (salesChannelId: string | null) => Promise<{ logoUrl: string; accentColor: string }>;
  asked: Array<string | null>;
} {
  const branding = new BrandingService(new KernelSettingsService(() => db.em()));
  const asked: Array<string | null> = [];
  return {
    asked,
    resolve: async (salesChannelId) => {
      asked.push(salesChannelId);
      return branding.resolve(salesChannelId);
    },
  };
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

  describe('a campaign with no sales channel (issue #121)', () => {
    let branding: ReturnType<typeof deploymentBranding>;
    let branded: NewsletterCampaignService;

    beforeEach(() => {
      branding = deploymentBranding(db);
      const content = new NewsletterContentService();
      const optIn = new NewsletterOptInService({} as unknown as SettingsService, new NewsletterTokenHelper('s'));
      const dispatch = new NewsletterCampaignDispatchService({
        emFactory: () => db.em(),
        audience: new NewsletterAudienceResolver(() => db.em()),
        content,
        optIn,
        links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
        resolveProvider: async () => provider,
        resolveSender: async () => ({ fromEmail: 'n@s.test', fromName: '' }),
        resolveEmailBranding: branding.resolve,
        resolveDefaultChannelId: async () => db.systemDefaultChannelId,
      });
      branded = new NewsletterCampaignService({
        emFactory: () => db.em(),
        dispatch,
        content,
        isProviderConfigured: async () => true,
        resolveEmailBranding: branding.resolve,
        resolveDefaultChannelId: async () => db.systemDefaultChannelId,
      });
    });

    it('previews with the default sales channel\'s branding', async () => {
      const c = await branded.create({ name: 'C', language: 'en-US', subject: 'S', content: textTree('Body'), targetType: 'all' });
      expect(c.salesChannelId).toBeNull();
      // A preview is its own request: the campaign is read back from the row,
      // not handed over by the request that created it.
      db.em().clear();

      const preview = await branded.preview(c.id);

      expect(preview.html).toContain('Body');
      expect(branding.asked).toEqual([db.systemDefaultChannelId]);
    });

    it('sends with the default sales channel\'s branding', async () => {
      db.em().create(NewsletterSubscriber, { email: '1@x.test', status: 'active' });
      await db.em().flush();
      const c = await branded.create({ name: 'C', language: 'en-US', subject: 'Hi', content: textTree('Body'), targetType: 'all' });
      db.em().clear();

      const sent = await branded.send(c.id, c.version);

      expect(sent.status).toBe('sent');
      expect(provider.sent.map((m) => m.to)).toEqual(['1@x.test']);
      expect(branding.asked).toEqual([db.systemDefaultChannelId]);
    });
  });
});
