import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/transactional-emails';

const simpleContent = (text: string) => ({
  root: { props: {} },
  content: [{ type: 'EmailText', props: { id: 't1', text, align: 'left' } }],
  zones: {},
});

describe('transactional emails — per-channel + branding (US2)', () => {
  let h: BackendServerHandle;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const channels = await h.em().find(SalesChannel, {}, { limit: 1 });
    channelId = channels[0]!.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('resolves a per-channel override independently of global', async () => {
    // Global override.
    await h.app.inject({
      method: 'PUT',
      url: `${BASE}/order_confirmation/content?language=en-US`,
      cookies: ADMIN_COOKIE,
      payload: { subject: 'GLOBAL', content: simpleContent('global body') },
    });
    // Channel override.
    await h.app.inject({
      method: 'PUT',
      url: `${BASE}/order_confirmation/content?language=en-US&salesChannelId=${channelId}`,
      cookies: ADMIN_COOKIE,
      payload: { subject: 'CHANNEL', content: simpleContent('channel body') },
    });

    const channelDetail = await h.app.inject({
      method: 'GET',
      url: `${BASE}/order_confirmation?language=en-US&salesChannelId=${channelId}`,
      cookies: ADMIN_COOKIE,
    });
    const cd = (channelDetail.json() as { data: { effective: { source: string; subject: string } } }).data;
    expect(cd.effective.source).toBe('channel');
    expect(cd.effective.subject).toBe('CHANNEL');

    const globalDetail = await h.app.inject({
      method: 'GET',
      url: `${BASE}/order_confirmation?language=en-US`,
      cookies: ADMIN_COOKIE,
    });
    const gd = (globalDetail.json() as { data: { effective: { source: string; subject: string } } }).data;
    expect(gd.effective.source).toBe('global');
    expect(gd.effective.subject).toBe('GLOBAL');
  });

  it('persists and reads back branding accent color', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/branding`,
      cookies: ADMIN_COOKIE,
      payload: { accentColor: '#abcdef' },
    });
    expect(put.statusCode).toBe(200);

    const get = await h.app.inject({ method: 'GET', url: `${BASE}/branding`, cookies: ADMIN_COOKIE });
    const b = (get.json() as { data: { accentColor: string } }).data;
    expect(b.accentColor).toBe('#abcdef');
  });
});
