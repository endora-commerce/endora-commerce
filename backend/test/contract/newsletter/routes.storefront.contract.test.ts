import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newsletterStatusResponseSchema, newsletterSubscribeResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { channelUrlLanguages } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { NewsletterTokenHelper, clickDestinationHash } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';

/** The key the test harness pins newsletter links to (`newsletterTokenSecret` in `test-server.ts`). */
const HARNESS_NEWSLETTER_TOKEN_SECRET = 'test-newsletter-secret';

/**
 * HTTP-level contract for the public newsletter routes (feature 048, US1),
 * exercised through the real Fastify server + module wiring.
 */
describe('Newsletter storefront routes (feature 048)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reports module status with the per-channel opt-in mode', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/newsletter/status?channel=default' });
    expect(res.statusCode).toBe(200);
    const body = newsletterStatusResponseSchema.parse(res.json().data);
    expect(body.enabled).toBe(true);
    expect(['single', 'double']).toContain(body.optInMode);
  });

  it('subscribes a valid email and returns a status', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      payload: { email: 'contract@example.com', channelCode: 'default' },
    });
    expect(res.statusCode).toBe(200);
    const body = newsletterSubscribeResponseSchema.parse(res.json().data);
    expect(['pending', 'active']).toContain(body.status);
  });

  it('rejects an unknown sales channel with 400', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      payload: { email: 'x@example.com', channelCode: 'no-such-channel' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns a GIF for the open-tracking pixel even with a bad token', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/newsletter/open.gif?token=bad-token' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/gif');
  });

  it('answers a click link whose token does not verify 410, without redirecting', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/newsletter/click?token=garbage&u=${encodeURIComponent('https://elsewhere.example/')}`,
    });
    expect(res.statusCode).toBe(410);
    expect(res.headers.location).toBeUndefined();
  });

  it('redirects a signed click link to its destination on the platform server', async () => {
    // A signed click token is longer than the router's default 100-character
    // path-parameter limit; carried in the query string it reaches the handler.
    const destination = 'https://shop.test/deal?utm_source=newsletter';
    const tokens = new NewsletterTokenHelper(HARNESS_NEWSLETTER_TOKEN_SECRET);
    const token = tokens.mint(
      'click',
      { id: '00000000-0000-4000-8000-000000000001', linkId: 'link-1', urlHash: clickDestinationHash(destination) },
      3600,
    );
    expect(token.length).toBeGreaterThan(100);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/newsletter/click?token=${encodeURIComponent(token)}&u=${encodeURIComponent(destination)}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(destination);
  });

  it('seeds the predefined newsletter_consent CMS block linking to the privacy policy', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/blocks/by-code?code=newsletter_consent',
    });
    expect(res.statusCode).toBe(200);
    const block = res.json().data as { code: string; content: { data: unknown } };
    expect(block.code).toBe('newsletter_consent');
    expect(JSON.stringify(block.content.data)).toContain('/privacy-policy');
  });

  // Feature 167 (US6, FR-034) — the storefront pages a confirm or unsubscribe link
  // lands on carry the subscriber's channel language prefix (its default language:
  // a subscriber records no language).
  it('redirects confirm and unsubscribe to the prefixed storefront pages of the subscriber channel', async () => {
    const email = `lang-path-${Date.now()}@example.com`;
    await h.app.inject({ method: 'POST', url: '/api/v1/newsletter/subscribe', payload: { email, channelCode: 'default' } });
    // Read by SQL: the entity class is the package's, taken from no source path here.
    const [subscriber] = (await h.em().getConnection().execute(
      `select id from newsletter_subscribers where email = ?`,
      [email],
    )) as Array<{ id: string }>;
    if (!subscriber) throw new Error('the subscribe call stored no subscriber');
    const channel = (await h.em().findOne(SalesChannel, { code: 'default' }))!;
    const main = channelUrlLanguages(channel).find((l) => l.isDefault)!;
    const prefix = main.prefixed ? `/${main.prefix}` : '';
    const tokens = new NewsletterTokenHelper(HARNESS_NEWSLETTER_TOKEN_SECRET);

    const confirm = await h.app.inject({
      method: 'GET',
      url: `/api/v1/newsletter/confirm?token=${encodeURIComponent(tokens.mint('confirm', { id: subscriber.id }, 3600))}`,
    });
    expect(new URL(confirm.headers.location as string).pathname).toBe(`${prefix}/newsletter/confirm`);

    const unsubscribe = await h.app.inject({
      method: 'GET',
      url: `/api/v1/newsletter/unsubscribe?token=${encodeURIComponent(tokens.mint('unsubscribe', { id: subscriber.id }, 3600))}`,
    });
    expect(new URL(unsubscribe.headers.location as string).pathname).toBe(`${prefix}/newsletter/unsubscribe`);

    // An invalid token names no subscriber, so no channel: the logical path.
    const invalid = await h.app.inject({ method: 'GET', url: '/api/v1/newsletter/confirm?token=bad' });
    expect(new URL(invalid.headers.location as string).pathname).toBe('/newsletter/confirm');
  });

  // Feature 169 (US7, FR-026, T173) — a public sign-up with subscriber attributes
  // keeps only the values whose type matches the field; the others are dropped,
  // never refused (the admin create and the self subscribe share the merge).
  it('stores only the type-correct custom-field values of a public sign-up', async () => {
    const connection = h.em().getConnection();
    const fields = [
      ['c169_age', 'number'],
      ['c169_vip', 'boolean'],
      ['c169_born', 'date'],
      ['c169_company', 'text'],
    ] as const;
    for (const [key, type] of fields) {
      await connection.execute(
        `insert into newsletter_custom_fields (id, key, label, type, created_at, updated_at)
         values (gen_random_uuid(), ?, ?, ?, now(), now()) on conflict (key) do nothing`,
        [key, key, type],
      );
    }
    const email = `attributes-${Date.now()}@example.com`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      payload: {
        email,
        channelCode: 'default',
        customFields: {
          c169_age: 'abc',
          c169_vip: true,
          c169_born: '2026-13-40',
          c169_company: 'Acme',
          c169_unknown: 'dropped',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const [row] = (await connection.execute(
      `select custom_fields from newsletter_subscribers where email = ?`,
      [email],
    )) as Array<{ custom_fields: Record<string, unknown> | string }>;
    if (!row) throw new Error('the subscribe call stored no subscriber');
    const stored = typeof row.custom_fields === 'string' ? JSON.parse(row.custom_fields) : row.custom_fields;
    expect(stored).toEqual({ c169_vip: true, c169_company: 'Acme' });
  });
});
