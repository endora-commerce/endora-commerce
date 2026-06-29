import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { z } from 'zod';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { InMemoryMailer } from '../../../src/modules/email/services/mailer.js';
import { NewsletterTokenHelper } from '../../../src/modules/newsletter/services/token.helper.js';
import { NewsletterOptInService } from '../../../src/modules/newsletter/services/opt-in.service.js';
import { NewsletterSubscriberService } from '../../../src/modules/newsletter/services/subscriber.service.js';
import type { SettingsService } from '../../../src/modules/settings/services/settings.service.js';
import { NewsletterSubscriber } from '../../../src/modules/newsletter/entities/newsletter-subscriber.entity.js';
import { NewsletterTag } from '../../../src/modules/newsletter/entities/newsletter-tag.entity.js';
import { NewsletterSubscriberTag } from '../../../src/modules/newsletter/entities/newsletter-subscriber-tag.entity.js';
import { NewsletterCustomField } from '../../../src/modules/newsletter/entities/newsletter-custom-field.entity.js';

/** Minimal SettingsService stub returning the opt-in mode + TTL for the tests. */
class FakeSettings {
  mode: 'single' | 'double' = 'double';
  async get<T>(code: string, _channelId: string, schema: z.ZodType<T>): Promise<T> {
    if (code === 'newsletter.opt_in_mode') return schema.parse(this.mode);
    if (code === 'newsletter.confirm_ttl_hours') return schema.parse(168);
    return schema.parse('' as unknown);
  }
}

describe('newsletter subscribe/confirm (US1)', () => {
  let db: TestDb;
  let settings: FakeSettings;
  let mailer: InMemoryMailer;
  let service: NewsletterSubscriberService;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    settings = new FakeSettings();
    mailer = new InMemoryMailer();
    const tokens = new NewsletterTokenHelper('test-secret');
    const optIn = new NewsletterOptInService(settings as unknown as SettingsService, tokens);
    service = new NewsletterSubscriberService({
      emFactory: () => db.em(),
      optIn,
      platformChannelId: 'default',
      links: {
        confirm: (t) => `http://x/confirm?token=${t}`,
        unsubscribe: (t) => `http://x/unsubscribe?token=${t}`,
      },
      mailer,
    });
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('double opt-in creates a pending subscriber and sends a confirmation email', async () => {
    settings.mode = 'double';
    const res = await service.subscribe({ email: 'a@example.com', salesChannelId: null });
    expect(res.status).toBe('pending');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('a@example.com');

    const sub = await db.em().findOneOrFail(NewsletterSubscriber, { email: 'a@example.com' });
    expect(sub.status).toBe('pending');

    await service.confirm(sub.id);
    db.em().clear();
    const confirmed = await db.em().findOneOrFail(NewsletterSubscriber, { email: 'a@example.com' });
    expect(confirmed.status).toBe('active');
    expect(confirmed.confirmedAt).not.toBeNull();
  });

  it('single opt-in activates immediately with no confirmation email', async () => {
    settings.mode = 'single';
    const res = await service.subscribe({ email: 'b@example.com', salesChannelId: null });
    expect(res.status).toBe('active');
    expect(mailer.sent).toHaveLength(0);
  });

  it('re-subscribing the same email merges tags + custom fields without duplicating', async () => {
    settings.mode = 'single';
    const em = db.em();
    em.create(NewsletterTag, { code: 'promotions', name: 'Promotions' });
    em.create(NewsletterCustomField, { key: 'city', label: 'City', type: 'text' });
    await em.flush();

    await service.subscribe({ email: 'c@example.com', salesChannelId: null, tags: ['promotions'] });
    await service.subscribe({
      email: 'c@example.com',
      salesChannelId: null,
      customFields: { city: 'Kraków', unknown: 'ignored' },
    });

    db.em().clear();
    const subs = await db.em().find(NewsletterSubscriber, { email: 'c@example.com' });
    expect(subs).toHaveLength(1);
    expect(subs[0]?.customFields).toEqual({ city: 'Kraków' });
    const tagLinks = await db.em().find(NewsletterSubscriberTag, { subscriberId: subs[0]!.id });
    expect(tagLinks).toHaveLength(1);
  });

  it('unsubscribe sets status + writes a suppression and is idempotent', async () => {
    settings.mode = 'single';
    await service.subscribe({ email: 'd@example.com', salesChannelId: null });
    const sub = await db.em().findOneOrFail(NewsletterSubscriber, { email: 'd@example.com' });

    await service.unsubscribe(sub.id, 'too many emails');
    await service.unsubscribe(sub.id, 'again');

    db.em().clear();
    const after = await db.em().findOneOrFail(NewsletterSubscriber, { email: 'd@example.com' });
    expect(after.status).toBe('unsubscribed');
    expect(after.unsubscribeReason).toBe('too many emails');
  });
});
