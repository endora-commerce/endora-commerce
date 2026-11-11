import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CUSTOMER_ACCOUNT_ANONYMIZED_EVENT,
  type CustomerAccountLifecycleWritePort,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #857 — two anonymisation passes over one account scrub it once.
 *
 * BullMQ can hand a tick back after it lost the lock while the previous pass is
 * still running, so two passes can reach `anonymize` for the same account at
 * once. The `anonymizedAt` check is what makes the call a no-op on a scrubbed
 * account, and it is only a guard if the second caller reads the first one's
 * commit: `anonymize` locks the row (`select … for update`) inside its
 * transaction before it reads `anonymizedAt`. Without the lock both read
 * `null`, both scrub, and the account gets two `customer_account.anonymized`
 * audit rows and two `customer_account.anonymized.v1` events.
 *
 * The race is staged, not hoped for: a third transaction holds the row while
 * both calls start, and is released only once both are waiting on it. With the
 * lock they wait at the read; without it they read `null` first and wait at the
 * update. Either way the release lets them through in turn.
 */
describe('customer_accounts — anonymize under concurrency (#857)', () => {
  let h: BackendServerHandle;
  let writes: CustomerAccountLifecycleWritePort;

  async function sql<T>(statement: string, params: unknown[] = []): Promise<T[]> {
    return (await h.em().getConnection().execute(statement, params)) as T[];
  }

  async function softDeletedAccount(): Promise<string> {
    const organizationId = randomUUID();
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path","created_at","updated_at")
       values (?, 'Anonymize lock', ?, 'active', 'vat_payer', '{}'::jsonb, ?, now(), now())`,
      [organizationId, `ANON${organizationId.slice(0, 13).replace(/-/g, '').toUpperCase()}`, `/${organizationId}/`],
    );
    const id = randomUUID();
    await sql(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","organization_role_id",
          "deleted_at","created_at","updated_at")
       values (?, ?, ?, 'x', 'Twice', 'Scrubbed',
               (select "id" from "organization_roles" where "organization_id" = ? and "kind" = 'administrator'),
               now() - interval '400 days', now(), now())`,
      [id, organizationId, `${id.slice(0, 8)}@anonymize-lock.example`, organizationId],
    );
    return id;
  }

  /** Sessions of this database waiting on a lock on `customer_accounts`. */
  async function waitingOnTheRow(): Promise<number> {
    const [row] = await sql<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query ilike '%customer_accounts%'`,
    );
    return Number(row?.n ?? 0);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    writes = h.container.resolve<CustomerAccountLifecycleWritePort>('customerAccountLifecycleWritePort');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('two concurrent calls write one audit row and announce one event', async () => {
    const accountId = await softDeletedAccount();
    const announced: string[] = [];
    const off = h.eventBus.on(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT as never, (payload: unknown) => {
      announced.push((payload as { customerAccountId: string }).customerAccountId);
    });

    const holder = h.em().fork();
    await holder.begin();
    let calls: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await holder.execute(`select "id" from "customer_accounts" where "id" = ? for update`, [accountId]);
      const anonymize = () =>
        withSystemScope('test: concurrent anonymisation passes', () => writes.anonymize(accountId));
      calls = Promise.allSettled([anonymize(), anonymize()]);
      const deadline = Date.now() + 10_000;
      while ((await waitingOnTheRow()) < 2) {
        if (Date.now() > deadline) throw new Error('the two calls never both waited on the account row');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await holder.commit();
    } catch (error) {
      await holder.rollback().catch(() => undefined);
      throw error;
    }

    const outcomes = await calls!;
    off?.();
    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled']);

    const [audit] = await sql<{ n: number }>(
      `select count(*)::int as n from "audit_log_entries" where "action" = 'customer_account.anonymized' and "object_id" = ?`,
      [accountId],
    );
    expect(Number(audit?.n)).toBe(1);
    expect(announced.filter((id) => id === accountId)).toEqual([accountId]);
  });
});
