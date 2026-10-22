import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  ListingPriceOrderChunk,
  ListingPriceOrderQuery,
  ListingPriceOrderRow,
} from '@endora-commerce/contracts';
import type { BookPricing, BookPricingViewer, ListingAnswer } from './book-pricing.js';
import { compareDecimal } from './matrix-decimal.js';
import type { PricedProductRef } from './pricing-service.interface.js';
import type { PricingProfile } from './pricing-profile.js';

/**
 * The price surface — feature 160, research R7, `contracts/price-surface.md`.
 *
 * Price sort and the price-range filter read prices precomputed per **pricing
 * profile** (`price_profiles` / `price_profile_prices`): the everyone profile
 * of a channel and currency holds every product it prices; a buyer profile
 * holds only the products whose quantity-1 answer differs from the everyone
 * profile's. A buyer's page is a **two-stream merge** — the buyer profile's
 * rows, then the everyone profile's rows excluding the products the first
 * stream holds (a scalar probe per row) below the first stream's watermark —
 * so the sort costs two index-ordered streams whatever the number of books.
 *
 * Every row is computed by the batched resolver (`BookPricing.resolveListing`),
 * the same call the cards are priced with, so the surface and the cards agree
 * by construction; `price-surface-identity.test.ts` holds it.
 *
 * **Freshness — a request never waits on a build** (`contracts/price-surface.md`
 * §3). A pricing write marks every profile **stale** after its commit and asks
 * the `price_lists.surface` worker to rebuild; a stale profile keeps serving the
 * surface it had until the worker swaps the rebuilt one in (a build writes the
 * next generation of rows beside the served one and switches
 * `serving_generation` in the same transaction). Only the **order** may lag a
 * change — by the worker's turnaround, within SC-005's 60 s — never a displayed
 * price: cards are always resolved live. A profile **never built** is
 * registered and its build asked for, and the request is answered at once: a
 * restriction to a bounded set (a category, a search result) is ordered from a
 * live resolution of that set; an unrestricted buyer request is ordered from
 * the everyone surface of its channel and currency, an approximation until its
 * own surface exists; and with no everyone surface either the answer is
 * `unordered`, which the catalogue serves in its default order, cards priced
 * live. Live paths (cart, checkout, product page, quotes, order intake) never
 * read the surface (FR-027).
 */

/** Product rows resolved per statement batch when building a profile. */
const BUILD_CHUNK = 500;
/** A stale profile restricted to at most this many products is ordered live. */
const LIVE_ORDER_LIMIT = 5_000;

/** Pairs of builds whose coverage answer this process keeps. */
const COVERAGE_MEMO_LIMIT = 10_000;

/** Rebuild passes per worker job: a write that marks a profile during a pass is picked up by the next. */
const REBUILD_PASSES = 10;

/** A served surface: the profile id and the generation readers see (which keys every memo of it). */
interface ReadySurface {
  id: string;
  generation: number;
}

/** What the read path finds for a profile: a served surface, a live ordering, or nothing yet. */
type SurfaceAnswer = ReadySurface | 'live' | 'missing';

export interface PriceSurfaceDeps {
  emFactory: () => EntityManager;
  books: BookPricing;
  /** Every product the surface prices (through `catalog`'s product read port). */
  listProducts: () => Promise<PricedProductRef[]>;
  /** The given products, through the same port. */
  productsByIds: (ids: readonly string[]) => Promise<PricedProductRef[]>;
  /** Ask the worker to rebuild the stale profiles; best effort. */
  requestRebuild?: () => Promise<void>;
}

interface SurfaceRow {
  productId: string;
  amount: string;
  maxAmount: string;
  compareAt: string | null;
  sourceTier: 'base' | 'catalogue' | 'buyer' | 'sale';
}

const uuidArray = (ids: readonly string[]): string => `{${ids.join(',')}}`;

function rowOf(productId: string, listed: ListingAnswer | undefined): SurfaceRow | null {
  const price = listed?.answer?.resolution.price;
  if (!listed || !price) return null;
  return {
    productId,
    amount: price.amount,
    maxAmount: listed.maxAmount ?? price.amount,
    compareAt: price.source === 'sale' ? price.compareAt : null,
    sourceTier: price.source,
  };
}

function sameRow(a: SurfaceRow, b: SurfaceRow): boolean {
  return (
    compareDecimal(a.amount, b.amount) === 0 &&
    compareDecimal(a.maxAmount, b.maxAmount) === 0 &&
    (a.compareAt ?? '') === (b.compareAt ?? '') &&
    a.sourceTier === b.sourceTier
  );
}

const builderViewer = (profile: PricingProfile): BookPricingViewer => ({
  organizationId: null,
  customerGroupId: null,
  signedIn: false,
  salesChannelId: profile.channelId,
  currencyCode: profile.currencyCode,
});

export class PriceSurface {
  readonly #coverage = new Map<string, boolean>();

  constructor(private readonly deps: PriceSurfaceDeps) {}

  /** After a committed pricing write: every profile is stale — still served — until rebuilt. */
  async markStale(): Promise<void> {
    await this.deps
      .emFactory()
      .execute(`update "price_profiles" set "stale" = true, "marked_at" = clock_timestamp()`);
    await this.deps.requestRebuild?.().catch(() => undefined);
  }

  /**
   * The worker's job: build every never-built profile, then rebuild every stale
   * one, from its stored vector — never-built first (a request is waiting on an
   * approximation for those), the everyone profiles before the buyer profiles
   * that compare against them. Repeats while a pass leaves work, so a write that
   * marks a profile during a pass is not lost to the coalesced job id. Answers
   * how many builds ran.
   */
  async rebuildStale(): Promise<number> {
    let rebuilt = 0;
    for (let pass = 0; pass < REBUILD_PASSES; pass += 1) {
      const due = await this.deps.emFactory().execute<
        Array<{
          sales_channel_id: string;
          currency_code: string;
          precedence_version: number;
          book_vector: PricingProfile['vector'];
        }>
      >(
        `select "sales_channel_id", "currency_code", "precedence_version", "book_vector"
           from "price_profiles" where "state" = 'building' or "stale"
          order by ("state" = 'building') desc, jsonb_array_length("book_vector") asc`,
      );
      if (due.length === 0) break;
      for (const row of due) {
        const profile = await this.deps.books.profileFromVector({
          channelId: row.sales_channel_id,
          currencyCode: row.currency_code.trim(),
          precedenceVersion: Number(row.precedence_version),
          vector: row.book_vector,
        });
        await this.#build(profile, row.book_vector.length === 0 ? null : await this.#everyoneOf(profile));
        rebuilt += 1;
      }
    }
    return rebuilt;
  }

  /** {@link ListingPriceOrderPort.orderByUnitPrice} for one viewer. */
  async orderByUnitPrice(query: ListingPriceOrderQuery, viewer: BookPricingViewer): Promise<ListingPriceOrderChunk> {
    const empty: ListingPriceOrderChunk = { rows: [], exhausted: true, sourceRowsRead: 0 };
    if (query.limit <= 0) return { rows: [], exhausted: false, sourceRowsRead: 0 };
    if (query.restrictToProductIds !== undefined && query.restrictToProductIds.length === 0) return empty;
    const profiles = await this.deps.books.profilesFor(viewer);
    if (!profiles) return empty;
    const { buyer, everyone } = profiles;
    const currency = buyer.currencyCode;

    const everyoneReady = await this.#served(everyone, query);
    const buyerReady = buyer === everyone ? null : await this.#served(buyer, query);
    if (everyoneReady === 'live' || buyerReady === 'live') return this.#orderLive(query, viewer, currency);
    // Nothing built for the channel and currency yet: no order to give. The
    // catalogue serves its default order, cards priced live, while the worker builds.
    if (everyoneReady === 'missing') return { rows: [], exhausted: false, sourceRowsRead: 0, unordered: true };
    // The buyer's own surface is not built yet: the everyone order stands in.
    const buyerServed = buyerReady === 'missing' ? null : buyerReady;
    // A buyer surface that holds every product the everyone surface holds leaves
    // the everyone stream nothing to contribute — and an anti-join that can only
    // exclude would scan the everyone surface to find that out (an organization
    // with an all-products percentage, sorted against its discount).
    const covered = buyerServed !== null && (await this.#buyerCoversEveryone(buyerServed, everyoneReady));
    return this.#twoStreams(query, everyoneReady, buyerServed, currency, covered);
  }

  /** {@link ListingPriceOrderPort.pricedProductIds}: membership, from a live resolution of the set. */
  async pricedProductIds(productIds: readonly string[], viewer: BookPricingViewer): Promise<ReadonlySet<string>> {
    const out = new Set<string>();
    if (productIds.length === 0) return out;
    const products = await this.deps.productsByIds([...new Set(productIds)]);
    const listed = await this.deps.books.resolveListing(products, viewer);
    for (const [productId, answer] of listed) if (answer.answer?.resolution.price) out.add(productId);
    return out;
  }

  // ---- Internals --------------------------------------------------------------

  /**
   * The surface served for the profile — stale or not, a served surface is
   * served — or, for a profile never built, `'live'` when the request is
   * restricted to a bounded set and `'missing'` otherwise. A never-built profile
   * is registered and its build asked for; the request never builds.
   */
  async #served(profile: PricingProfile, query: ListingPriceOrderQuery): Promise<SurfaceAnswer> {
    const held = await this.#profileRow(profile);
    if (held && held.state === 'ready') return { id: held.id, generation: held.generation };
    await this.#ensureRow(profile);
    await this.deps.requestRebuild?.().catch(() => undefined);
    if (query.restrictToProductIds !== undefined && query.restrictToProductIds.length <= LIVE_ORDER_LIMIT) return 'live';
    return 'missing';
  }

  async #profileRow(profile: PricingProfile): Promise<{ id: string; state: string; generation: number } | null> {
    const [row] = await this.deps.emFactory().execute<Array<{ id: string; state: string; serving_generation: number }>>(
      `select "id", "state", "serving_generation" from "price_profiles"
        where "sales_channel_id" = ? and "currency_code" = ? and "precedence_version" = ? and "key_hash" = ?`,
      [profile.channelId, profile.currencyCode, profile.precedenceVersion, profile.key],
    );
    if (!row) return null;
    return { id: row.id, state: row.state, generation: Number(row.serving_generation) };
  }

  /**
   * Whether every product of the everyone surface has a row on the buyer's —
   * answered once per pair of builds and memoised in this process (a rebuild
   * moves the generation, so a stale answer is never read; the page statement checks the pair).
   */
  async #buyerCoversEveryone(buyer: ReadySurface, everyone: ReadySurface): Promise<boolean> {
    const key = `${buyer.id}@${buyer.generation}|${everyone.id}@${everyone.generation}`;
    const held = this.#coverage.get(key);
    if (held !== undefined) return held;
    const [row] = await this.deps.emFactory().execute<Array<{ uncovered: boolean }>>(
      `select exists (
         select 1 from "price_profile_prices" e
          where e."profile_id" = ? and e."generation" = ?
            and not exists (select 1 from "price_profile_prices" b
                             where b."profile_id" = ? and b."generation" = ? and b."product_id" = e."product_id")
       ) as "uncovered"`,
      [everyone.id, everyone.generation, buyer.id, buyer.generation],
    );
    const covered = row ? !row.uncovered : false;
    if (this.#coverage.size >= COVERAGE_MEMO_LIMIT) this.#coverage.clear();
    this.#coverage.set(key, covered);
    return covered;
  }

  async #ensureRow(profile: PricingProfile): Promise<string> {
    await this.deps.emFactory().execute(
      `insert into "price_profiles"
         ("id", "sales_channel_id", "currency_code", "precedence_version", "key_hash", "book_vector", "state")
       values (?, ?, ?, ?, ?, ?::jsonb, 'building')
       on conflict ("sales_channel_id", "currency_code", "precedence_version", "key_hash") do nothing`,
      [randomUUID(), profile.channelId, profile.currencyCode, profile.precedenceVersion, profile.key, JSON.stringify(profile.vector)],
    );
    return (await this.#profileRow(profile))!.id;
  }

  async #everyoneOf(profile: PricingProfile): Promise<PricingProfile> {
    return this.deps.books.profileFromVector({
      channelId: profile.channelId,
      currencyCode: profile.currencyCode,
      precedenceVersion: profile.precedenceVersion,
      vector: [],
    });
  }

  /**
   * Build a profile's next generation in one transaction, serialised per profile
   * by an advisory lock, and swap it in: the everyone profile with every priced
   * product, a buyer profile with the products whose answer differs from the
   * everyone profile's served rows (built first when it has none). Readers keep
   * the served generation until the commit; the old rows go in the same
   * transaction. `stale` is cleared only when no write marked the profile after
   * the build began. Called by the worker, never by a request. Answers the id.
   */
  async #build(profile: PricingProfile, everyone: PricingProfile | null): Promise<string> {
    let everyoneServed: ReadySurface | null = null;
    if (everyone) {
      const held = await this.#profileRow(everyone);
      if (held && held.state === 'ready') everyoneServed = { id: held.id, generation: held.generation };
      else {
        const id = await this.#build(everyone, null);
        const built = await this.#profileRowById(id);
        everyoneServed = { id, generation: built.generation };
      }
    }
    const id = await this.#ensureRow(profile);
    const products = await this.deps.listProducts();
    await this.deps.emFactory().transactional(async (em) => {
      await em.execute(`select pg_advisory_xact_lock(hashtext(?))`, [`price_lists.surface:${id}`]);
      const [current] = await em.execute<Array<{ state: string; stale: boolean; serving_generation: number; started: Date }>>(
        `select "state", "stale", "serving_generation", clock_timestamp() as "started" from "price_profiles" where "id" = ?`,
        [id],
      );
      // Another worker built it while this one waited for the lock.
      if (current?.state === 'ready' && !current.stale) return;
      const next = Number(current?.serving_generation ?? 0) + 1;
      await em.execute(`delete from "price_profile_prices" where "profile_id" = ? and "generation" = ?`, [id, next]);
      for (let start = 0; start < products.length; start += BUILD_CHUNK) {
        const chunk = products.slice(start, start + BUILD_CHUNK);
        const listed = await this.deps.books.resolveListing(chunk, builderViewer(profile), profile);
        let rows = chunk.map((p) => rowOf(p.id, listed.get(p.id))).filter((r): r is SurfaceRow => r !== null);
        if (everyoneServed) {
          const base = new Map(
            (
              await em.execute<Array<{ product_id: string; amount: string; max_amount: string; compare_at: string | null; source_tier: SurfaceRow['sourceTier'] }>>(
                `select "product_id", "amount", "max_amount", "compare_at", "source_tier"
                   from "price_profile_prices"
                  where "profile_id" = ? and "generation" = ? and "product_id" = any(?::uuid[])`,
                [everyoneServed.id, everyoneServed.generation, uuidArray(chunk.map((p) => p.id))],
              )
            ).map((r) => [
              r.product_id,
              {
                productId: r.product_id,
                amount: String(r.amount),
                maxAmount: String(r.max_amount),
                compareAt: r.compare_at === null ? null : String(r.compare_at),
                sourceTier: r.source_tier,
              } satisfies SurfaceRow,
            ]),
          );
          // Sparse: only what differs from everyone's — but a product everyone
          // can buy and this profile cannot is not representable as a row, and
          // cannot happen (a buyer row always has the catalogue price to fall back to).
          rows = rows.filter((r) => {
            const held = base.get(r.productId);
            return !held || !sameRow(held, r);
          });
        }
        if (rows.length === 0) continue;
        await em.execute(
          `insert into "price_profile_prices" ("profile_id", "generation", "product_id", "amount", "max_amount", "compare_at", "source_tier")
           select ?, ?, * from unnest(?::uuid[], ?::numeric[], ?::numeric[], ?::numeric[], ?::varchar[])`,
          [
            id,
            next,
            uuidArray(rows.map((r) => r.productId)),
            `{${rows.map((r) => r.amount).join(',')}}`,
            `{${rows.map((r) => r.maxAmount).join(',')}}`,
            `{${rows.map((r) => (r.compareAt === null ? 'NULL' : r.compareAt)).join(',')}}`,
            `{${rows.map((r) => r.sourceTier).join(',')}}`,
          ],
        );
      }
      // The swap: readers move to the new generation at commit.
      await em.execute(
        `update "price_profiles"
            set "state" = 'ready', "serving_generation" = ?, "built_at" = now(),
                "stale" = ("marked_at" is not null and "marked_at" > ?)
          where "id" = ?`,
        [next, current?.started ?? new Date(0), id],
      );
      await em.execute(`delete from "price_profile_prices" where "profile_id" = ? and "generation" <> ?`, [id, next]);
    });
    return id;
  }

  async #profileRowById(id: string): Promise<{ generation: number }> {
    const [row] = await this.deps.emFactory().execute<Array<{ serving_generation: number }>>(
      `select "serving_generation" from "price_profiles" where "id" = ?`,
      [id],
    );
    return { generation: Number(row?.serving_generation ?? 0) };
  }

  /**
   * The two-stream merge over served surfaces (`contracts/price-surface.md` §2).
   *
   * Every read of surface rows names its generation by a sub-select in the same
   * statement, and the buyer stream, its watermark and the everyone stream are
   * one statement: one snapshot, so a swap committing under the request — which
   * drops the generation it replaces — leaves the request one whole build or the
   * other, never an empty or a mixed page (§3).
   */
  async #twoStreams(
    query: ListingPriceOrderQuery,
    everyone: ReadySurface,
    buyer: ReadySurface | null,
    currency: string,
    /** The buyer surface holds every everyone product: the everyone stream is skipped. */
    buyerCoversEveryone = false,
  ): Promise<ListingPriceOrderChunk> {
    const em = this.deps.emFactory();
    const desc = query.direction === 'desc';
    const dir = desc ? 'desc' : 'asc';
    const filters = (alias: string, params: unknown[]): string => {
      const out: string[] = [];
      if (query.after) {
        out.push(`(${alias}."amount", ${alias}."product_id") ${desc ? '<' : '>'} (?::numeric, ?::uuid)`);
        params.push(query.after.amount, query.after.productId);
      }
      if (query.amountRange?.min !== undefined) {
        out.push(`${alias}."amount" >= ?::numeric`);
        params.push(query.amountRange.min);
      }
      if (query.amountRange?.max !== undefined) {
        out.push(`${alias}."amount" <= ?::numeric`);
        params.push(query.amountRange.max);
      }
      if (query.restrictToProductIds !== undefined) {
        out.push(`${alias}."product_id" = any(?::uuid[])`);
        params.push(uuidArray(query.restrictToProductIds));
      }
      return out.map((c) => ` and ${c}`).join('');
    };
    const served = `(select "serving_generation" from "price_profiles" where "id" = ?)`;
    const everyoneId = everyone.id;
    const buyerId = buyer?.id ?? null;
    type Hit = { s: 'b' | 'e' | 'x'; product_id: string; amount: string; source_tier: string };

    const params: unknown[] = [];
    let sql = '';
    if (buyer) {
      params.push(buyer.id, buyer.id);
      const where = filters('b', params);
      params.push(query.limit);
      sql = `with "lead" as materialized (
               select b."product_id", b."amount", b."source_tier" from "price_profile_prices" b
                where b."profile_id" = ? and b."generation" = ${served}${where}
                order by b."amount" ${dir}, b."product_id" ${dir} limit ?
             )
             select 'b' as "s", "product_id", "amount", "source_tier" from "lead"`;
    }
    if (buyer && buyerCoversEveryone) {
      // The everyone stream has nothing to add — for the pair of builds the
      // coverage was answered for, which this statement checks in its own
      // snapshot. After a swap it answers `x`, and the page is read again with
      // both streams.
      const sameBuilds = `${served} = ? and ${served} = ?`;
      sql += ` where ${sameBuilds} union all select 'x', null, null, null where not (${sameBuilds})`;
      params.push(buyer.id, buyer.generation, everyone.id, everyone.generation);
      params.push(buyer.id, buyer.generation, everyone.id, everyone.generation);
    } else {
      params.push(everyone.id, everyone.id);
      let where = filters('e', params);
      if (buyer) {
        // The watermark: once the buyer stream filled its window, nothing of the
        // everyone stream beyond its last amount can reach the page.
        where += ` and e."amount" ${desc ? '>=' : '<='} coalesce(
                     (select case when count(*) >= ? then ${desc ? 'min' : 'max'}("amount") end from "lead"),
                     '${desc ? '-' : ''}Infinity'::numeric)`;
        params.push(query.limit);
        where += ` and (select 1 from "price_profile_prices" x
                         where x."profile_id" = ? and x."generation" = ${served}
                           and x."product_id" = e."product_id" limit 1) is null`;
        params.push(buyer.id, buyer.id);
      }
      params.push(query.limit);
      const rest = `(select 'e' as "s", e."product_id", e."amount", e."source_tier" from "price_profile_prices" e
                      where e."profile_id" = ? and e."generation" = ${served}${where}
                      order by e."amount" ${dir}, e."product_id" ${dir} limit ?)`;
      sql = buyer ? `${sql} union all ${rest}` : rest;
    }
    const hits = await em.execute<Hit[]>(sql, params);
    if (hits.some((hit) => hit.s === 'x')) return this.#twoStreams(query, everyone, buyer, currency, false);

    const lead = hits.filter((hit) => hit.s === 'b');
    const rest = hits.filter((hit) => hit.s === 'e');
    const watermark = buyerId !== null && lead.length >= query.limit;
    const merged = [...lead.map((h) => ({ h, profile: buyerId! })), ...rest.map((h) => ({ h, profile: everyoneId }))].sort(
      (a, b) => {
        const byAmount = compareDecimal(String(a.h.amount), String(b.h.amount));
        const byId = a.h.product_id < b.h.product_id ? -1 : a.h.product_id > b.h.product_id ? 1 : 0;
        return desc ? -(byAmount || byId) : byAmount || byId;
      },
    );
    const page = merged.slice(0, query.limit);
    const rows: ListingPriceOrderRow[] = page.map(({ h, profile }) => ({
      productId: h.product_id,
      amount: String(h.amount),
      currency,
      // The surface keeps no book per row; the profile that answered stands in.
      priceListId: profile,
      isSale: h.source_tier === 'sale',
    }));
    const exhausted = !watermark && lead.length < query.limit && rest.length < query.limit && merged.length <= query.limit;
    return { rows, exhausted, sourceRowsRead: lead.length + rest.length };
  }

  /** The profile-miss path: a bounded restricted set, ordered from a live resolution. */
  async #orderLive(query: ListingPriceOrderQuery, viewer: BookPricingViewer, currency: string): Promise<ListingPriceOrderChunk> {
    const ids = [...new Set(query.restrictToProductIds ?? [])];
    const products = await this.deps.productsByIds(ids);
    const listed = await this.deps.books.resolveListing(products, viewer);
    const desc = query.direction === 'desc';
    let rows = products
      .map((p) => ({ p, row: rowOf(p.id, listed.get(p.id)) }))
      .filter((x): x is { p: PricedProductRef; row: SurfaceRow } => x.row !== null)
      .map(({ row }) => row);
    const cmp = (a: { amount: string; productId: string }, b: { amount: string; productId: string }) => {
      const byAmount = compareDecimal(a.amount, b.amount);
      const byId = a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;
      return desc ? -(byAmount || byId) : byAmount || byId;
    };
    if (query.amountRange?.min !== undefined) rows = rows.filter((r) => compareDecimal(r.amount, normal(query.amountRange!.min!)) >= 0);
    if (query.amountRange?.max !== undefined) rows = rows.filter((r) => compareDecimal(r.amount, normal(query.amountRange!.max!)) <= 0);
    if (query.after) {
      const after = { amount: normal(query.after.amount), productId: query.after.productId };
      rows = rows.filter((r) => cmp(r, after) > 0);
    }
    rows.sort(cmp);
    const page = rows.slice(0, query.limit);
    return {
      rows: page.map((r) => ({ productId: r.productId, amount: r.amount, currency, priceListId: '', isSale: r.sourceTier === 'sale' })),
      exhausted: rows.length <= query.limit,
      sourceRowsRead: rows.length,
    };
  }
}

/** A decimal bound as `compareDecimal` reads it (non-negative, ≤ 4 dp). */
function normal(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(4) : '0.0000';
}
