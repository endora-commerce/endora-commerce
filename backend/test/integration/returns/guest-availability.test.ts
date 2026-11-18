import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry, Setting } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN_COOKIE } from './helpers.js';
import { overrideReturnsSetting } from './notification-jobs.js';
import { OFF_PLATFORM_SETTING } from './off-platform-fixtures.js';
import { GUEST_SETTING, OTHER_CHANNEL, availability, channelSetting } from './guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T018 (US5; FR-001, FR-002; research R-12): *Complaints
 * from guests* is off by default, per sales channel, and in effect only while 180's
 * *Complaints without a platform order* is on for the same channel. G1 answers the
 * effective state for the request's channel. Changing it is an audited settings write.
 */
describe('returns — guest complaints availability (G1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('declares both settings with their defaults', async () => {
    const guest = await h.em().findOneOrFail(Setting, { code: GUEST_SETTING });
    expect(guest.valueType).toBe('boolean');
    expect(guest.defaultValue).toBe(false);
    const retention = await h.em().findOneOrFail(Setting, { code: 'returns.guest_data_retention_days' });
    expect(retention.valueType).toBe('number');
    expect(retention.defaultValue).toBe(90);
  });

  it('is off by default, even with complaints without a platform order on', async () => {
    const undo = await overrideReturnsSetting(h, OFF_PLATFORM_SETTING, true);
    try {
      expect(await availability(h)).toEqual({ statusCode: 200, enabled: false });
    } finally {
      await undo();
    }
  });

  it('stays off while complaints without a platform order are off (fails closed)', async () => {
    const undo = await overrideReturnsSetting(h, GUEST_SETTING, true);
    try {
      expect((await availability(h)).enabled).toBe(false);
    } finally {
      await undo();
    }
  });

  it('is on with both settings on', async () => {
    const undoOff = await overrideReturnsSetting(h, OFF_PLATFORM_SETTING, true);
    const undoGuest = await overrideReturnsSetting(h, GUEST_SETTING, true);
    try {
      expect((await availability(h)).enabled).toBe(true);
    } finally {
      await undoGuest();
      await undoOff();
    }
  });

  it('follows the request’s channel', async () => {
    const undoOff = await overrideReturnsSetting(h, OFF_PLATFORM_SETTING, true);
    const undoGuest = await channelSetting(h, GUEST_SETTING, OTHER_CHANNEL, true);
    try {
      expect((await availability(h, 'default')).enabled).toBe(false);
      expect((await availability(h, OTHER_CHANNEL)).enabled).toBe(true);
    } finally {
      await undoGuest();
      await undoOff();
    }
  });

  it('is switched per channel through the audited settings write', async () => {
    const undoOff = await overrideReturnsSetting(h, OFF_PLATFORM_SETTING, true);
    try {
      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/settings/${GUEST_SETTING}/value`,
        cookies: ADMIN_COOKIE,
        payload: { scope: 'subset', salesChannelCodes: [OTHER_CHANNEL], value: true },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((await availability(h, OTHER_CHANNEL)).enabled).toBe(true);
      expect((await availability(h, 'default')).enabled).toBe(false);

      const setting = await h.em().fork().findOneOrFail(Setting, { code: GUEST_SETTING });
      const entries = await h.em().fork().find(AuditLogEntry, { objectType: 'setting', objectId: setting.id, action: 'setting.value_set' });
      expect(entries.some((e) => (e.stateAfter as { settingCode?: string } | null)?.settingCode === GUEST_SETTING)).toBe(true);
    } finally {
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/settings/${GUEST_SETTING}/value?salesChannelCodes=${OTHER_CHANNEL}`,
        cookies: ADMIN_COOKIE,
      });
      await undoOff();
    }
  });
});
