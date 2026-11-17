import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { ADMIN_COOKIE } from './helpers.js';
import { overrideReturnsSetting } from './notification-jobs.js';

/**
 * `specs/180-off-platform-complaints/` T106 (D-7, research R-22, contracts/admin-api.md
 * §A5): `GET /api/v1/admin/returns/notification-health` names where the new-case
 * e-mail goes to nobody — the global value, and every channel whose effective value
 * (its own, else the global) holds no valid address.
 */
describe('GET /api/v1/admin/returns/notification-health', () => {
  let h: BackendServerHandle;
  let withList: string;
  let invalidOnly: string;
  let outsider: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const RUN = Date.now().toString(36);
  const CODE = 'returns.new_case_recipients';

  async function channel(code: string): Promise<string> {
    const em = h.em().fork();
    const row = em.create(SalesChannel, {
      code: `${code}-${RUN}`,
      name: { 'en-US': code },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    await em.flush();
    return row.id;
  }

  async function channelValue(salesChannelId: string, value: unknown): Promise<void> {
    const em = h.em().fork();
    const setting = await em.findOneOrFail(Setting, { code: CODE });
    em.create(SettingValue, { setting, salesChannel: em.getReference(SalesChannel, salesChannelId), value });
    await em.flush();
    await h.settings.cache.invalidate(CODE);
  }

  const health = async (cookies: Record<string, string> = ADMIN_COOKIE) =>
    h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/notification-health', cookies });

  beforeAll(async () => {
    h = await setupBackendServer();
    withList = await channel('health-with-list');
    invalidOnly = await channel('health-invalid');
    await channelValue(withList, ['orders@shop.example']);
    await channelValue(invalidOnly, ['not-an-address']);
    outsider = await seedCrmAdmin(h.em(), 'health_outsider', ['orders:read']);
  });
  afterAll(async () => {
    outsider.undo();
    await teardownBackendServer(h);
  });

  type Health = { recipientsMissing: { global: boolean; salesChannelIds: string[] } };

  it('reports the empty global list and every channel left with no valid address', async () => {
    const res = await health();
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Health }).data;
    expect(data.recipientsMissing.global).toBe(true);
    expect(data.recipientsMissing.salesChannelIds).toContain(invalidOnly);
    expect(data.recipientsMissing.salesChannelIds).not.toContain(withList);
    const defaultChannel = await h.em().fork().findOneOrFail(SalesChannel, { systemDefault: true });
    expect(data.recipientsMissing.salesChannelIds).toContain(defaultChannel.id);
  });

  it('stops naming the channels that inherit a global list with a valid address', async () => {
    const restore = await overrideReturnsSetting(h, CODE, ['shop@example.test']);
    try {
      const data = ((await health()).json() as { data: Health }).data;
      expect(data.recipientsMissing.global).toBe(false);
      // The channel's own invalid list replaces the global one, so it is still named.
      expect(data.recipientsMissing.salesChannelIds).toEqual([invalidOnly]);
    } finally {
      await restore();
    }
  });

  it('requires returns:read', async () => {
    expect((await health(outsider.cookies)).statusCode).toBe(403);
  });
});
