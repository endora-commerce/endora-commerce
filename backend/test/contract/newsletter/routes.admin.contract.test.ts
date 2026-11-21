import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignDetailSchema, campaignGroupResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

const ADMIN = { b2b_session: 'stub-admin-session' };

/**
 * HTTP-level contract for the admin newsletter routes (feature 048, US2),
 * exercised through the real server + permission gating.
 */
describe('Newsletter admin routes (feature 048)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('requires authentication for the admin campaign list', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/newsletter/campaigns' });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('creates, lists, and sends a campaign as an admin', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/newsletter/campaigns',
      cookies: ADMIN,
      payload: {
        name: 'Contract campaign',
        language: 'en-US',
        subject: 'Hello',
        content: { root: { props: {} }, content: [{ type: 'transactional_emails.EmailText', props: { id: 'b', text: 'Hi' } }], zones: {} },
        targetType: 'all',
      },
    });
    expect(create.statusCode).toBe(201);
    const campaign = campaignDetailSchema.parse(create.json().data);
    expect(campaign.status).toBe('draft');

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/newsletter/campaigns',
      cookies: ADMIN,
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().data.items as Array<{ id: string }>;
    expect(items.some((c) => c.id === campaign.id)).toBe(true);

    // The console provider is configured by default, so send dispatches inline.
    const send = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/newsletter/campaigns/${campaign.id}/send`,
      cookies: ADMIN,
      payload: { expectedVersion: campaign.version },
    });
    expect(send.statusCode).toBe(200);
    expect(campaignDetailSchema.parse(send.json().data).status).toBe('sent');
  });

  it('answers a campaign\'s manual group, gated like every read (issue #1533)', async () => {
    const email = `group-${randomUUID()}@contract.test`;
    const subscriber = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/newsletter/subscribers',
      cookies: ADMIN,
      payload: { email },
    });
    expect(subscriber.statusCode).toBe(201);
    const found = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/newsletter/subscribers?q=${encodeURIComponent(email)}`,
      cookies: ADMIN,
    });
    const member = (found.json().data.items as Array<{ id: string; email: string }>).find((s) => s.email === email)!;
    expect(member).toBeDefined();

    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/newsletter/campaigns',
      cookies: ADMIN,
      payload: {
        name: 'Group campaign',
        language: 'en-US',
        subject: 'Hello',
        content: { root: { props: {} }, content: [], zones: {} },
        targetType: 'group',
      },
    });
    const campaign = campaignDetailSchema.parse(create.json().data);
    const url = `/api/v1/admin/newsletter/campaigns/${campaign.id}/group`;

    const anonymous = await h.app.inject({ method: 'GET', url });
    expect([401, 403]).toContain(anonymous.statusCode);

    const empty = await h.app.inject({ method: 'GET', url, cookies: ADMIN });
    expect(empty.statusCode).toBe(200);
    expect(campaignGroupResponseSchema.parse(empty.json().data).items).toEqual([]);

    const put = await h.app.inject({ method: 'PUT', url, cookies: ADMIN, payload: { subscriberIds: [member.id] } });
    expect(put.statusCode).toBe(200);

    const filled = await h.app.inject({ method: 'GET', url, cookies: ADMIN });
    expect(campaignGroupResponseSchema.parse(filled.json().data).items).toEqual([
      { id: member.id, email: member.email },
    ]);

    const missing = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/newsletter/campaigns/${randomUUID()}/group`,
      cookies: ADMIN,
    });
    expect(missing.statusCode).toBe(404);
  });
});
