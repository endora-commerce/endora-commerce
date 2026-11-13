import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomerNotificationRecordPort, RecordCustomerNotificationInput } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `customer_notifications` off-state — Constitution XVII item 6
 * (`specs/179-rfq-and-customer-notifications/` FR-048, T063).
 *
 *  * **API rejection** — the four storefront routes answer the
 *    `MODULE_DISABLED` envelope on both axes, and stop doing so once restored;
 *  * **the port gate** — `customerNotificationRecordPort` refuses while off, so
 *    a producer that skipped its presence check gets a refusal rather than an
 *    entry nobody can read;
 *  * **the worker** — the retention tick does nothing while off: an entry far
 *    past the retention period survives the tick, and the next tick after the
 *    module is back deletes it;
 *  * **configuration** — `customer_notifications.retention_days` is refused
 *    while off and writable again after (the harness's `settingWrite`);
 *  * **admin absence** — the presence projection; the module has no admin
 *    screen, palette action or permission of its own;
 *  * **storefront absence** — the storefront's page and indicator gate on the
 *    same presence projection (WP-09); here, the API they read is gone;
 *  * **restoration** — nothing is deleted: an entry recorded before the switch
 *    is listed again afterwards.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const DEFAULT = { 'x-sales-channel': 'default' };
const AXES: readonly OffStateAxis[] = ['deactivated', 'platform-unavailable'];
const SOURCE = `cn-off-${randomUUID().slice(0, 8)}`;

describe('customer_notifications off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;

  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);
  const port = () =>
    h.container.resolve<CustomerNotificationRecordPort>('customerNotificationRecordPort');
  const tick = () => h.container.resolve<() => Promise<void>>('customerNotificationsRetentionTick')();

  const input = (key: string): RecordCustomerNotificationInput => ({
    organizationId: TEST_ORGANIZATION_ID,
    customerAccountId: TEST_CUSTOMER_ID,
    salesChannelId: null,
    sourceModule: 'customer_notifications',
    sourceKey: `${SOURCE}:${key}`,
    kind: 'test.off_state',
    title: 'Recorded before the switch',
    titleMessage: { scope: 'customer_notifications', key: 'test.missing.key' },
    linkPath: '/account',
  });

  const exists = async (sourceKey: string): Promise<boolean> => {
    const rows = (await sql(`select 1 from "customer_notifications" where "source_key" = ?`, [sourceKey])) as unknown[];
    return rows.length > 0;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await sql(`delete from "customer_notifications" where "source_key" like ?`, [`${SOURCE}:%`]);
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'customer_notifications', {
      routes: [
        { url: '/api/v1/storefront/notifications', cookies: BUYER, headers: DEFAULT },
        { url: '/api/v1/storefront/notifications/unread-count', cookies: BUYER, headers: DEFAULT },
        {
          method: 'POST',
          url: `/api/v1/storefront/notifications/${randomUUID()}/read`,
          cookies: BUYER,
          headers: DEFAULT,
        },
        { method: 'POST', url: '/api/v1/storefront/notifications/read-all', cookies: BUYER, headers: DEFAULT },
      ],
      adminPresence: { cookies: ADMIN },
      settingWrite: { code: 'customer_notifications.retention_days', value: 120, cookies: ADMIN },
    });
  });

  it.each(AXES)('closes the record port while %s, and opens it again after', async (axis) => {
    await withModuleOff('customer_notifications', axis, async () => {
      // The gate refuses at resolution — a producer resolving the port per call
      // gets the refusal before it can record anything.
      await expect((async () => port().record(input(`gate-${axis}`)))()).rejects.toMatchObject({
        name: 'ModuleDisabledError',
        moduleId: 'customer_notifications',
      });
    });
    expect(await exists(`${SOURCE}:gate-${axis}`)).toBe(false);

    await port().record(input(`gate-${axis}`));
    expect(await exists(`${SOURCE}:gate-${axis}`)).toBe(true);
  });

  it.each(AXES)('runs no retention tick while %s, and the first tick after it is back deletes what is due', async (axis) => {
    const key = `${SOURCE}:stale-${axis}`;
    const id = randomUUID();
    await sql(
      `insert into "customer_notifications"
         ("id", "organization_id", "customer_account_id", "sales_channel_id", "source_module", "source_key",
          "kind", "title", "title_message", "created_at")
       values (?, ?, ?, null, 'customer_notifications', ?, 'test.off_state', 'Long ago', '{"scope":"x","key":"y","params":{}}'::jsonb, now() - interval '3 years')`,
      [id, TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID, key],
    );

    await withModuleOff('customer_notifications', axis, async () => {
      await tick();
      expect(await exists(key)).toBe(true);
    });

    await tick();
    expect(await exists(key)).toBe(false);
  });

  it.each(AXES)('keeps the entries recorded before the switch, and lists them again after %s', async (axis) => {
    const record = await port().record(input(`kept-${axis}`));
    await withModuleOff('customer_notifications', axis, async () => {
      expect(await exists(`${SOURCE}:kept-${axis}`)).toBe(true);
    });

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/notifications?limit=50',
      cookies: BUYER,
      headers: DEFAULT,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { items: Array<{ id: string }> } }).data.items.map((item) => item.id)).toContain(record.id);
  });
});
