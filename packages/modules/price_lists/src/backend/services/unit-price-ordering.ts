/**
 * The SQL behind {@link ListingPriceOrderPort} (feature 086, research §R4): the
 * resolved unit price as a **merge of index-ordered streams**, one per
 * candidate price list, each stream after the leading one carrying an exclusion
 * and an amount watermark.
 *
 * Everything here is a pure builder, so the three shapes the measurements
 * forced can be asserted by a unit test on the text and demonstrated by an
 * `explain` in the perf bench, instead of being re-derived by the next reader.
 *
 * ## The three shapes, and what each costs when it is written the other way
 *
 * **1. The exclusion is a scalar subquery carrying its own `LIMIT 1` — never
 * `not exists`.** `not exists` is a sublink the planner may pull up into a hash
 * anti-join, which materialises the whole branch before one row can leave it:
 * measured at 208 ms and 150 385 buffers, against **0.69 ms** for the scalar
 * form at the same scale. A scalar subquery with a `LIMIT` cannot be pulled up,
 * so the branch stays a filtered index-only scan in amount order and the merge
 * streams. Same semantics; the difference is structural, not a planner hint.
 *
 * **2. Every stream after the leading one is bounded by the leading stream's
 * amount watermark.** A branch whose every product is priced by a
 * higher-priority branch yields nothing and discovers that by scanning its whole
 * list — 50 000 exclusion probes, 179 ms. That is not an exotic configuration:
 * the ordinary anonymous `[channel list, default list]` vector hits it whenever
 * the channel list prices the assortment, and the "one negotiated list per
 * customer, covering everything" shape hits it hardest. With the bound the same
 * case is **213 probes and 2.88 ms**.
 *
 * The bound is exact rather than approximate, and the argument is one line: the
 * leading stream has no exclusion, so if it returned a full window of `limit`
 * rows all at or below the watermark, then any row above the watermark sorts
 * after all of them and cannot be among the first `limit` rows of the merge.
 * When the leading stream came back short there is no watermark and no bound.
 *
 * **3. Nothing here asks the planner for a plan.** The identical query planned
 * as a streaming merge at 202 000 bracket rows and as bitmap scans plus a sort
 * at 1 687 000, costing 390 ms and 961 ms. The watermark is what makes the
 * streaming plan the planner's own choice again, because `amount <= ?` on the
 * ordering column of a partial covering index is something it can cost. A design
 * that needs `enable_hashjoin = off` to be fast is not a design.
 */

/** One candidate price list, as a stream of the merge. */
export interface UnitPriceStream {
  priceListId: string;
  isSale: boolean;
  /**
   * Product ids this stream is restricted to, or `null` for no restriction.
   *
   * Two things narrow it: the caller's opaque `restrictToProductIds`, and the
   * category memberships a candidate's rule requires. Both are already resolved
   * to ids by the time they reach here — this file knows nothing about
   * categories.
   */
  productIds: readonly string[] | null;
}

export interface UnitPriceQueryInput {
  streams: readonly UnitPriceStream[];
  currencyCode: string;
  direction: 'asc' | 'desc';
  /** Keyset resume point over `(amount, productId)`, or `null` to start. */
  after: { amount: string; productId: string } | null;
  amountRange?: { min?: string; max?: string } | undefined;
  /** How many rows each individual stream may return. */
  perStreamLimit: number;
  /**
   * The leading stream's watermark. Applied to every stream **except** index 0,
   * which is the stream that produced it. `null` means the leading stream came
   * back short, so there is nothing to bound against.
   */
  watermark: string | null;
  /**
   * Emit no branch for the first `skipStreams` streams, while still excluding
   * against them.
   *
   * The caller already has the leading stream's rows — the probe that fixed the
   * watermark returned them — so re-reading them would be a second scan of the
   * one stream the design most wants read once.
   */
  skipStreams?: number | undefined;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/** A Postgres array literal — `= any('{a,b}'::uuid[])` rather than an `in (?,…)`. */
export function uuidArrayLiteral(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}

/**
 * The merge over `input.streams`, as one statement.
 *
 * Stream `i` excludes every product priced by streams `0..i-1`, which is FR-031's
 * fall-through: the first candidate in priority order that prices a product is
 * the one that answers for it.
 */
export function buildUnitPriceMergeQuery(input: UnitPriceQueryInput): BuiltQuery {
  const params: unknown[] = [];
  const skip = input.skipStreams ?? 0;
  const branches = input.streams
    .map((stream, index) => ({ stream, index }))
    .filter(({ index }) => index >= skip)
    .map(({ stream, index }) => buildStreamSelect(input, stream, index, params));
  const dir = input.direction === 'asc' ? 'asc' : 'desc';
  const sql =
    `select t."product_id"::text as product_id, t."amount"::text as amount, t."stream_index"\n` +
    `  from (\n${branches.join('\n    union all\n')}\n  ) t\n` +
    ` order by t."amount" ${dir}, t."product_id" ${dir}`;
  return { sql, params };
}

function buildStreamSelect(
  input: UnitPriceQueryInput,
  stream: UnitPriceStream,
  index: number,
  params: unknown[],
): string {
  const dir = input.direction === 'asc' ? 'asc' : 'desc';
  const clauses: string[] = [
    `b."price_list_id" = ?`,
    `b."currency_code" = ?`,
    // The quantity-1 equality, not a `distinct on` and not a window function:
    // `check (min_quantity >= 1)` makes `min_quantity <= 1` mean exactly this,
    // which is what a partial index can be built on.
    `b."min_quantity" = 1`,
  ];
  params.push(stream.priceListId, input.currencyCode);

  if (stream.productIds !== null) {
    clauses.push(`b."product_id" = any(?::uuid[])`);
    params.push(uuidArrayLiteral(stream.productIds));
  }

  if (input.after) {
    clauses.push(
      `(b."amount", b."product_id") ${input.direction === 'asc' ? '>' : '<'} (?::numeric, ?::uuid)`,
    );
    params.push(input.after.amount, input.after.productId);
  }

  if (input.amountRange?.min !== undefined) {
    clauses.push(`b."amount" >= ?::numeric`);
    params.push(input.amountRange.min);
  }
  if (input.amountRange?.max !== undefined) {
    clauses.push(`b."amount" <= ?::numeric`);
    params.push(input.amountRange.max);
  }

  // Shape 2 — the watermark. Never on the stream that produced it.
  if (index > 0 && input.watermark !== null) {
    clauses.push(`b."amount" ${input.direction === 'asc' ? '<=' : '>='} ?::numeric`);
    params.push(input.watermark);
  }

  // Shape 1 — one scalar subquery per higher-priority stream, each with its own
  // `limit 1`. Written as `not exists` this is the 208 ms row of the table in
  // the header.
  for (let j = 0; j < index; j += 1) {
    const earlier = input.streams[j]!;
    const alias = `x${j}`;
    const earlierClauses = [
      `${alias}."price_list_id" = ?`,
      `${alias}."currency_code" = ?`,
      `${alias}."min_quantity" = 1`,
      `${alias}."product_id" = b."product_id"`,
    ];
    params.push(earlier.priceListId, input.currencyCode);
    if (earlier.productIds !== null) {
      earlierClauses.push(`${alias}."product_id" = any(?::uuid[])`);
      params.push(uuidArrayLiteral(earlier.productIds));
    }
    clauses.push(
      `(select 1 from "price_list_price_brackets" ${alias}\n` +
        `        where ${earlierClauses.join('\n          and ')}\n` +
        `        limit 1) is null`,
    );
  }

  params.push(input.perStreamLimit);
  return (
    `    (select b."product_id", b."amount", ${index} as stream_index\n` +
    `       from "price_list_price_brackets" b\n` +
    `      where ${clauses.join('\n        and ')}\n` +
    `      order by b."amount" ${dir}, b."product_id" ${dir}\n` +
    `      limit ?)`
  );
}

/**
 * Compares two `numeric(14,4)` amounts **as decimals**, without going through a
 * float.
 *
 * The merge is finished in memory — the leading stream's window is already in
 * hand from the watermark probe — so the two halves have to be ordered by the
 * same relation Postgres used. `Number()` is not it: `numeric(14,4)` carries
 * eighteen significant digits and a double carries fifteen, so two amounts a
 * shop can actually charge can compare equal after the conversion.
 */
export function compareDecimalStrings(a: string, b: string): number {
  const [aInt = '0', aFrac = ''] = a.split('.');
  const [bInt = '0', bFrac = ''] = b.split('.');
  const aNeg = aInt.startsWith('-');
  const bNeg = bInt.startsWith('-');
  if (aNeg !== bNeg) return aNeg ? -1 : 1;
  const sign = aNeg ? -1 : 1;
  const ai = aInt.replace('-', '').replace(/^0+(?=\d)/, '');
  const bi = bInt.replace('-', '').replace(/^0+(?=\d)/, '');
  if (ai.length !== bi.length) return sign * (ai.length < bi.length ? -1 : 1);
  if (ai !== bi) return sign * (ai < bi ? -1 : 1);
  const width = Math.max(aFrac.length, bFrac.length);
  const af = aFrac.padEnd(width, '0');
  const bf = bFrac.padEnd(width, '0');
  if (af === bf) return 0;
  return sign * (af < bf ? -1 : 1);
}

/** The merge's total order: amount, then product id, in the requested direction. */
export function compareOrderRows(
  a: { amount: string; productId: string },
  b: { amount: string; productId: string },
  direction: 'asc' | 'desc',
): number {
  const byAmount = compareDecimalStrings(a.amount, b.amount);
  const raw = byAmount !== 0 ? byAmount : a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;
  return direction === 'asc' ? raw : -raw;
}
