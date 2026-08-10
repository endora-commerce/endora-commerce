import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { z } from 'zod';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTokenHelper } from '../../../src/modules/newsletter/services/token.helper.js';
import { NewsletterOptInService } from '../../../src/modules/newsletter/services/opt-in.service.js';
import { NewsletterSubscriberService } from '../../../src/modules/newsletter/services/subscriber.service.js';
import { NewsletterAudienceResolver } from '../../../src/modules/newsletter/services/audience-resolver.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { NewsletterSubscriber } from '../../../src/modules/newsletter/entities/newsletter-subscriber.entity.js';
import { NewsletterTag } from '../../../src/modules/newsletter/entities/newsletter-tag.entity.js';
import { NewsletterSubscriberTag } from '../../../src/modules/newsletter/entities/newsletter-subscriber-tag.entity.js';
import { NewsletterSuppression } from '../../../src/modules/newsletter/entities/newsletter-suppression.entity.js';

class FakeSettings {
  async get<T>(code: string, _ch: string, schema: z.ZodType<T>): Promise<T> {
    if (code === 'newsletter.opt_in_mode') return schema.parse('single');
    if (code === 'newsletter.confirm_ttl_hours') return schema.parse(168);
    return schema.parse('' as unknown);
  }
}

describe('newsletter suppression + events (US3/US6 edge cases)', () => {
  let db: TestDb;
  let events: Array<{ name: string; payload: Record<string, unknown> }>;
  let service: NewsletterSubscriberService;
  let audience: NewsletterAudienceResolver;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    events = [];
    const optIn = new NewsletterOptInService(new FakeSettings() as unknown as SettingsService, new NewsletterTokenHelper('s'));
    service = new NewsletterSubscriberService({
      emFactory: () => db.em(),
      optIn,
      platformChannelId: 'default',
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
      emitEvent: (name, payload) => events.push({ name, payload }),
    });
    audience = new NewsletterAudienceResolver(() => db.em());
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('emits observability events on subscribe and unsubscribe', async () => {
    await service.subscribe({ email: 'a@x.test', salesChannelId: null });
    expect(events.map((e) => e.name)).toContain('newsletter.subscribed.v1');

    const sub = await db.em().findOneOrFail(NewsletterSubscriber, { email: 'a@x.test' });
    await service.unsubscribe(sub.id, 'bye');
    expect(events.map((e) => e.name)).toContain('newsletter.unsubscribed.v1');
  });

  it('suppresses a complaint address: excluded from audience and deactivated', async () => {
    const em = db.em();
    const tag = em.create(NewsletterTag, { code: 'promo', name: 'P' });
    const sub = em.create(NewsletterSubscriber, { email: 'b@x.test', status: 'active' });
    await em.flush();
    em.create(NewsletterSubscriberTag, { subscriberId: sub.id, tagId: tag.id });
    await em.flush();

    // Before suppression the subscriber is in the audience.
    expect(await audience.resolve({ type: 'tag', tagIds: [tag.id] })).toEqual([sub.id]);

    await service.suppress('b@x.test', 'complaint', 'feedback loop');

    // After suppression they are excluded everywhere.
    expect(await audience.resolve({ type: 'tag', tagIds: [tag.id] })).toEqual([]);
    db.em().clear();
    const after = await db.em().findOneOrFail(NewsletterSubscriber, { email: 'b@x.test' });
    expect(after.status).toBe('deactivated');
  });

  it('does not lift a complaint suppression on re-subscribe (only unsubscribe is lifted)', async () => {
    await service.suppress('c@x.test', 'complaint');
    await service.subscribe({ email: 'c@x.test', salesChannelId: null });

    db.em().clear();
    const suppression = await db.em().findOne(NewsletterSuppression, { email: 'c@x.test' });
    expect(suppression).not.toBeNull();
    expect(suppression?.reason).toBe('complaint');
  });
});
