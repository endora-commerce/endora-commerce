import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261117T120057QuoteRequestsRenumberResubmittedPlaceholders } from '@endora-commerce/mod-quote-requests/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * A re-submitted quote request used to keep the entity's `QR-<uuid>`
 * placeholder as its number. The migration gives every such request a number
 * from `quote_requests_business_id_seq`, oldest first, with the configured
 * prefix and suffix, and leaves every other number alone. Everything runs in
 * one transaction the test rolls back.
 */
describe('renumber re-submitted placeholder business ids (migration)', () => {
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

  async function runUp(): Promise<void> {
    const migration = new Migration20261117T120057QuoteRequestsRenumberResubmittedPlaceholders(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    for (const sql of migration.getQueries()) await em.execute(String(sql));
  }

  async function insertQuote(businessId: string, createdAt: string): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "quote_requests"
         ("id", "organization_id", "customer_account_id", "status", "created_at", "updated_at", "business_id")
       values (?, ?, ?, 'Pending', ?, ?, ?)`,
      [id, randomUUID(), randomUUID(), createdAt, createdAt, businessId],
    );
    return id;
  }

  async function numberOf(id: string): Promise<string> {
    const rows = (await em.execute(`select business_id from "quote_requests" where id = ?`, [id])) as Array<{
      business_id: string;
    }>;
    return rows[0]!.business_id;
  }

  async function setAffix(code: string, value: string): Promise<void> {
    const rows = (await em.execute(`select id from "settings" where code = ?`, [code])) as Array<{ id: string }>;
    if (rows.length > 0) {
      await em.execute(`update "settings" set default_value = to_jsonb(?::text) where code = ?`, [value, code]);
      return;
    }
    const groups = (await em.execute(`select id from "setting_groups" limit 1`)) as Array<{ id: string }>;
    let groupId = groups[0]?.id;
    if (!groupId) {
      groupId = randomUUID();
      await em.execute(
        `insert into "setting_groups" ("id", "code", "name", "owner_module", "created_at", "updated_at")
         values (?, 'test_group', 'Test', 'quote_requests', now(), now())`,
        [groupId],
      );
    }
    await em.execute(
      `insert into "settings" ("id", "code", "name", "group_id", "value_type", "default_value", "owner_module", "created_at", "updated_at")
       values (?, ?, ?, ?, 'string', to_jsonb(?::text), 'quote_requests', now(), now())`,
      [randomUUID(), code, code, groupId, value],
    );
  }

  it('numbers every placeholder from the sequence, oldest first, and leaves other numbers alone', async () => {
    const older = await insertQuote(`QR-${randomUUID()}`, '2026-11-01T10:00:00Z');
    const newer = await insertQuote(`QR-${randomUUID()}`, '2026-11-02T10:00:00Z');
    const numbered = await insertQuote('QR-000153', '2026-10-01T10:00:00Z');
    const lookalike = await insertQuote('QR-1234', '2026-10-02T10:00:00Z');

    await runUp();

    const a = await numberOf(older);
    const b = await numberOf(newer);
    expect(a).toMatch(/^\d+$/);
    expect(b).toMatch(/^\d+$/);
    expect(Number(b)).toBeGreaterThan(Number(a));
    expect(await numberOf(numbered)).toBe('QR-000153');
    expect(await numberOf(lookalike)).toBe('QR-1234');

    // A second run finds nothing left to number.
    await runUp();
    expect(await numberOf(older)).toBe(a);
    expect(await numberOf(newer)).toBe(b);
  });

  it('wraps the number in the configured prefix and suffix', async () => {
    await setAffix('quote_requests.business_id.prefix', 'RFQ/');
    await setAffix('quote_requests.business_id.suffix', '/PL');
    const id = await insertQuote(`QR-${randomUUID()}`, '2026-11-03T10:00:00Z');

    await runUp();

    expect(await numberOf(id)).toMatch(/^RFQ\/\d+\/PL$/);
  });
});
