import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Feature 161 (G15, G18) — large price books for the tests and benches that
 * assert a cost does not grow with the book: products, variants and book rows
 * written in a handful of set-based SQL statements, so a 50 000-line base book
 * is seconds of fixture rather than minutes. Read paths only care that the
 * rows are there; the audited write path is `PriceBookService`, which the
 * tests that exercise it drive through the API.
 */

const run = (em: EntityManager, sql: string, params: unknown[] = []) => em.getConnection().execute(sql, params);

/**
 * `count` simple products named `${namePrefix} 0001` … (zero-padded to the
 * width of `count`; prefixed by a word when `words` is given), SKU
 * `${skuPrefix}-0001` …, in `en-US`. Ids are
 * deterministic per prefix so a caller can rebuild them; answered in name order.
 */
export async function seedBulkProductsSql(
  em: EntityManager,
  input: {
    count: number;
    namePrefix: string;
    skuPrefix: string;
    /** When given, product `i`'s name is `${words[i mod n]} ${namePrefix} ${i}` instead (search fixtures). */
    words?: readonly string[];
  },
): Promise<string[]> {
  const width = Math.max(4, String(input.count).length);
  const words = input.words && input.words.length > 0 ? `{${input.words.map((w) => `"${w}"`).join(',')}}` : null;
  const rows = (await run(
    em,
    `insert into "products" ("id", "sku", "slug", "type", "status", "name", "description", "visibility",
                             "attribute_values", "created_at", "updated_at")
     select gen_random_uuid(),
            ? || '-' || lpad(g::text, ?, '0'),
            lower(? || '-' || lpad(g::text, ?, '0')),
            'simple', 'active',
            jsonb_build_object('en-US',
              coalesce((?::text[])[1 + (g - 1) % greatest(coalesce(array_length(?::text[], 1), 1), 1)] || ' ', '')
              || ? || ' ' || lpad(g::text, ?, '0')),
            '{}'::jsonb, 'public', '{}'::jsonb, now(), now()
       from generate_series(1, ?) g
     returning "id", "sku"`,
    [input.skuPrefix, width, input.skuPrefix, width, words, words, input.namePrefix, width, input.count],
  )) as Array<{ id: string; sku: string }>;
  return rows.sort((a, b) => (a.sku < b.sku ? -1 : 1)).map((r) => r.id);
}

/** One variant per given product (`color` red), SKU `${skuPrefix}-<n>`; answers variant id by product id. */
export async function seedBulkVariantsSql(
  em: EntityManager,
  productIds: readonly string[],
  skuPrefix: string,
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  const rows = (await run(
    em,
    `insert into "product_variants" ("id", "parent_product_id", "sku", "variant_attribute_values", "created_at", "updated_at")
     select gen_random_uuid(), p.id, ? || '-' || p.n, '{"color":"red"}'::jsonb, now(), now()
       from unnest(?::uuid[]) with ordinality as p(id, n)
     returning "id", "parent_product_id"`,
    [skuPrefix, `{${productIds.join(',')}}`],
  )) as Array<{ id: string; parent_product_id: string }>;
  return new Map(rows.map((r) => [r.parent_product_id, r.id]));
}

/**
 * Product rows in `bookId`: product `i` gets `1 + (i mod tiers)` fixed tiers
 * (starts 1, 10, 50, 100, each window ending before the next), amount `10 + i`.
 * `tiers = 1` writes one row per product.
 */
export async function seedProductTiersSql(
  em: EntityManager,
  bookId: string,
  productIds: readonly string[],
  tiers = 1,
): Promise<void> {
  const CHUNK = 10_000;
  for (let offset = 0; offset < productIds.length; offset += CHUNK) {
    const slice = productIds.slice(offset, offset + CHUNK);
    await run(
      em,
      `insert into "price_list_matrix_entries"
         ("id", "price_list_id", "product_id", "min_quantity", "max_quantity", "price_type", "amount", "created_at", "updated_at")
       select gen_random_uuid(), ?::uuid, p.id, t.start, t.stop, 'fixed', (10 + p.n + ?)::numeric, now(), now()
         from unnest(?::uuid[]) with ordinality as p(id, n)
         cross join lateral (
           select s.start, lead(s.start) over (order by s.start) - 1 as stop
             from unnest(array[1, 10, 50, 100]) with ordinality as s(start, k)
            where s.k <= 1 + ((p.n + ?) % ?)
         ) t`,
      [bookId, offset, `{${slice.join(',')}}`, offset, tiers],
    );
  }
  await syncProductLinesSql(em, bookId);
}

/**
 * The book's `price_list_product_lines` brought in line with its rows, as
 * `price_lists`' own writes keep it (161 G15): what a fixture that writes rows
 * past the service must do too.
 */
export async function syncProductLinesSql(em: EntityManager, bookId: string): Promise<void> {
  await run(
    em,
    `insert into "price_list_product_lines" ("price_list_id", "product_id")
     select distinct e."price_list_id", e."product_id" from "price_list_matrix_entries" e
      where e."price_list_id" = ? and e."product_id" is not null
     on conflict do nothing`,
    [bookId],
  );
  await run(
    em,
    `delete from "price_list_product_lines" l
      where l."price_list_id" = ?
        and not exists (select 1 from "price_list_matrix_entries" e where e."price_list_id" = l."price_list_id" and e."product_id" = l."product_id")`,
    [bookId],
  );
}

/** One percentage row per variant (`-5`), under its product, in `bookId`. */
export async function seedVariantRowsSql(em: EntityManager, bookId: string, variantByProduct: ReadonlyMap<string, string>): Promise<void> {
  if (variantByProduct.size === 0) return;
  await run(
    em,
    `insert into "price_list_matrix_entries"
       ("id", "price_list_id", "product_id", "variant_id", "min_quantity", "price_type", "percent", "created_at", "updated_at")
     select gen_random_uuid(), ?::uuid, v.product_id, v.variant_id, 1, 'percent', -5, now(), now()
       from unnest(?::uuid[], ?::uuid[]) as v(product_id, variant_id)`,
    [bookId, `{${[...variantByProduct.keys()].join(',')}}`, `{${[...variantByProduct.values()].join(',')}}`],
  );
  await syncProductLinesSql(em, bookId);
}

/** A non-base, everyone, draft book in PLN with no channel; answers its id. */
export async function seedEmptyBookSql(em: EntityManager, name: string, currencyCode = 'PLN'): Promise<string> {
  const rows = (await run(
    em,
    `insert into "price_lists" ("id", "name", "currency_code", "priority", "type", "status", "audience_kind",
                                "is_system", "ever_activated", "created_at", "updated_at")
     values (gen_random_uuid(), ?, ?, 0, 'regular', 'draft', 'everyone', false, false, now(), now())
     returning "id"`,
    [name, currencyCode],
  )) as Array<{ id: string }>;
  return rows[0]!.id;
}

/** Wrap the connection's `execute`, counting statements and the rows they answered, for `work`. */
export async function measureStatements<T>(
  em: EntityManager,
  work: () => Promise<T>,
): Promise<{ statements: number; rows: number; result: T }> {
  const conn = em.getConnection() as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
  const original = conn.execute.bind(conn);
  let statements = 0;
  let rows = 0;
  conn.execute = async (...args: unknown[]) => {
    statements += 1;
    const answer = await original(...args);
    if (Array.isArray(answer)) rows += answer.length;
    return answer;
  };
  try {
    const result = await work();
    return { statements, rows, result };
  } finally {
    conn.execute = original;
  }
}
