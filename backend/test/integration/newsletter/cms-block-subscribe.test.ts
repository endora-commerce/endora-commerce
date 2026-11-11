import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { NewsletterSubscriber, NewsletterSubscriberTag, NewsletterTag } from '../../helpers/package-entities.js';

/**
 * The backend half of the `newsletter.Signup` block
 * (`specs/163-page-builder-marketing-pages/` T077, US7, FR-029, research R-17,
 * quickstart §5 step 2).
 *
 * The storefront's `/newsletter/subscribe` handler calls the module's existing
 * public `POST /api/v1/newsletter/subscribe` with the chosen topics as tags and
 * `source: 'cms-block'`. The endpoint itself is unchanged; what this file pins
 * is that the sign-up is recorded as FR-029 requires: the subscriber, the
 * known tags (an unknown one is ignored, never created), the consent time and
 * the source, with the audit entry that records the consent.
 */
describe('newsletter subscribe from the cms block (T077)', () => {
  let h: BackendServerHandle;
  const run = `pb163_${randomUUID().slice(0, 8)}`;
  const email = `${run}@example.com`;
  const known = [`${run}_offers`, `${run}_events`];
  const unknown = `${run}_unknown`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em().fork();
    for (const code of known) em.create(NewsletterTag, { code, name: `Topic ${code}` });
    await em.flush();
  });

  afterAll(async () => {
    const em = h.em().fork();
    const subscriber = await em.findOne(NewsletterSubscriber, { email });
    if (subscriber) {
      await em.nativeDelete(NewsletterSubscriberTag, { subscriberId: subscriber.id });
      await em.nativeDelete(NewsletterSubscriber, { id: subscriber.id });
    }
    await em.nativeDelete(NewsletterTag, { code: { $in: [...known, unknown] } });
    await teardownBackendServer(h);
  });

  it('records the subscriber with the known tags, the consent time and source cms-block, ignoring the unknown tag', async () => {
    const before = Date.now();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      headers: { 'x-sales-channel': 'default' },
      payload: { email, channelCode: 'default', tags: [...known, unknown], source: 'cms-block' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(['pending', 'active']).toContain((res.json() as { data: { status: string } }).data.status);

    const em = h.em().fork();
    const subscriber = await em.findOneOrFail(NewsletterSubscriber, { email });
    expect(subscriber.source).toBe('cms-block');
    expect(subscriber.consentAt).toBeInstanceOf(Date);
    expect(subscriber.consentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    const links = await em.find(NewsletterSubscriberTag, { subscriberId: subscriber.id });
    const tags = await em.find(NewsletterTag, { id: { $in: links.map((link) => link.tagId) } });
    expect(tags.map((tag) => tag.code).sort()).toEqual([...known].sort());
    // The unknown topic is ignored: no tag is created for it.
    expect(await em.count(NewsletterTag, { code: unknown })).toBe(0);

    // The consent is audited with the source that tells this sign-up apart.
    const audit = (await em.getConnection().execute(
      `select action, state_after from audit_log_entries where object_type = 'newsletter_subscriber' and object_id = ?`,
      [subscriber.id],
    )) as Array<{ action: string; state_after: { source?: string; email?: string } }>;
    expect(audit.map((row) => row.action)).toContain('newsletter_subscribe');
    const entry = audit.find((row) => row.action === 'newsletter_subscribe');
    expect(entry?.state_after).toMatchObject({ source: 'cms-block' });
    // The subscriber by id, never the address (#470, D-288).
    expect(JSON.stringify(entry?.state_after)).not.toContain(email);
  });
});
