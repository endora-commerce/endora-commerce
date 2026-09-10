import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Setting } from '@endora-commerce/platform/kernel';
import { SettingValue } from '@endora-commerce/platform/kernel';
import {
  ensureSalesChannelId,
  systemDefaultSalesChannel,
} from '../../helpers/sales-channel-fixtures.js';
import { NumberingConfigurationService } from '../../../../packages/modules/invoices/src/backend/services/numbering-configuration.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';

/**
 * Feature 078, D-95 — the reported bug in its smallest form, and the one test
 * that goes red on the pre-078 tree.
 *
 * The defect never needed a configuration write: every channel resolved the
 * same default numbering pattern, so *creating a sales channel* armed the
 * duplicate. The second channel's first invoice of the year rendered the same
 * string as the first channel's and died on `invoices_number_unique`, reported
 * to the operator as `409 VERSION_CONFLICT`, "Unique constraint violated."
 */

const INVOICE_PATTERN_CODE = 'invoices.numbering.invoice.pattern';

interface IssueResponse {
  data: { number: string };
}

describe('invoices — two sales channels, one number space', () => {
  let h: BackendServerHandle;
  /**
   * The same service the module's boot hook runs, built over the harness's own
   * EM and audited settings write. Constructed here rather than reached through
   * the handle so this file exercises the production class without the harness
   * having to publish it.
   */
  let numbering: NumberingConfigurationService;

  beforeAll(async () => {
    h = await setupBackendServer();
    numbering = new NumberingConfigurationService(
      h.em,
      () => h.settings.adminService,
      { info: () => undefined, warn: () => undefined },
    );
    await setSellerSettings(h);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function issue(salesChannelId: string): Promise<IssueResponse['data']> {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
    return (res.json() as IssueResponse).data;
  }

  it('issues on a freshly created second channel with no configuration write at all', async () => {
    const first = await systemDefaultSalesChannel(h.em());
    const second = await ensureSalesChannelId(h.em(), 'two-ch-b');

    const a = await issue(first.id);
    const b = await issue(second);

    expect(a.number).not.toBe(b.number);
    // The grandfather rule: the first channel's series keeps its historical
    // shape, so an upgraded deployment's numbers do not change mid-year.
    expect(a.number).toMatch(/^FV \d+\/\d{4}$/);
    // The second channel's number carries its code.
    expect(b.number).toBe(`FV 1/TWO-CH-B/${new Date().getFullYear()}`);
  });

  it('issues on a third channel created afterwards, still with no settings write', async () => {
    const third = await ensureSalesChannelId(h.em(), 'two-ch-c');
    const c = await issue(third);
    expect(c.number).toBe(`FV 1/TWO-CH-C/${new Date().getFullYear()}`);
  });

  it('pins the system-default channel exactly once, with identical content', async () => {
    const em = h.em();
    const systemDefault = await systemDefaultSalesChannel(em);
    const setting = await em.findOne(Setting, { code: INVOICE_PATTERN_CODE });
    const before = await em.find(SettingValue, { setting }, { populate: ['salesChannel'] });
    const pinned = before.filter((row) => row.salesChannel.id === systemDefault.id);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.value).toBe('FV {seq}/{YYYY}');

    await numbering.reconcile();

    const after = await h
      .em()
      .find(SettingValue, { setting }, { populate: ['salesChannel'] });
    const pinnedAgain = after.filter((row) => row.salesChannel.id === systemDefault.id);
    expect(pinnedAgain).toHaveLength(1);
    expect(pinnedAgain[0]!.value).toBe('FV {seq}/{YYYY}');
  });

  it('writes nothing when the operator has already configured a value', async () => {
    const em = h.em();
    const systemDefault = await systemDefaultSalesChannel(em);
    const setting = await em.findOne(Setting, { code: 'invoices.numbering.proforma.pattern' });
    // Clear the pin this boot made so the setting is "untouched" again, then
    // let the operator configure it globally.
    for (const row of await em.find(SettingValue, { setting })) em.remove(row);
    await em.flush();
    await h.settings.adminService.setValueForAllChannels(
      'invoices.numbering.proforma.pattern',
      'PRO {seq}/{channel}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );

    await numbering.reconcile();

    const reread = await h.em().findOne(Setting, { code: 'invoices.numbering.proforma.pattern' });
    expect(reread?.globalValue).toBe('PRO {seq}/{channel}/{YYYY}');
    const rows = await h
      .em()
      .find(SettingValue, { setting: reread }, { populate: ['salesChannel'] });
    expect(rows.filter((row) => row.salesChannel.id === systemDefault.id)).toHaveLength(0);
  });
});
