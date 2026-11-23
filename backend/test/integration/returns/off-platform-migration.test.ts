import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Migration20261113T155433ReturnsOffPlatformComplaints,
  Migration20261116T104415ReturnsGuestComplaints,
} from '@endora-commerce/mod-returns/migrations';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { insertRows } from '../../helpers/sql-rows.js';

/**
 * `specs/180-off-platform-complaints/` T047 (data-model §2.1 – §2.5): migration B —
 * the nullable order, the purchase/contact/address/clause/note/key/erasure columns
 * and their checks, the line changes, the attachments reclassified with an
 * `organization_id` back-filled from their case, and `return_case_clauses`. `down`
 * reverses on a database without off-platform rows and refuses with one.
 */
describe('returns — migration B: complaints without a platform order', () => {
  let h: BackendServerHandle;
  let channelId: string;

  async function run(
    direction: 'up' | 'down',
    migrationClass:
      | typeof Migration20261113T155433ReturnsOffPlatformComplaints
      | typeof Migration20261116T104415ReturnsGuestComplaints = Migration20261113T155433ReturnsOffPlatformComplaints,
  ): Promise<void> {
    const em = h.em();
    const migration = new migrationClass(em.getDriver(), em.config);
    await migration[direction]();
    // In one transaction: a refused step must leave the schema as it was, or every later
    // file on this worker's database meets a half-migrated `returns`.
    const connection = em.getConnection();
    await connection.transactional(async (trx) => {
      for (const query of migration.getQueries()) await connection.execute(query as string, [], 'run', trx);
    });
    em.clear();
  }

  const exec = (sql: string, params: unknown[] = []) => h.em().execute(sql, params);

  async function insertCase(over: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    const row: Record<string, unknown> = {
      id,
      kind: 'complaint',
      order_id: randomUUID(),
      sales_channel_id: channelId,
      customer_account_id: TEST_CUSTOMER_ID,
      organization_id: TEST_ORGANIZATION_ID,
      status_code: 'new',
      currency: 'PLN',
      submitted_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
      ...over,
    };
    await insertRows(h.em(), 'return_cases', row);
    return id;
  }

  async function columnExists(table: string, column: string): Promise<boolean> {
    const rows = await exec('select count(*)::text as n from information_schema.columns where table_name = ? and column_name = ?', [
      table,
      column,
    ]);
    return (rows as Array<{ n: string }>)[0]?.n === '1';
  }

  async function tableExists(table: string): Promise<boolean> {
    const rows = await exec('select to_regclass(?)::text as t', [table]);
    return (rows as Array<{ t: string | null }>)[0]?.t !== null;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = await systemDefaultSalesChannelId(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('adds the case, line and attachment columns and the clause table', async () => {
    for (const column of [
      'purchase_proof_number',
      'purchase_date',
      'contact',
      'return_address',
      'accepted_clauses',
      'clauses_accepted_at',
      'resolution_note',
      'submission_key',
      'personal_data_erased_at',
    ]) {
      expect(await columnExists('return_cases', column), column).toBe(true);
    }
    expect(await columnExists('return_case_items', 'serial_number')).toBe(true);
    for (const column of ['organization_id', 'customer_account_id', 'type', 'filename', 'mime_type', 'size_bytes', 'storage_backend', 'storage_locator', 'expires_at']) {
      expect(await columnExists('return_case_attachments', column), column).toBe(true);
    }
    expect(await tableExists('return_case_clauses')).toBe(true);
    for (const column of ['applies_to', 'mode', 'link_url', 'revision']) {
      expect(await columnExists('return_case_clauses', column), column).toBe(true);
    }
  });

  it('accepts an order-less complaint with a purchase date', async () => {
    await expect(insertCase({ order_id: null, purchase_date: '2026-10-01' })).resolves.toBeTruthy();
  });

  it('refuses an order-less return, and an order-less case without a purchase date', async () => {
    await expect(insertCase({ order_id: null, kind: 'return', purchase_date: '2026-10-01' })).rejects.toThrow();
    await expect(insertCase({ order_id: null })).rejects.toThrow();
  });

  it('refuses settled_outside on an order case, and without a note', async () => {
    await expect(insertCase({ resolution_type: 'settled_outside', resolution_note: 'x' })).rejects.toThrow();
    await expect(insertCase({ order_id: null, purchase_date: '2026-10-01', resolution_type: 'settled_outside' })).rejects.toThrow();
    await expect(
      insertCase({ order_id: null, purchase_date: '2026-10-01', resolution_type: 'settled_outside', resolution_note: 'refunded in store' }),
    ).resolves.toBeTruthy();
  });

  it('holds one submission key per customer account', async () => {
    const key = randomUUID();
    await insertCase({ submission_key: key });
    await expect(insertCase({ submission_key: key })).rejects.toThrow();
  });

  it('refuses an attachment that is neither linked nor stored, and a stored one neither attached nor pending', async () => {
    const caseId = await insertCase();
    await expect(
      insertRows(h.em(), 'return_case_attachments', { id: randomUUID(), return_case_id: caseId, organization_id: TEST_ORGANIZATION_ID, created_at: new Date() }),
    ).rejects.toThrow();
    await expect(
      insertRows(h.em(), 'return_case_attachments', {
        id: randomUUID(),
        organization_id: TEST_ORGANIZATION_ID,
        storage_locator: 'returns/x/y',
        created_at: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('down reverses on a database without off-platform rows, up back-fills the attachments’ organization', async () => {
    // The rows only a database without this migration could not hold. Lines have no
    // foreign key to their case, so an earlier file's no-order lines are removed by shape.
    await exec('delete from "return_cases" where "order_id" is null');
    await exec('delete from "return_case_items" where "order_item_id" is null or "product_id" is null');
    await exec('delete from "return_case_attachments" where "storage_locator" is not null');
    // `specs/181-guest-complaints/` stacks on this migration: unwind it first, as a
    // rollback does (newest first), or dropping these columns takes its checks with them.
    await exec('delete from "return_cases" where "customer_account_id" is null');
    await run('down', Migration20261116T104415ReturnsGuestComplaints);
    await run('down');
    expect(await columnExists('return_cases', 'purchase_date')).toBe(false);
    expect(await columnExists('return_case_attachments', 'organization_id')).toBe(false);
    expect(await tableExists('return_case_clauses')).toBe(false);

    // A legacy attachment, as the old API wrote it.
    const caseId = await insertCase();
    const attachmentId = randomUUID();
    await insertRows(h.em(), 'return_case_attachments', { id: attachmentId, return_case_id: caseId, asset_id: randomUUID(), created_at: new Date() });

    await run('up');
    await run('up', Migration20261116T104415ReturnsGuestComplaints);
    const rows = await exec('select "organization_id", "type" from "return_case_attachments" where "id" = ?', [attachmentId]);
    expect(rows[0]).toEqual({ organization_id: TEST_ORGANIZATION_ID, type: 'other' });
  });

  it('down refuses while a case without a platform order exists', async () => {
    await insertCase({ order_id: null, purchase_date: '2026-10-01' });
    await expect(run('down')).rejects.toThrow(/without a platform order/);
    expect(await columnExists('return_cases', 'purchase_date')).toBe(true);
  });
});
