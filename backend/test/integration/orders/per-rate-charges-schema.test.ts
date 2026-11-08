import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #904, Phase A — the `orders` columns delivery and the payment surcharge
 * will carry the goods' VAT in (design §5). Nothing writes them yet: an order is
 * still placed `per_rate` with its charges at 0 %, so every row reads
 * `charge_lines = null`, and `'per_rate_charges'` is only admitted by the
 * constraint, ready for the placement switch of Phase B.
 */

let db: TestDb;

beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.beginTx();
});
afterEach(async () => {
  await db.rollbackTx();
});

async function insertOrder(vatMethod: string | null): Promise<string> {
  const orderId = randomUUID();
  await db.em().execute(
    `insert into "orders" (
       "id", "organization_id", "placed_by_customer_account_id", "sales_channel_id",
       "delivery_address", "billing_address", "delivery_method_id", "delivery_method_snapshot",
       "payment_method_id", "payment_method_snapshot", "subtotal", "tax_total", "delivery_total",
       "total", "currency", "placed_at", "created_at", "updated_at", "business_id", "vat_method")
     values (?, ?, ?, ?, '{}', '{}', ?, '{}', ?, '{}', 10, 0, 0, 10, 'PLN', now(), now(), now(), ?, ?)`,
    [orderId, randomUUID(), randomUUID(), db.systemDefaultChannelId, randomUUID(), randomUUID(), `904-SCHEMA-${orderId}`, vatMethod],
  );
  return orderId;
}

describe('904 Phase A — orders.charge_lines and the per_rate_charges VAT method [integration]', () => {
  it('adds a nullable jsonb charge_lines column', async () => {
    const cols = await db.em().execute<{ data_type: string; is_nullable: string }[]>(
      `select "data_type", "is_nullable" from information_schema.columns
        where table_schema = current_schema() and table_name = 'orders' and column_name = 'charge_lines'`,
    );
    expect(cols).toEqual([{ data_type: 'jsonb', is_nullable: 'YES' }]);
  });

  it('leaves charge_lines null on an order that names none', async () => {
    const id = await insertOrder('per_rate');
    const [row] = await db.em().execute<{ charge_lines: unknown }[]>(
      `select "charge_lines" from "orders" where "id" = ?`,
      [id],
    );
    expect(row?.charge_lines).toBeNull();
  });

  it('admits per_rate_charges beside per_rate and null, and still refuses anything else', async () => {
    for (const method of ['per_rate', 'per_rate_charges', null]) {
      await expect(insertOrder(method)).resolves.toBeTypeOf('string');
    }
    await expect(insertOrder('gross')).rejects.toThrow(/orders_vat_method_check/);
  });
});
