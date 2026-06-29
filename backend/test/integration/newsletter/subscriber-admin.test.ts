import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTagService } from '../../../src/modules/newsletter/services/tag.service.js';
import { NewsletterCustomFieldService } from '../../../src/modules/newsletter/services/custom-field.service.js';
import { NewsletterSubscriberAdminService } from '../../../src/modules/newsletter/services/subscriber-admin.service.js';
import { NewsletterSubscriber } from '../../../src/modules/newsletter/entities/newsletter-subscriber.entity.js';
import { NewsletterSubscriberTag } from '../../../src/modules/newsletter/entities/newsletter-subscriber-tag.entity.js';
import { NewsletterSuppression } from '../../../src/modules/newsletter/entities/newsletter-suppression.entity.js';

describe('newsletter subscriber admin (US3)', () => {
  let db: TestDb;
  let tags: NewsletterTagService;
  let fields: NewsletterCustomFieldService;
  let admin: NewsletterSubscriberAdminService;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    tags = new NewsletterTagService(() => db.em());
    fields = new NewsletterCustomFieldService(() => db.em());
    admin = new NewsletterSubscriberAdminService(() => db.em());
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('defines a tag + custom field and rejects duplicates', async () => {
    const tag = await tags.create({ code: 'promo', name: 'Promo' });
    expect(tag.code).toBe('promo');
    await expect(tags.create({ code: 'promo', name: 'Dup' })).rejects.toMatchObject({ statusCode: 409 });

    const field = await fields.create({ key: 'city', label: 'City', type: 'text' });
    expect(field.key).toBe('city');
  });

  it('lists + filters subscribers by tag and exports CSV', async () => {
    const em = db.em();
    const tag = await tags.create({ code: 'vip', name: 'VIP' });
    const a = em.create(NewsletterSubscriber, { email: 'a@x.test', status: 'active', source: 'footer' });
    const b = em.create(NewsletterSubscriber, { email: 'b@x.test', status: 'active' });
    await em.flush();
    em.create(NewsletterSubscriberTag, { subscriberId: a.id, tagId: tag.id });
    await em.flush();

    const all = await admin.list({ page: 1, pageSize: 50 });
    expect(all.total).toBe(2);

    const filtered = await admin.list({ page: 1, pageSize: 50, tag: 'vip' });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]?.email).toBe('a@x.test');
    expect(filtered.items[0]?.tags).toEqual(['vip']);

    const csv = await admin.exportCsv({ tag: 'vip' });
    expect(csv.split('\n')[0]).toContain('email,status,tags');
    expect(csv).toContain('a@x.test');
    expect(csv).not.toContain('b@x.test');
    void b;
  });

  it('deactivate (version-checked) and delete (writes suppression) work', async () => {
    const em = db.em();
    const s = em.create(NewsletterSubscriber, { email: 'd@x.test', status: 'active' });
    await em.flush();

    const deact = await admin.deactivate(s.id, s.version);
    expect(deact.status).toBe('deactivated');
    await expect(admin.deactivate(s.id, 1)).rejects.toMatchObject({ statusCode: 409 });

    await admin.remove(s.id);
    db.em().clear();
    const gone = await db.em().findOne(NewsletterSubscriber, { email: 'd@x.test' });
    expect(gone).toBeNull();
    const suppression = await db.em().findOne(NewsletterSuppression, { email: 'd@x.test' });
    expect(suppression).not.toBeNull();
  });

  it('blocks tag deletion when referenced by a campaign target', async () => {
    const em = db.em();
    const tag = await tags.create({ code: 'used', name: 'Used' });
    await em.getConnection().execute(
      `insert into newsletter_campaigns (id, name, subject, content, language, target_type, target_tag_ids, tracking_enabled, status, stats, version, created_at, updated_at)
       values (gen_random_uuid(), 'C', 'S', '{}'::jsonb, 'en-US', 'tag', ?::jsonb, true, 'draft', '{}'::jsonb, 1, now(), now())`,
      [JSON.stringify([tag.id])],
      'run',
      em.getTransactionContext(),
    );
    await expect(tags.remove(tag.id)).rejects.toMatchObject({ statusCode: 409 });
  });
});
