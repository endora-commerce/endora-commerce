import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 163, Phase 3 (T014) — the schema `catalog`'s `product_scopes` migration
 * adds (`specs/163-product-data-scopes/data-model.md` §1–§3).
 *
 * - `product_channel_scopes` and `product_channel_language_scopes` exist, keyed by
 *   (product, channel[, language]);
 * - their `CHECK`s refuse a status outside the value set, a window whose start is
 *   not before its end, a minimum outside 1…1 000 000, an organization list without
 *   a visibility, and window bounds on a row that does not override the window;
 * - `products.publish_from` / `publish_until` exist with the same ordering check;
 * - both tables cascade on a product's hard delete and on a channel's delete
 *   (edge case *Channel deleted*);
 * - final QA Q-L3: so does every other channel-keyed table of the feature —
 *   `product_url_keys`' channel × language keys and `seo_meta_overrides`' channel rows
 *   (rows inserted and deleted with the channel), and the gallery / attachment
 *   per-channel tables (their foreign key to `sales_channels` is `on delete cascade`,
 *   read from `pg_constraint`: a row there needs an asset the schema test does not
 *   build).
 *
 * Rows are inserted with raw SQL, so every default and refusal asserted is the
 * database's. Every refusal runs under a savepoint so the test transaction
 * survives it; the whole test rolls back.
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

async function insertProduct(em: EntityManager): Promise<string> {
  const id = randomUUID();
  const stamp = `${Date.now()}-${id.slice(0, 8)}`;
  await em.execute(
    `insert into "products" ("id", "sku", "slug", "type", "name", "description", "created_at", "updated_at")
     values (?, ?, ?, 'simple', '{"en-US":"Scopes schema"}', '{}', now(), now())`,
    [id, `162-SCHEMA-${stamp}`, `162-schema-${stamp}`],
  );
  return id;
}

async function insertChannel(em: EntityManager): Promise<string> {
  const id = randomUUID();
  await em.execute(
    `insert into "sales_channels" ("id", "code", "name", "default_language", "languages", "default_currency", "created_at", "updated_at")
     values (?, ?, '{"en-US":"162 scopes"}'::jsonb, 'pl-PL', '["pl-PL","de-DE"]'::jsonb, 'PLN', now(), now())`,
    [id, `s162-${id.slice(0, 8)}`],
  );
  return id;
}

async function insertChannelRow(em: EntityManager, productId: string, channelId: string): Promise<void> {
  await em.execute(
    `insert into "product_channel_scopes" ("product_id", "sales_channel_id", "status", "created_at", "updated_at")
     values (?, ?, 'inactive', now(), now())`,
    [productId, channelId],
  );
}

async function insertLanguageRow(em: EntityManager, productId: string, channelId: string): Promise<void> {
  await em.execute(
    `insert into "product_channel_language_scopes" ("product_id", "sales_channel_id", "language_code", "status", "created_at", "updated_at")
     values (?, ?, 'de-DE', 'active', now(), now())`,
    [productId, channelId],
  );
}

async function expectRefused(em: EntityManager, sql: string, params: unknown[], constraint: string): Promise<void> {
  await em.execute('savepoint product_scopes_check');
  await expect(em.execute(sql, params)).rejects.toThrow(new RegExp(constraint));
  await em.execute('rollback to savepoint product_scopes_check');
}

async function count(em: EntityManager, table: string, productId: string): Promise<number> {
  const rows = await em.execute<{ n: string }[]>(`select count(*)::text as "n" from "${table}" where "product_id" = ?`, [
    productId,
  ]);
  const [row] = rows;
  if (!row) throw new Error('count(*) returned no row');
  return Number(row.n);
}

describe('163 — product scope tables [integration]', () => {
  it('a channel row inserted with only its key and status inherits every other field', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    await insertChannelRow(em, productId, channelId);
    const rows = await em.execute<Record<string, unknown>[]>(
      `select "status", "window_overridden", "publish_from", "publish_until", "visibility",
              "allowed_organization_ids", "min_order_quantity", "returnable"
         from "product_channel_scopes" where "product_id" = ? and "sales_channel_id" = ?`,
      [productId, channelId],
    );
    expect(rows[0]).toEqual({
      status: 'inactive',
      window_overridden: false,
      publish_from: null,
      publish_until: null,
      visibility: null,
      allowed_organization_ids: null,
      min_order_quantity: null,
      returnable: null,
    });
  });

  it('(product, channel) is the key of product_channel_scopes', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    await insertChannelRow(em, productId, channelId);
    await expectRefused(
      em,
      `insert into "product_channel_scopes" ("product_id", "sales_channel_id", "created_at", "updated_at") values (?, ?, now(), now())`,
      [productId, channelId],
      'product_channel_scopes_pkey',
    );
  });

  it('product_channel_scopes refuses a status outside the value set', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    await insertChannelRow(em, productId, channelId);
    const update = `update "product_channel_scopes" set "status" = ? where "product_id" = ?`;
    await em.execute(update, ['active', productId]);
    await em.execute(update, ['inactive', productId]);
    await em.execute(update, [null, productId]);
    await expectRefused(em, update, ['archived', productId], 'product_channel_scopes_status_check');
  });

  it('product_channel_scopes refuses from >= until and accepts an open or ordered pair', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    await insertChannelRow(em, productId, channelId);
    const update = `update "product_channel_scopes" set "window_overridden" = true, "publish_from" = ?, "publish_until" = ? where "product_id" = ?`;
    await em.execute(update, ['2026-12-01T00:00:00Z', '2026-12-31T00:00:00Z', productId]);
    await em.execute(update, [null, null, productId]);
    await expectRefused(
      em,
      update,
      ['2026-12-31T00:00:00Z', '2026-12-01T00:00:00Z', productId],
      'product_channel_scopes_window_order_check',
    );
    await expectRefused(
      em,
      update,
      ['2026-12-01T00:00:00Z', '2026-12-01T00:00:00Z', productId],
      'product_channel_scopes_window_order_check',
    );
  });

  it('product_channel_scopes refuses window bounds on a row that does not override the window', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    await insertChannelRow(em, productId, channelId);
    await expectRefused(
      em,
      `update "product_channel_scopes" set "window_overridden" = false, "publish_from" = '2026-12-01T00:00:00Z' where "product_id" = ?`,
      [productId],
      'product_channel_scopes_window_flag_check',
    );
  });

  it('product_channel_scopes refuses a minimum of 0 and 1 000 001 and accepts 1 and 1 000 000', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    await insertChannelRow(em, productId, channelId);
    // Feature 170 (data-model §4) — a minimum is held only with the overridden flag.
    const update = `update "product_channel_scopes" set "min_order_quantity_overridden" = true, "min_order_quantity" = ? where "product_id" = ?`;
    await em.execute(update, [1, productId]);
    await em.execute(update, [1_000_000, productId]);
    await expectRefused(em, update, [0, productId], 'product_channel_scopes_min_order_quantity_check');
    await expectRefused(em, update, [1_000_001, productId], 'product_channel_scopes_min_order_quantity_check');
  });

  it('product_channel_scopes holds the audience as a pair', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    await insertChannelRow(em, productId, channelId);
    const update = `update "product_channel_scopes" set "visibility" = ?, "allowed_organization_ids" = ?::jsonb where "product_id" = ?`;
    await em.execute(update, ['organization_restricted', JSON.stringify([randomUUID()]), productId]);
    await em.execute(update, ['public', '[]', productId]);
    await em.execute(update, [null, null, productId]);
    await expectRefused(em, update, [null, '[]', productId], 'product_channel_scopes_audience_pair_check');
    await expectRefused(em, update, ['public', null, productId], 'product_channel_scopes_audience_pair_check');
    await expectRefused(em, update, ['everyone', '[]', productId], 'product_channel_scopes_visibility_check');
  });

  it('product_channel_language_scopes is keyed by (product, channel, language) and refuses a bad status', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    await insertLanguageRow(em, productId, channelId);
    await expectRefused(
      em,
      `insert into "product_channel_language_scopes" ("product_id", "sales_channel_id", "language_code", "status", "created_at", "updated_at")
       values (?, ?, 'de-DE', 'inactive', now(), now())`,
      [productId, channelId],
      'product_channel_language_scopes_pkey',
    );
    await expectRefused(
      em,
      `update "product_channel_language_scopes" set "status" = 'archived' where "product_id" = ?`,
      [productId],
      'product_channel_language_scopes_status_check',
    );
    await expectRefused(
      em,
      `update "product_channel_language_scopes" set "status" = null where "product_id" = ?`,
      [productId],
      'null value',
    );
  });

  it('products.publish_from / publish_until are null by default and ordered by a check', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const rows = await em.execute<{ publish_from: Date | null; publish_until: Date | null }[]>(
      `select "publish_from", "publish_until" from "products" where "id" = ?`,
      [productId],
    );
    expect(rows[0]).toEqual({ publish_from: null, publish_until: null });
    const update = `update "products" set "publish_from" = ?, "publish_until" = ? where "id" = ?`;
    await em.execute(update, ['2026-12-01T00:00:00Z', '2026-12-31T00:00:00Z', productId]);
    await em.execute(update, [null, '2026-12-31T00:00:00Z', productId]);
    await expectRefused(
      em,
      update,
      ['2026-12-31T00:00:00Z', '2026-12-01T00:00:00Z', productId],
      'products_publish_window_check',
    );
  });

  it('both tables cascade when the product is hard-deleted', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    await insertChannelRow(em, productId, channelId);
    await insertLanguageRow(em, productId, channelId);
    await em.execute(`delete from "products" where "id" = ?`, [productId]);
    expect(await count(em, 'product_channel_scopes', productId)).toBe(0);
    expect(await count(em, 'product_channel_language_scopes', productId)).toBe(0);
  });

  it('both tables cascade when the channel is deleted', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    await insertChannelRow(em, productId, channelId);
    await insertLanguageRow(em, productId, channelId);
    await em.execute(`delete from "sales_channels" where "id" = ?`, [channelId]);
    expect(await count(em, 'product_channel_scopes', productId)).toBe(0);
    expect(await count(em, 'product_channel_language_scopes', productId)).toBe(0);
  });

  it('a channel delete cascades to its URL keys and its SEO overrides (Q-L3)', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const channelId = await insertChannel(em);
    const key = `s163-cascade-${productId.slice(0, 8)}`;
    await em.execute(
      `insert into "product_url_keys" ("id", "product_id", "language_code", "sales_channel_id", "key")
       values (?, ?, 'pl-PL', ?, ?)`,
      [randomUUID(), productId, channelId, key],
    );
    await em.execute(
      `insert into "seo_meta_overrides" ("id", "entity_type", "entity_id", "locale", "sales_channel_id", "title", "created_at", "updated_at")
       values (?, 'product', ?, null, ?, 'Channel title', now(), now()),
              (?, 'product', ?, 'pl-PL', ?, 'Channel x language title', now(), now())`,
      [randomUUID(), productId, channelId, randomUUID(), productId, channelId],
    );
    expect(await count(em, 'product_url_keys', productId)).toBe(1);
    await em.execute(`delete from "sales_channels" where "id" = ?`, [channelId]);
    expect(await count(em, 'product_url_keys', productId)).toBe(0);
    const [seo] = await em.execute<{ n: string }[]>(
      `select count(*)::text as "n" from "seo_meta_overrides" where "entity_id" = ?`,
      [productId],
    );
    expect(Number(seo?.n)).toBe(0);
  });

  // Feature 170 (data-model §6–§7) — the 163 media tables are replaced by the scope override tables.
  it('every per-channel media table cascades on a channel delete (Q-L3)', async () => {
    const em = db.em();
    const rows = await em.execute<Array<{ table: string; on_delete: string }>>(
      `select c.conrelid::regclass::text as "table", c.confdeltype::text as "on_delete"
         from pg_constraint c
        where c.contype = 'f'
          and c.confrelid = 'sales_channels'::regclass
          and c.conrelid::regclass::text in (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'gallery_item_scope_overrides',
        'gallery_role_scope_overrides',
        'product_attachment_scope_overrides',
        'product_packaging_unit_scope_overrides',
        'product_url_keys',
        'seo_meta_overrides',
        'product_channel_scopes',
        'product_channel_language_scopes',
      ],
    );
    const byTable = Object.fromEntries(rows.map((row) => [row.table.replace(/"/g, ''), row.on_delete]));
    // `c` is `on delete cascade`.
    expect(byTable).toEqual({
      gallery_item_scope_overrides: 'c',
      gallery_role_scope_overrides: 'c',
      product_attachment_scope_overrides: 'c',
      product_packaging_unit_scope_overrides: 'c',
      product_url_keys: 'c',
      seo_meta_overrides: 'c',
      product_channel_scopes: 'c',
      product_channel_language_scopes: 'c',
    });
  });
});
