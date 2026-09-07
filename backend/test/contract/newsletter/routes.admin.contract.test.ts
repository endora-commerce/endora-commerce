import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignDetailSchema } from '@endora-commerce/contracts';
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
});
