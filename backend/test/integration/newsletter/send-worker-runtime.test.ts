import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { NewsletterTokenHelper } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';
import { NewsletterOptInService } from '../../../../packages/modules/newsletter/src/backend/services/opt-in.service.js';
import { NewsletterAudienceResolver } from '../../../../packages/modules/newsletter/src/backend/services/audience-resolver.js';
import { NewsletterContentService } from '../../../../packages/modules/newsletter/src/backend/services/content.service.js';
import { NewsletterCampaignDispatchService } from '../../../../packages/modules/newsletter/src/backend/services/campaign-dispatch.service.js';
import { InMemoryNewsletterProvider } from '../../../../packages/modules/newsletter/src/backend/services/provider/console-provider.js';
import { createSendQueue, createSendWorker } from '../../../../packages/modules/newsletter/src/backend/services/queues/newsletter-queues.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { NewsletterCampaign, NewsletterSendRecord, NewsletterSubscriber } from '../../helpers/package-entities.js';

/**
 * Real Redis/BullMQ runtime proof (feature 048, Principle X): a `newsletter.send`
 * job flows queue → worker → provider, and the claimed send record transitions
 * to `sent`. Uses a unique queue prefix and committed rows (the worker runs in
 * its own context), cleaning both up afterwards.
 */
const prefix = `test-nl-${Date.now()}`;

describe('newsletter send worker runtime (Principle X)', () => {
  let orm: MikroORM;
  let redis: Redis;
  const provider = new InMemoryNewsletterProvider();
  const ids = { campaign: '', subscriber: '', record: '' };

  beforeAll(async () => {
    orm = await MikroORM.init(await mikroOrmConfig());
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });

    const em = orm.em.fork() as EntityManager;
    const campaign = em.create(NewsletterCampaign, {
      name: 'RT',
      subject: 'Hi {{var subscriber.email}}',
      content: { root: { props: {} }, content: [{ type: 'transactional_emails.EmailText', props: { id: 't', text: 'Body' } }], zones: {} },
      language: 'en-US',
      targetType: 'all',
    });
    const subscriber = em.create(NewsletterSubscriber, { email: 'rt@x.test', status: 'active' });
    await em.flush();
    const record = em.create(NewsletterSendRecord, {
      campaignId: campaign.id,
      subscriberId: subscriber.id,
      status: 'queued',
    });
    await em.flush();
    ids.campaign = campaign.id;
    ids.subscriber = subscriber.id;
    ids.record = record.id;
  });

  afterAll(async () => {
    const em = orm.em.fork() as EntityManager;
    await em.nativeDelete(NewsletterSendRecord, { id: ids.record });
    await em.nativeDelete(NewsletterCampaign, { id: ids.campaign });
    await em.nativeDelete(NewsletterSubscriber, { id: ids.subscriber });
    await orm.close(true);
    await redis.quit();
  });

  it('processes a send job and marks the record sent', async () => {
    const optIn = new NewsletterOptInService({} as unknown as SettingsService, new NewsletterTokenHelper('s'));
    const dispatch = new NewsletterCampaignDispatchService({
      emFactory: () => orm.em.fork() as EntityManager,
      audience: new NewsletterAudienceResolver(() => orm.em.fork() as EntityManager),
      content: new NewsletterContentService(),
      optIn,
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
      resolveProvider: async () => provider,
      resolveSender: async () => ({ fromEmail: 'n@s.test', fromName: '' }),
    });

    const queue = createSendQueue(redis, { prefix });
    const worker = createSendWorker(
      redis,
      async (job) => {
        await dispatch.sendRecord(job.data.recordId);
      },
      50,
      { prefix },
    );
    await worker.waitUntilReady();

    try {
      await queue.add('send', { recordId: ids.record });

      // Poll until the record is sent (or time out).
      let sent = false;
      for (let i = 0; i < 80 && !sent; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        const em = orm.em.fork() as EntityManager;
        const rec = await em.findOne(NewsletterSendRecord, { id: ids.record });
        sent = rec?.status === 'sent';
      }

      expect(sent).toBe(true);
      expect(provider.sent.some((m) => m.to === 'rt@x.test')).toBe(true);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
  });
});
