import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261124T131435QuoteRequestsQuoteRequestSharing } from '@endora-commerce/mod-quote-requests/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * `specs/192-quote-request-draft-share/` T005 (research R-17) — the sharing
 * columns. A quote request that existed before the migration stays visible to
 * its customer (FR-002, SC-004); a `shared` history event is accepted; the
 * validity days are never negative. Everything runs in one transaction the
 * test rolls back: `down()` first, so the row is inserted into the schema
 * before this migration, then `up()`.
 */
describe('quote request sharing columns (migration)', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261124T131435QuoteRequestsQuoteRequestSharing(em.getDriver(), em.config);
    await migration[direction]();
    for (const sql of migration.getQueries()) await em.execute(String(sql));
  }

  async function insertQuote(status: string): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "quote_requests"
         ("id", "organization_id", "customer_account_id", "status", "created_at", "updated_at", "business_id")
       values (?, ?, ?, ?, now(), now(), ?)`,
      [id, randomUUID(), randomUUID(), status, `QR-${randomUUID()}`],
    );
    return id;
  }

  it('a row written before the migration reads shared, with no share facts', async () => {
    await run('down');
    const legacyOperatorQuote = await insertQuote('Created from admin');
    const customerQuote = await insertQuote('Pending');
    await run('up');

    const rows = (await em.execute(
      `select "id", "shared_with_customer", "shared_at", "shared_by_admin_user_id", "share_validity_days"
         from "quote_requests" where "id" in (?, ?)`,
      [legacyOperatorQuote, customerQuote],
    )) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        shared_with_customer: true,
        shared_at: null,
        shared_by_admin_user_id: null,
        share_validity_days: null,
      });
    }
  });

  it('accepts a `shared` history event', async () => {
    const id = await insertQuote('Created from admin');
    await em.execute(
      `insert into "quote_request_events" ("id", "quote_request_id", "event_type", "payload", "created_at")
       values (?, ?, 'shared', '{"type":"shared"}'::jsonb, now())`,
      [randomUUID(), id],
    );
    const rows = (await em.execute(
      `select count(*)::int as n from "quote_request_events" where "quote_request_id" = ? and "event_type" = 'shared'`,
      [id],
    )) as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });

  it('refuses negative validity days', async () => {
    const id = await insertQuote('Created from admin');
    await em.execute(`update "quote_requests" set "share_validity_days" = 0 where "id" = ?`, [id]);
    await expect(
      em.execute(`update "quote_requests" set "share_validity_days" = -1 where "id" = ?`, [id]),
    ).rejects.toThrow(/quote_requests_share_validity_days_check/);
  });
});
