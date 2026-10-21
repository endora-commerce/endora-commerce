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
 * exactly the rows the service writes: the header with no Application rule, the
 * audience members, the channel bridge rows and the rows.
 */

/** The platform default currency's base book (the old `Default` list's id). */
export const BASE_BOOK_ID = '00000000-0000-4000-8000-00000000d51b';

const exec = (em: EntityManager, sql: string, params: unknown[] = []) =>
  em.getConnection().execute(sql, params, 'run', em.getTransactionContext());

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
  if (currencyCode === 'PLN') {
    // The PLN base book is the old `Default` list until the conversion, in the
    // shape `DefaultPriceListMigrator.seedDefault` writes, so both engines read it.
    await exec(
      em,
      `insert into "price_lists" ("id", "code", "name", "currency_code", "is_default", "priority", "type", "status",
                                  "application_rule", "audience_kind", "is_system", "modified_at", "created_at", "updated_at")
       values (?, 'default', 'Default', 'PLN', true, 0, 'base', 'active', '{"kind":"all"}'::jsonb, 'everyone', true, now(), now(), now())
       on conflict ("id") do nothing`,
      [BASE_BOOK_ID],
    );
    return BASE_BOOK_ID;
  }
  const id = randomUUID();
  await exec(
    em,
    `insert into "price_lists" ("id", "code", "name", "currency_code", "is_default", "priority", "type", "status",
                                "application_rule", "audience_kind", "is_system", "modified_at", "created_at", "updated_at")
     values (?, ?, ?, ?, false, 0, 'regular', 'active', null, 'everyone', true, now(), now(), now())
     on conflict ("id") do nothing`,
    [id, `base-${currencyCode.toLowerCase()}`, `Base prices ${currencyCode}`, currencyCode],
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
}

/**
 * A product's price as an old `Default`-list bracket (PLN). Until the
 * conversion migration, such a bracket **is** the product's base price on both
 * engines (`BookPricing`'s transition read), and a test that rewrites the
 * product's Default brackets through `PriceListService.replaceBrackets`
 * replaces it — which is why the harness seeds its catalogue this way.
 */
export async function seedDefaultBracketSql(em: EntityManager, productId: string, amount: string | number): Promise<void> {
  await ensureBaseBookSql(em, 'PLN');
  await exec(
    em,
    `insert into "price_list_products" ("price_list_id", "product_id", "created_at") values (?, ?, now()) on conflict do nothing`,
    [BASE_BOOK_ID, productId],
  );
  await exec(
    em,
    `insert into "price_list_price_brackets" ("price_list_id", "product_id", "currency_code", "min_quantity", "max_quantity", "amount", "created_at", "updated_at")
     values (?, ?, 'PLN', 1, null, ?, now(), now())
     on conflict ("price_list_id", "product_id", "currency_code", "min_quantity") do update set "amount" = excluded."amount"`,
    [BASE_BOOK_ID, productId, String(amount)],
  );
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
    `insert into "price_lists" ("id", "code", "name", "currency_code", "is_default", "priority", "type", "status",
                                "application_rule", "audience_kind", "is_system", "modified_at", "created_at", "updated_at")
     values (?, ?, ?, ?, false, 0, ?, ?, null, ?, false, now(), now(), now())`,
    [id, `pb-${id}`, input.name, input.currencyCode ?? 'PLN', input.type ?? 'regular', input.status ?? 'active', kind],
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
  return id;
}
