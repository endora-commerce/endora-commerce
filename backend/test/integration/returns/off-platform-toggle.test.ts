import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { resetReturnGraph } from './helpers.js';
import { OFF_PLATFORM_SETTING, complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';

/**
 * `specs/180-off-platform-complaints/` T055 (FR-B01, FR-B02, Principle XII): the no-order
 * path follows `returns.off_platform_complaints_enabled` of the channel resolved from the
 * request — never a channel named in the body.
 */
describe('returns — the no-order toggle', () => {
  let h: BackendServerHandle;
  let reasonId: string;

  async function channelValue(code: string, value: boolean): Promise<void> {
    const em = h.em().fork();
    const channel = await em.findOneOrFail(SalesChannel, { code });
    const setting = await em.findOneOrFail(Setting, { code: OFF_PLATFORM_SETTING });
    em.create(SettingValue, { setting, salesChannel: channel, value });
    await em.flush();
    await h.settings.cache.invalidate(OFF_PLATFORM_SETTING);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    reasonId = await complaintReasonId(h.em());
    await channelValue('pl_retail', true);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a no-order complaint while the request channel has it off — 403, translated', async () => {
    const res = await file(h, noOrderBody(reasonId), { headers: { 'x-sales-channel': 'default', 'accept-language': 'pl' } });
    expect(res.statusCode, res.body).toBe(403);
    const error = (res.json() as { error: { code: string; message: string } }).error;
    expect(error.code).toBe(ERROR_CODES.RETURN_OFF_PLATFORM_DISABLED);
    expect(error.message).not.toMatch(/^[A-Z_]+$/);
  });

  it('files it on a channel that has it on', async () => {
    const res = await file(h, noOrderBody(reasonId), { headers: { 'x-sales-channel': 'pl_retail' } });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { data: { orderId: string | null; offPlatform: boolean } }).data).toMatchObject({
      orderId: null,
      offPlatform: true,
    });
  });

  it('ignores a channel named in the body', async () => {
    const pl = await h.em().fork().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    const res = await file(h, { ...noOrderBody(reasonId), salesChannelId: pl.id }, { headers: { 'x-sales-channel': 'default' } });
    expect([400, 403]).toContain(res.statusCode);
  });
});
