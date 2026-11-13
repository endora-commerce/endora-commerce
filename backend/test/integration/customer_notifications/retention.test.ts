import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * The retention sweep against a database
 * (`specs/179-rfq-and-customer-notifications/` research R-16, data-model §2, T062).
 *
 * One tick of the module's own tick function — the one its BullMQ consumer
 * runs — over entries either side of the retention period, plus the entry of
 * an account the account owner no longer knows. Batching and the anonymised
 * and soft-deleted cases are the unit test's (`retention-sweeper.test.ts`).
 */

const SOURCE = `cn-retention-${randomUUID().slice(0, 8)}`;

describe('customer_notifications — the retention sweep', () => {
  let h: BackendServerHandle;

  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);
  const tick = () => h.container.resolve<() => Promise<void>>('customerNotificationsRetentionTick')();

  async function seed(key: string, daysAgo: number, account = TEST_CUSTOMER_ID): Promise<void> {
    await sql(
      `insert into "customer_notifications"
         ("id", "organization_id", "customer_account_id", "sales_channel_id", "source_module", "source_key",
          "kind", "title", "title_message", "created_at")
       values (?, ?, ?, null, 'quote_requests', ?, 'test.retention', 't', '{"scope":"x","key":"y","params":{}}'::jsonb,
               now() - (? * interval '1 day'))`,
      [randomUUID(), TEST_ORGANIZATION_ID, account, `${SOURCE}:${key}`, daysAgo],
    );
  }

  const remaining = async (): Promise<string[]> =>
    (
      (await sql(`select "source_key" from "customer_notifications" where "source_key" like ? order by "source_key"`, [
        `${SOURCE}:%`,
      ])) as Array<{ source_key: string }>
    ).map((row) => row.source_key.slice(SOURCE.length + 1));

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await sql(`delete from "customer_notifications" where "source_key" like ?`, [`${SOURCE}:%`]);
    await teardownBackendServer(h);
  });

  it('deletes entries older than the default 90 days and the entries of an account that is gone, and keeps the rest', async () => {
    await seed('old', 91);
    await seed('recent', 89);
    await seed('today', 0);
    await seed('vanished-account', 0, randomUUID());

    await tick();

    expect(await remaining()).toEqual(['recent', 'today']);
  });

  it('reads the period from the setting', async () => {
    const write = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customer_notifications.retention_days/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: 30 },
    });
    expect(write.statusCode, write.body).toBe(200);
    try {
      await seed('thirty-one', 31);
      await seed('twenty-nine', 29);

      await tick();

      expect(await remaining()).toEqual(expect.not.arrayContaining(['thirty-one']));
      expect(await remaining()).toContain('twenty-nine');
    } finally {
      await h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings/customer_notifications.retention_days/value',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { scope: 'all', value: 90 },
      });
    }
  });

  it('refuses a retention period outside 7–730 days', async () => {
    for (const value of [6, 731, 30.5]) {
      const write = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings/customer_notifications.retention_days/value',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { scope: 'all', value },
      });
      expect(write.statusCode, `${value}: ${write.body}`).toBe(422);
    }
  });
});
