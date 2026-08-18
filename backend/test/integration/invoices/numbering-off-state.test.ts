import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';
import { systemDefaultSalesChannel } from '../../helpers/sales-channel-fixtures.js';
import { seedInvoiceableOrder, setSellerSettings } from './helpers.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Feature 078 §J — what the numbering work does while `invoices` is off
 * (Constitution XVII).
 *
 * Two things have to be true and one has to stay untouched: issuance is refused
 * as `MODULE_DISABLED` rather than as a numbering error — the module being off
 * is a different fact from a duplicated number and must not wear its name; the
 * three numbering settings are non-editable, so the contributed validator never
 * gets a value to judge; and the pinned system-default value is a `SettingValue`
 * row, so a deactivate/activate cycle must leave it exactly where it was.
 */

const PATTERN_CODES = [
  'invoices.numbering.invoice.pattern',
  'invoices.numbering.proforma.pattern',
  'invoices.numbering.correction.pattern',
];
const ACTOR = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };

describe('invoices — numbering while the module is switched off', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSellerSettings(h);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function pinnedValue(): Promise<unknown> {
    const em = h.em();
    const channel = await systemDefaultSalesChannel(em);
    const setting = await em.findOne(Setting, { code: PATTERN_CODES[0]! });
    const row = await em.findOne(SettingValue, { setting, salesChannel: channel.id });
    return row?.value ?? null;
  }

  it('refuses issuance as MODULE_DISABLED, freezes the numbering settings, and restores', async () => {
    const before = await pinnedValue();
    expect(before).toBe('FV {seq}/{YYYY}');
    const channel = await systemDefaultSalesChannel(h.em());
    const { orderId } = await withSystemScope('seed', () =>
      seedInvoiceableOrder(h.em(), { salesChannelId: channel.id }),
    );

    await withModuleOff('invoices', 'deactivated', async () => {
      const issued = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${orderId}/invoices`,
        cookies: { b2b_admin_session: 'stub-admin-session' },
        payload: { kind: 'invoice' },
      });
      expect(issued.statusCode).toBe(503);
      expect((issued.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');

      // The settings refusal comes first, so the contributed validator never
      // runs and never gets to name a numbering problem instead.
      for (const code of PATTERN_CODES) {
        await expect(
          h.settings.adminService.setValueForAllChannels(code, 'X {seq}/{channel}', null, ACTOR),
        ).rejects.toMatchObject({ code: 'MODULE_SETTING_READ_ONLY' });
      }

      // Off is not uninstall: the pinned value is still there, unreadable to
      // nobody and unwritable by everyone.
      expect(await pinnedValue()).toBe(before);
    });

    // Restored, including the pinned per-channel value.
    expect(await pinnedValue()).toBe(before);
    const issuedAgain = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: { b2b_admin_session: 'stub-admin-session' },
      payload: { kind: 'invoice' },
    });
    expect(issuedAgain.statusCode).toBe(201);
    expect((issuedAgain.json() as { data: { number: string } }).data.number).toMatch(
      /^FV \d+\/\d{4}$/,
    );
  });
});
