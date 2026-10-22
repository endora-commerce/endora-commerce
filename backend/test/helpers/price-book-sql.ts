import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Feature 160 — price books seeded for a fixture, in SQL on the caller's
 * `EntityManager` (so a fixture inside an open test transaction sees its own
 * rows).
 *
 * The audited write path is `PriceBookService` (`pricing-fixture.ts` goes
 * through it); these helpers exist for the many consumer fixtures that need *a*
 * price and no write semantics — a test of a cart, a listing or a feed — and
 * that seeded the old model's Default brackets or rule lists before. They write
 * exactly the rows the service writes: the header, the audience members, the
 * channel bridge rows, the rows and the book's product lines (161 G15).
 */

/** The platform default currency's base book (the old `Default` list's id). */
export const BASE_BOOK_ID = '00000000-0000-4000-8000-00000000d51b';

const exec = (em: EntityManager, sql: string, params: unknown[] = []) =>
  em.getConnection().execute(sql, params, 'run', em.getTransactionContext());

/**
 * `price_list_product_lines` (161 G15) for the products named, as the service
 * keeps it: a product line exists exactly while the book holds a row of it.
 */
async function syncLinesSql(em: EntityManager, productIds: readonly string[], bookId?: string): Promise<void> {
  const ids = `{${productIds.join(',')}}`;
  await exec(
    em,
    `insert into "price_list_product_lines" ("price_list_id", "product_id")
     select distinct e."price_list_id", e."product_id" from "price_list_matrix_entries" e
      where e."product_id" = any(?::uuid[]) ${bookId ? 'and e."price_list_id" = ?' : ''}
     on conflict do nothing`,
    bookId ? [ids, bookId] : [ids],
  );
  await exec(
    em,
    `delete from "price_list_product_lines" l
      where l."product_id" = any(?::uuid[]) ${bookId ? 'and l."price_list_id" = ?' : ''}
        and not exists (select 1 from "price_list_matrix_entries" e where e."price_list_id" = l."price_list_id" and e."product_id" = l."product_id")`,
    bookId ? [ids, bookId] : [ids],
  );
}

/** The base book of a currency, created when missing; answers its id. */
export async function ensureBaseBookSql(em: EntityManager, currencyCode = 'PLN'): Promise<string> {
  const rows = (await em
    .getConnection()
    .execute<Array<{ id: string }>>(
      `select "id" from "price_lists" where "is_system" = true and "currency_code" = ?`,
      [currencyCode],
      'all',
      em.getTransactionContext(),
    )) as Array<{ id: string }>;
  if (rows[0]) return rows[0].id;
  // The PLN base book keeps the old `Default` list's id, as on a real install.
  const id = currencyCode === 'PLN' ? BASE_BOOK_ID : randomUUID();
  await exec(
    em,
    `insert into "price_lists" ("id", "name", "currency_code", "priority", "type", "status",
                                "audience_kind", "is_system", "ever_activated", "created_at", "updated_at")
     values (?, ?, ?, 0, 'regular', 'active', 'everyone', true, true, now(), now())
     on conflict ("id") do nothing`,
    [id, `Base prices (${currencyCode})`, currencyCode],
  );
  return id;
}

/** A product's base price (one tier from 1 up), replacing what it had in that currency. */
export async function seedBasePriceSql(
  em: EntityManager,
  productId: string,
  amount: string | number,
  currencyCode = 'PLN',
): Promise<void> {
  const bookId = await ensureBaseBookSql(em, currencyCode);
  await exec(em, `delete from "price_list_matrix_entries" where "price_list_id" = ? and "product_id" = ? and "variant_id" is null`, [
    bookId,
    productId,
  ]);
  await exec(
    em,
    `insert into "price_list_matrix_entries" ("id", "price_list_id", "product_id", "min_quantity", "price_type", "amount", "created_at", "updated_at")
     values (?, ?, ?, 1, 'fixed', ?, now(), now())`,
    [randomUUID(), bookId, productId, String(amount)],
  );
  await syncLinesSql(em, [productId], bookId);
}

export interface SqlBookRow {
  productId?: string;
  variantId?: string;
  categoryId?: string;
  minQuantity?: number;
  fixed?: string | number;
  percent?: string | number;
}

/** A price book bound to channels (all channels by default), active unless told otherwise. */
export async function seedPriceBookSql(
  em: EntityManager,
  input: {
    /** A fixed id, for a fixture that names its books. */
    id?: string;
    name: string;
    type?: 'regular' | 'sale';
    currencyCode?: string;
    audience: 'everyone' | { organizations: readonly string[] } | { groups: readonly string[] };
    channelIds?: readonly string[];
    rows: readonly SqlBookRow[];
    status?: 'draft' | 'active';
  },
): Promise<string> {
  const id = input.id ?? randomUUID();
  const kind =
    input.audience === 'everyone' ? 'everyone' : 'organizations' in input.audience ? 'organizations' : 'customer_groups';
  await exec(
    em,
    `insert into "price_lists" ("id", "name", "currency_code", "priority", "type", "status",
                                "audience_kind", "is_system", "ever_activated", "created_at", "updated_at")
     values (?, ?, ?, 0, ?, ?, ?, false, ?, now(), now())`,
    [id, input.name, input.currencyCode ?? 'PLN', input.type ?? 'regular', input.status ?? 'active', kind, (input.status ?? 'active') === 'active'],
  );
  if (input.audience !== 'everyone') {
    const isOrg = 'organizations' in input.audience;
    const members = isOrg
      ? (input.audience as { organizations: readonly string[] }).organizations
      : (input.audience as { groups: readonly string[] }).groups;
    for (const member of members) {
      await exec(
        em,
        `insert into "price_list_audience_members" ("id", "price_list_id", "${isOrg ? 'organization_id' : 'customer_group_id'}") values (?, ?, ?)`,
        [randomUUID(), id, member],
      );
    }
  }
  const channelIds =
    input.channelIds ??
    (
      (await em
        .getConnection()
        .execute<Array<{ id: string }>>(`select "id" from "sales_channels"`, [], 'all', em.getTransactionContext())) as Array<{
        id: string;
      }>
    ).map((c) => c.id);
  for (const channelId of channelIds) {
    await exec(em, `insert into "sales_channel_price_lists" ("sales_channel_id", "price_list_id") values (?, ?)`, [channelId, id]);
  }
  for (const row of input.rows) {
    const fixed = row.fixed !== undefined;
    await exec(
      em,
      `insert into "price_list_matrix_entries"
         ("id", "price_list_id", "product_id", "variant_id", "category_id", "min_quantity", "price_type", "amount", "percent", "created_at", "updated_at")
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
      [
        randomUUID(),
        id,
        row.productId ?? null,
        row.variantId ?? null,
        row.categoryId ?? null,
        row.minQuantity ?? 1,
        fixed ? 'fixed' : 'percent',
        fixed ? String(row.fixed) : null,
        fixed ? null : String(row.percent),
      ],
    );
  }
  const productIds = [...new Set(input.rows.map((r) => r.productId).filter((p): p is string => !!p))];
  if (productIds.length > 0) await syncLinesSql(em, productIds, id);
  return id;
}

/** A product's base prices, in every currency (its own rows and its variants'), removed. */
export async function removeBasePriceSql(em: EntityManager, productId: string): Promise<void> {
  await exec(
    em,
    `delete from "price_list_matrix_entries"
      where "product_id" = ? and "price_list_id" in (select "id" from "price_lists" where "is_system" = true)`,
    [productId],
  );
  await syncLinesSql(em, [productId]);
}

/** Whether a product has a base price of its own (a product row of a base book, any currency). */
export async function hasBasePriceSql(em: EntityManager, productId: string): Promise<boolean> {
  const rows = (await em
    .getConnection()
    .execute(
      `select 1 from "price_list_matrix_entries" e join "price_lists" b on b."id" = e."price_list_id" and b."is_system"
        where e."product_id" = ? and e."variant_id" is null limit 1`,
      [productId],
      'all',
      em.getTransactionContext(),
    )) as unknown[];
  return rows.length > 0;
}

/** A product's base price in quantity tiers, replacing what it had in that currency. */
export async function seedBaseTiersSql(
  em: EntityManager,
  productId: string,
  tiers: ReadonlyArray<{ minQuantity: number; maxQuantity: number | null; amount: string | number }>,
  currencyCode = 'PLN',
): Promise<void> {
  const bookId = await ensureBaseBookSql(em, currencyCode);
  await exec(em, `delete from "price_list_matrix_entries" where "price_list_id" = ? and "product_id" = ? and "variant_id" is null`, [
    bookId,
    productId,
  ]);
  for (const tier of tiers) {
    await exec(
      em,
      `insert into "price_list_matrix_entries"
         ("id", "price_list_id", "product_id", "min_quantity", "max_quantity", "price_type", "amount", "created_at", "updated_at")
       values (?, ?, ?, ?, ?, 'fixed', ?, now(), now())`,
      [randomUUID(), bookId, productId, tier.minQuantity, tier.maxQuantity, String(tier.amount)],
    );
  }
  await syncLinesSql(em, [productId], bookId);
}
