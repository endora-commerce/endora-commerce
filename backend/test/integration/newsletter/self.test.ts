import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { z } from 'zod';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTokenHelper } from '../../../src/modules/newsletter/services/token.helper.js';
import { NewsletterOptInService } from '../../../src/modules/newsletter/services/opt-in.service.js';
import { NewsletterSubscriberService } from '../../../src/modules/newsletter/services/subscriber.service.js';
import { NewsletterSelfService } from '../../../src/modules/newsletter/services/self.service.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { NewsletterSubscriber } from '../../../src/modules/newsletter/entities/newsletter-subscriber.entity.js';

class FakeSettings {
  async get<T>(code: string, _ch: string, schema: z.ZodType<T>): Promise<T> {
    if (code === 'newsletter.opt_in_mode') return schema.parse('single');
    if (code === 'newsletter.confirm_ttl_hours') return schema.parse(168);
    return schema.parse('' as unknown);
  }
}

describe('newsletter self-service (US9)', () => {
  let db: TestDb;
  let self: NewsletterSelfService;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    const optIn = new NewsletterOptInService(new FakeSettings() as unknown as SettingsService, new NewsletterTokenHelper('s'));
    const subscribers = new NewsletterSubscriberService({
      emFactory: () => db.em(),
      optIn,
      defaultChannelId: null,
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
    });
    self = new NewsletterSelfService(() => db.em(), subscribers);
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('reports not-subscribed, then subscribes, shows status + tags, then unsubscribes', async () => {
    const email = 'me@x.test';
    const accountId = '11111111-1111-1111-1111-111111111111';

    expect(await self.getStatus(email)).toMatchObject({ subscribed: false, status: null, tags: [] });

    const sub = await self.subscribe(email, accountId, ['promo']);
    expect(sub.status).toBe('active');

    db.em().clear();
    const record = await db.em().findOneOrFail(NewsletterSubscriber, { email });
    expect(record.customerAccountId).toBe(accountId);

    const status = await self.getStatus(email);
    expect(status.subscribed).toBe(true);
    expect(status.status).toBe('active');

    await self.unsubscribe(email, 'no longer interested');
    const after = await self.getStatus(email);
    expect(after.subscribed).toBe(false);
    expect(after.status).toBe('unsubscribed');
  });
});
