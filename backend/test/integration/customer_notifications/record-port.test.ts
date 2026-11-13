import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerNotificationRecordPort, RecordCustomerNotificationInput } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `customerNotificationRecordPort` against a database
 * (`specs/179-rfq-and-customer-notifications/contracts/delivery-and-ports.md` §1, T060).
 *
 * The unit test holds what the port asks of an EntityManager; this one holds
 * what that means for a transaction: `recordWithin` commits with the caller and
 * is gone when the caller rolls back, `record` commits on its own and answers
 * the entry already recorded for a source key, and the schema's own checks
 * refuse what the port would have refused.
 *
 * A producer calls the port from a worker, under the system scope, so every
 * call here runs under one.
 */

const SOURCE = `cn-port-${randomUUID().slice(0, 8)}`;

describe('customer_notifications — the record port', () => {
  let h: BackendServerHandle;

  const port = () =>
    h.container.resolve<CustomerNotificationRecordPort<EntityManager>>('customerNotificationRecordPort');
  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);
  const inScope = <T>(fn: () => Promise<T>) => enterSystemScope('customer_notifications: record port test', fn);

  const input = (key: string, overrides: Partial<RecordCustomerNotificationInput> = {}): RecordCustomerNotificationInput => ({
    organizationId: TEST_ORGANIZATION_ID,
    customerAccountId: TEST_CUSTOMER_ID,
    salesChannelId: null,
    sourceModule: 'quote_requests',
    sourceKey: `${SOURCE}:${key}`,
    kind: 'quote_requests.approved',
    subjectType: 'quote_request',
    subjectId: randomUUID(),
    title: 'Quote request QR-000153 was approved',
    titleMessage: { scope: 'quote_requests', key: 'customerNotifications.approved.title', params: { number: 'QR-000153' } },
    linkPath: '/quote-requests/x',
    ...overrides,
  });

  const rowsOf = async (key: string) =>
    (await sql(`select "id", "title_message", "organization_id" from "customer_notifications" where "source_key" = ?`, [
      `${SOURCE}:${key}`,
    ])) as Array<{ id: string; title_message: unknown; organization_id: string }>;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await sql(`delete from "customer_notifications" where "source_key" like ?`, [`${SOURCE}:%`]);
    await teardownBackendServer(h);
  });

  it('recordWithin writes nothing until the caller flushes, and commits with the caller', async () => {
    const record = await inScope(() =>
      h.em().fork().transactional(async (em) => {
        const answered = port().recordWithin(em, input('commit'));
        expect(await rowsOf('commit')).toHaveLength(0);
        return answered;
      }),
    );

    const rows = await rowsOf('commit');
    expect(rows.map((row) => row.id)).toEqual([record.id]);
    expect(rows[0]).toMatchObject({
      organization_id: TEST_ORGANIZATION_ID,
      title_message: { scope: 'quote_requests', key: 'customerNotifications.approved.title', params: { number: 'QR-000153' } },
    });
  });

  it('recordWithin is gone when the caller rolls back', async () => {
    await expect(
      inScope(() =>
        h.em().fork().transactional(async (em) => {
          port().recordWithin(em, input('rollback'));
          await em.flush();
          throw new Error('the caller changed its mind');
        }),
      ),
    ).rejects.toThrow('the caller changed its mind');

    expect(await rowsOf('rollback')).toHaveLength(0);
  });

  it('record commits on its own and answers the existing entry for a repeated source key', async () => {
    const first = await inScope(() => port().record(input('repeat')));
    const second = await inScope(() => port().record(input('repeat', { title: 'A different sentence' })));

    expect(second).toEqual(first);
    expect(await rowsOf('repeat')).toHaveLength(1);
  });

  it('the database holds the source key unique and the link storefront-relative', async () => {
    await inScope(() => port().record(input('unique')));
    await expect(
      inScope(() =>
        h.em().fork().transactional(async (em) => {
          port().recordWithin(em, input('unique'));
        }),
      ),
    ).rejects.toThrow(/customer_notifications_source_unique/);

    const id = randomUUID();
    await expect(
      sql(
        `insert into "customer_notifications"
           ("id", "organization_id", "customer_account_id", "source_module", "source_key", "kind", "title", "title_message", "link_path")
         values (?, ?, ?, 'quote_requests', ?, 'k', 't', '{}'::jsonb, '//evil.example')`,
        [id, TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID, `${SOURCE}:link`],
      ),
    ).rejects.toThrow(/customer_notifications_link_chk/);
    await expect(
      sql(
        `insert into "customer_notifications"
           ("id", "organization_id", "customer_account_id", "source_module", "source_key", "kind", "title", "title_message", "body_message")
         values (?, ?, ?, 'quote_requests', ?, 'k', 't', '{}'::jsonb, '{}'::jsonb)`,
        [id, TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID, `${SOURCE}:body`],
      ),
    ).rejects.toThrow(/customer_notifications_body_chk/);
  });
});
