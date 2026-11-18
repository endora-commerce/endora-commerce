import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTokenHelper } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';
import { NewsletterOptInService } from '../../../../packages/modules/newsletter/src/backend/services/opt-in.service.js';
import { NewsletterAudienceResolver } from '../../../../packages/modules/newsletter/src/backend/services/audience-resolver.js';
import { NewsletterContentService } from '../../../../packages/modules/newsletter/src/backend/services/content.service.js';
import { NewsletterCampaignDispatchService } from '../../../../packages/modules/newsletter/src/backend/services/campaign-dispatch.service.js';
import { NewsletterCampaignService } from '../../../../packages/modules/newsletter/src/backend/services/campaign.service.js';
import { InMemoryNewsletterProvider } from '../../../../packages/modules/newsletter/src/backend/services/provider/console-provider.js';
import {
  NO_USABLE_CREDENTIAL_ERROR,
  UnconfiguredNewsletterProvider,
} from '../../../../packages/modules/newsletter/src/backend/services/provider/provider-registry.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { SettingsService as KernelSettingsService } from '../../../src/kernel/settings/settings.service.js';
import { BrandingService } from '../../../../packages/modules/transactional_emails/src/backend/services/branding.service.js';
import {
  NewsletterSendRecord,
  NewsletterSubscriber,
  NewsletterSubscriberTag,
  NewsletterSuppression,
  NewsletterTag,
} from '../../helpers/package-entities.js';

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
      audience: new NewsletterAudienceResolver(() => db.em()),
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

  it('fails every recipient with the reason when dispatch finds no usable credential (issue #1334)', async () => {
    // A campaign scheduled while a credential was chosen, dispatched after it
    // was removed: a production instance has no console sink to fall back to,
    // so each send record is failed with the reason instead of marked sent.
    const em = db.em();
    const tag = em.create(NewsletterTag, { code: `t${randomUUID().slice(0, 8)}`, name: 'P' });
    const s1 = em.create(NewsletterSubscriber, { email: `nocred-${randomUUID()}@x.test`, status: 'active' });
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

    const dispatch = new NewsletterCampaignDispatchService({
      emFactory: () => db.em(),
      audience: new NewsletterAudienceResolver(() => db.em()),
      content: new NewsletterContentService(),
      optIn: new NewsletterOptInService({} as unknown as SettingsService, new NewsletterTokenHelper('s')),
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
      resolveProvider: async () => new UnconfiguredNewsletterProvider(),
      resolveSender: async () => ({ fromEmail: 'n@s.test', fromName: '' }),
    });
    const result = await dispatch.dispatchCampaign(c.id);

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    const records = await db.em().find(NewsletterSendRecord, { campaignId: c.id });
    expect(records.map((r) => [r.status, r.error])).toEqual([['failed', NO_USABLE_CREDENTIAL_ERROR]]);
  });

  it('reports the audience a draft would reach, so the send confirmation can name it (issue #1462)', async () => {
    // A fresh tag keeps the count exact: `setupTestDb` truncates nothing, so an
    // `all` audience also holds whatever subscribers other files left behind.
    const em = db.em();
    const tag = em.create(NewsletterTag, { code: `a${randomUUID().slice(0, 8)}`, name: 'A' });
    const active = [1, 2, 3].map((n) =>
      em.create(NewsletterSubscriber, { email: `aud${n}-${randomUUID()}@x.test`, status: 'active' }),
    );
    const pending = em.create(NewsletterSubscriber, { email: `aud-p-${randomUUID()}@x.test`, status: 'pending' });
    const suppressedEmail = `aud-s-${randomUUID()}@x.test`;
    const suppressed = em.create(NewsletterSubscriber, { email: suppressedEmail, status: 'active' });
    em.create(NewsletterSuppression, { email: suppressedEmail, reason: 'bounce' });
    await em.flush();
    for (const s of [...active, pending, suppressed]) em.create(NewsletterSubscriberTag, { subscriberId: s.id, tagId: tag.id });
    await em.flush();

    const created = await service.create({
      name: 'C',
      language: 'en-US',
      subject: 'S',
      content: textTree('B'),
      targetType: 'tag',
      targetTagIds: [tag.id],
    });
    // Pending and suppressed subscribers are not reached, exactly as at dispatch.
    expect(created.audienceEstimate).toBe(3);
    expect((await service.get(created.id)).audienceEstimate).toBe(3);

    const retargeted = await service.update(created.id, { targetType: 'tag', targetTagIds: [], expectedVersion: created.version });
    expect(retargeted.audienceEstimate).toBe(0);

    const grouped = await service.update(created.id, { targetType: 'group', expectedVersion: retargeted.version });
    expect(grouped.audienceEstimate).toBe(0);
    const withGroup = await service.setGroup(created.id, [active[0]!.id, pending.id]);
    expect(withGroup.audienceEstimate).toBe(1);
  });

  it('reports no audience estimate once a campaign has left draft', async () => {
    const c = await service.create({ name: 'C', language: 'en-US', subject: 'S', content: textTree('B'), targetType: 'all' });
    const cancelled = await service.cancel(c.id, c.version);
    expect(cancelled.audienceEstimate).toBeNull();
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
        audience: new NewsletterAudienceResolver(() => db.em()),
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
      // A campaign targeting `all` reaches every active subscriber in the
      // database, and `setupTestDb` truncates nothing, so the audience also
      // holds whatever subscribers another file left behind
      // (`tenancy/scoped-empty-explains-itself.test.ts` seeds two). The
      // assertion is therefore about the subscriber this test wrote, under an
      // address nothing else can have, and not about the size of the audience.
      const email = `branded-${randomUUID()}@x.test`;
      db.em().create(NewsletterSubscriber, { email, status: 'active' });
      await db.em().flush();
      const c = await branded.create({ name: 'C', language: 'en-US', subject: 'Hi', content: textTree('Body'), targetType: 'all' });
      db.em().clear();

      const sent = await branded.send(c.id, c.version);

      expect(sent.status).toBe('sent');
      expect(provider.sent.filter((m) => m.to === email)).toHaveLength(1);
      // Branding is read once per recipient, so the count follows the audience;
      // what this case is about is *which* channel every read was made for.
      expect(branding.asked.length).toBeGreaterThan(0);
      expect([...new Set(branding.asked)]).toEqual([db.systemDefaultChannelId]);
    });
  });
});
