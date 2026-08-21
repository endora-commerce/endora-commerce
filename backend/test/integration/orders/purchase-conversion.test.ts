import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { PurchaseConversionService } from '../../../src/modules/orders/services/purchase-conversion-service.js';

/**
 * Issue #277 — the order column that says a GA4 `purchase` conversion is still
 * owed, against a real PostgreSQL.
 *
 * The point of moving this off Redis was the reliability of the data: the
 * marker never expires and survives a restart, so the two things this file has
 * to show are that spending it is one-shot and that its inverted sense holds
 * for the rows that predate it.
 */
interface MarkerRow {
  purchase_conversion_owed: boolean;
  /** Raw `execute` hands the timestamp back as PostgreSQL rendered it. */
  purchase_conversion_reported_at: string | null;
}

describe('purchase conversion marker (issue #277)', () => {
  let db: TestDb;
  let service: PurchaseConversionService;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    await db.beginTx();
    service = new PurchaseConversionService(() => db.em());
  });
  afterEach(() => db.rollbackTx());
  afterAll(() => db.close());

  /**
   * An order row with the marker in a chosen state.
   *
   * Written as raw SQL rather than through `em.create(Order, …)` because the
   * whole subject is a column default and a conditional update; hydrating an
   * entity would let the ORM decide what the row says.
   */
  async function seedOrder(owed: boolean | null): Promise<string> {
    const id = randomUUID();
    const columns = [
      'id',
      'business_id',
      'organization_id',
      'placed_by_customer_account_id',
      'sales_channel_id',
      'status',
      'payment_status',
      'delivery_address',
      'billing_address',
      'delivery_method_id',
      'delivery_method_snapshot',
      'payment_method_id',
      'payment_method_snapshot',
      'subtotal',
      'tax_total',
      'discount_total',
      'delivery_total',
      'total',
      'currency',
      'placed_at',
      'created_at',
      'updated_at',
      'custom_field_values',
    ];
    const values = [
      id,
      `IT-${id.slice(0, 8)}`,
      randomUUID(),
      randomUUID(),
      db.systemDefaultChannelId,
      'new',
      'awaiting_payment',
      '{}',
      '{}',
      randomUUID(),
      '{}',
      randomUUID(),
      '{}',
      '10.00',
      '0.00',
      '0.00',
      '0.00',
      '10.00',
      'PLN',
      new Date(),
      new Date(),
      new Date(),
      '{}',
    ];
    // `owed === null` is the shape of a row that predates the migration: the
    // column is simply not named, so its default decides.
    const named = owed === null ? columns : [...columns, 'purchase_conversion_owed'];
    const bound = owed === null ? values : [...values, owed];
    await db
      .em()
      .execute(
        `insert into "orders" (${named.map((c) => `"${c}"`).join(', ')}) ` +
          `values (${named.map(() => '?').join(', ')})`,
        bound,
      );
    return id;
  }

  async function marker(id: string): Promise<MarkerRow> {
    const rows = (await db
      .em()
      .execute(
        `select "purchase_conversion_owed", "purchase_conversion_reported_at" ` +
          `from "orders" where "id" = ?`,
        [id],
      )) as MarkerRow[];
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  it('grants the conversion once, and stamps when it was reported', async () => {
    const id = await seedOrder(true);
    expect(await service.claim(id)).toBe(true);

    const after = await marker(id);
    expect(after.purchase_conversion_owed).toBe(false);
    expect(after.purchase_conversion_reported_at).not.toBeNull();
    expect(Number.isNaN(Date.parse(after.purchase_conversion_reported_at!))).toBe(false);

    // Every later view of the same order, on any device.
    expect(await service.claim(id)).toBe(false);
    expect(await service.claim(id)).toBe(false);
    // The stamp is the first report's, not the last attempt's.
    expect((await marker(id)).purchase_conversion_reported_at).toEqual(
      after.purchase_conversion_reported_at,
    );
  });

  it('grants nothing for an order that predates the column, and leaves it untouched', async () => {
    // The inverted sense is the whole of this: an order placed before the
    // migration was counted by the old unconditional Success Page, so its
    // default `false` has to mean "owes nothing" and not "not yet counted".
    const id = await seedOrder(null);
    expect((await marker(id)).purchase_conversion_owed).toBe(false);
    expect(await service.claim(id)).toBe(false);

    const after = await marker(id);
    expect(after.purchase_conversion_owed).toBe(false);
    // Never reported, and distinguishable from an order that was: no stamp.
    expect(after.purchase_conversion_reported_at).toBeNull();
  });

  it('grants nothing for an order that is not there', async () => {
    expect(await service.claim(randomUUID())).toBe(false);
  });

  it('grants the conversion to exactly one of two views racing for it', async () => {
    // Issued together rather than one after the other: the conditional update
    // is what decides, and a read-then-write would let both pass the read.
    const id = await seedOrder(true);
    const results = await Promise.all([service.claim(id), service.claim(id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('keeps the claims of two orders apart', async () => {
    const first = await seedOrder(true);
    const second = await seedOrder(true);
    expect(await service.claim(first)).toBe(true);
    expect((await marker(second)).purchase_conversion_owed).toBe(true);
    expect(await service.claim(second)).toBe(true);
  });
});
