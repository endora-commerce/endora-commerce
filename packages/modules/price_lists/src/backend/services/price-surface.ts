import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  ListingPriceOrderChunk,
  ListingPriceOrderQuery,
  ListingPriceOrderRow,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { BookPricing, BookPricingViewer, ListingAnswer } from './book-pricing.js';
import { compareDecimal } from './matrix-decimal.js';
import type { PricedProductRef } from './pricing-service.interface.js';
import type { PricingProfile } from './pricing-profile.js';
import {
  emptyPlan,
  mergePlan,
  planMarks,
  productsOfSelections,
  selectingBooks,
  storedSelections,
  targetsForBooks,
  targetsForProducts,
  type ChangeTargets,
  type MarkPlan,
  type ResolvedBookFacts,
  type RowSelection,
  type SurfaceChange,
  type SurfaceProfileRef,
} from './surface-change.js';

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
 * §3). A pricing write marks, after its commit, what it moved — a (profile,
 * product) mark per product it concerns in each profile it reaches, or a whole
 * profile **stale** when it concerns every product of it (§4's trigger table,
 * {@link PriceSurface.markChanged}) — and asks the `price_lists.surface` worker
 * to refresh. A marked profile keeps serving the surface it had until the
 * worker swaps the refreshed one in: a whole build writes the next generation
 * of rows beside the served one and switches `serving_generation` in the same
 * transaction, and a targeted refresh replaces the marked products' rows of the
 * served generation in one transaction — either way a reader sees the surface
 * before or after, never a mix. Only the **order** may lag a
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

/**
 * Passes per worker job: a write that marks a profile during a pass is picked
 * up by the next, so the job runs while writes keep landing (a bulk import),
 * bounded so a job cannot run forever.
 */
const REBUILD_PASSES = 1_000;

/** Above this many products a change concerning a profile rebuilds it whole rather than marking each. */
const PARTIAL_LIMIT = 10_000;

/** Marks (and refreshed rows) written or deleted per statement. */
const MARK_CHUNK = 5_000;

/** A served surface: the profile id, the generation readers filter on, and the revision every memo of it is keyed on. */
interface ReadySurface {
  id: string;
  generation: number;
  revision: number;
}

/** One profile's work as a pass reads it, in one statement (a snapshot: marks committed later wait for the next pass). */
interface DueProfile {
  id: string;
  channelId: string;
  currencyCode: string;
  precedenceVersion: number;
  vector: PricingProfile['vector'];
  state: 'building' | 'ready';
  stale: boolean;
  /** `marked_at` as text — microseconds kept, so "unchanged since the snapshot" is an equality. */
  markedAt: string | null;
  /** The (profile, product) marks the pass read, by id (several per product when several writes marked it). */
  marks: Array<{ id: string; productId: string }>;
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
  /**
   * `catalog`'s category reads (Principle I: the marking asks the owner, never
   * its tables): which products a category row selects, which products a
   * category event concerns, and the assignments a category row is matched on.
   */
  categories: {
    listProductIdsInCategory(categoryId: string): Promise<readonly string[]>;
    listProductIdsInSubtree(categoryId: string): Promise<readonly string[]>;
    listAssignmentsForProducts(productIds: readonly string[]): Promise<ReadonlyArray<{ productId: string; categoryId: string }>>;
  };
  /** A book's channel set, through the membership accessor (Principle XII). */
  bookChannels: (bookId: string) => Promise<readonly string[]>;
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

  /** Every profile stale — still served — until rebuilt: what a write that says nothing about itself costs. */
  async markStale(): Promise<void> {
    await this.markChanged({ kind: 'all' });
  }

  /**
   * After a committed pricing write: mark what it moved (`contracts/price-surface.md`
   * §4) and ask the worker for a refresh. Every mark of one change is written
   * in one transaction, so a worker pass sees all of it or none. A marking that
   * fails falls back to marking every profile stale — the surface may then be
   * slow to catch up, but it is never left silently wrong.
   */
  async markChanged(change: SurfaceChange): Promise<void> {
    if (change.kind === 'none') return;
    try {
      await this.#mark(change);
    } catch (err) {
      try {
        await this.#markEvery();
      } catch {
        throw err;
      }
    }
    await this.deps.requestRebuild?.().catch(() => undefined);
  }

  async #markEvery(where = 'true', params: unknown[] = []): Promise<void> {
    await this.deps
      .emFactory()
      .execute(`update "price_profiles" set "stale" = true, "marked_at" = clock_timestamp() where ${where}`, params);
  }

  async #mark(change: Exclude<SurfaceChange, { kind: 'none' }>): Promise<void> {
    switch (change.kind) {
      case 'all':
        await this.#markEvery();
        return;
      case 'channels': {
        const ids = new Set(change.channelIds ?? []);
        if (change.channelCodes && change.channelCodes.length > 0) {
          const channels = await this.deps
            .emFactory()
            .find(SalesChannel, { code: { $in: [...change.channelCodes] } }, { fields: ['id'] });
          for (const c of channels) ids.add(c.id);
        }
        if (ids.size === 0) return;
        await this.#markEvery(`"sales_channel_id" = any(?::uuid[])`, [uuidArray([...ids])]);
        return;
      }
      case 'books': {
        let plan = emptyPlan();
        for (const book of change.books) {
          if (book.retire) await this.#retire(book.facts.map((f) => f.bookId));
          const profiles = await this.#profileRefs();
          if (profiles.length === 0) break;
          const facts: ResolvedBookFacts[] = [];
          for (const f of book.facts) {
            facts.push({ ...f, channelIds: f.channelIds ?? (f.live && !f.isSystem ? await this.deps.bookChannels(f.bookId) : []) });
          }
          const targets = targetsForBooks(facts, profiles);
          if (targets.own.length === 0 && targets.shared.length === 0) continue;
          const selections =
            book.selections === 'stored'
              ? await storedSelections(this.deps.emFactory(), [...new Set(book.facts.map((f) => f.bookId))])
              : book.selections;
          plan = mergePlan(plan, await this.#plan(targets, await this.#productsOf(selections)));
        }
        await this.#write(plan);
        return;
      }
      case 'products': {
        const profiles = await this.#profileRefs();
        await this.#write(await this.#plan(targetsForProducts(profiles, change.currencyCodes), new Set(change.productIds)));
        return;
      }
      case 'categories': {
        const products = new Set<string>();
        for (const categoryId of change.categoryIds) {
          for (const id of await this.deps.categories.listProductIdsInSubtree(categoryId)) products.add(id);
        }
        if (products.size === 0) return;
        const profiles = await this.#profileRefs();
        await this.#write(await this.#plan(targetsForProducts(profiles), products));
        return;
      }
      case 'attributes': {
        // The books that price on the attribute, and the products their rows on it select.
        const rows = await this.deps.emFactory().execute<
          Array<{ id: string; currency_code: string; audience_kind: ResolvedBookFacts['audienceKind']; is_system: boolean; status: string; product_id: string | null; category_id: string | null; attribute_key: string }>
        >(
          `select distinct l."id", l."currency_code", l."audience_kind", l."is_system", l."status",
                  e."product_id", e."category_id", e."attribute_key"
             from "price_list_matrix_entries" e join "price_lists" l on l."id" = e."price_list_id"
            where e."attribute_key" = any(?::text[])`,
          [`{${change.attributeKeys.map((k) => `"${k.replaceAll('"', '\\"')}"`).join(',')}}`],
        );
        const books = new Map<string, { facts: { bookId: string; currencyCode: string; audienceKind: ResolvedBookFacts['audienceKind']; isSystem: boolean; live: boolean }; selections: RowSelection[] }>();
        for (const r of rows) {
          const held = books.get(r.id) ?? {
            facts: { bookId: r.id, currencyCode: r.currency_code, audienceKind: r.audience_kind, isSystem: r.is_system, live: r.is_system || r.status === 'active' || r.status === 'scheduled' },
            selections: [],
          };
          held.selections.push({ productId: r.product_id, categoryId: r.category_id, attributeKey: r.attribute_key });
          books.set(r.id, held);
        }
        if (books.size === 0) return;
        await this.#mark({ kind: 'books', books: [...books.values()].map((b) => ({ facts: [b.facts], selections: b.selections })) });
        return;
      }
    }
  }

  /** Every profile, as the marking reads it — one statement. */
  async #profileRefs(): Promise<SurfaceProfileRef[]> {
    const rows = await this.deps.emFactory().execute<
      Array<{ id: string; sales_channel_id: string; currency_code: string; book_vector: PricingProfile['vector'] }>
    >(`select "id", "sales_channel_id", "currency_code", "book_vector" from "price_profiles"`);
    return rows.map((r) => ({
      id: r.id,
      channelId: r.sales_channel_id,
      currencyCode: r.currency_code.trim().toUpperCase(),
      bookIds: r.book_vector.map((v) => v.bookId),
    }));
  }

  /** A deleted book's buyer profiles can never be asked for again: drop them (rows and marks cascade). */
  async #retire(bookIds: readonly string[]): Promise<void> {
    for (const bookId of new Set(bookIds)) {
      await this.deps
        .emFactory()
        .execute(`delete from "price_profiles" where "book_vector" @> ?::jsonb`, [JSON.stringify([{ bookId }])]);
    }
  }

  async #productsOf(selections: readonly RowSelection[]): Promise<Set<string> | 'all'> {
    return productsOfSelections(selections, (categoryId) => this.deps.categories.listProductIdsInCategory(categoryId));
  }

  /** {@link planMarks} with its two reads: the books that may select each product, and the rows the buyer surfaces hold. */
  async #plan(targets: ChangeTargets, products: Set<string> | 'all'): Promise<MarkPlan> {
    const buyers = targets.shared.filter((p) => p.bookIds.length > 0);
    const partial = products !== 'all' && products.size > 0 && products.size <= PARTIAL_LIMIT;
    const ids = partial ? [...products] : [];
    const em = this.deps.emFactory();
    const selecting =
      partial && buyers.length > 0
        ? await selectingBooks(em, [...new Set(buyers.flatMap((p) => p.bookIds))], ids, (productIds) =>
            this.deps.categories.listAssignmentsForProducts(productIds),
          )
        : { byProduct: new Map(), any: new Set<string>() };
    const held = new Map<string, Set<string>>();
    if (partial && buyers.length > 0) {
      const rows = await em.execute<Array<{ profile_id: string; product_id: string }>>(
        `select pp."profile_id", pp."product_id"
           from "price_profile_prices" pp
           join "price_profiles" f on f."id" = pp."profile_id" and pp."generation" = f."serving_generation"
          where pp."profile_id" = any(?::uuid[]) and pp."product_id" = any(?::uuid[])`,
        [uuidArray(buyers.map((p) => p.id)), uuidArray(ids)],
      );
      for (const r of rows) {
        const set = held.get(r.profile_id);
        if (set) set.add(r.product_id);
        else held.set(r.profile_id, new Set([r.product_id]));
      }
    }
    return planMarks({ targets, products, selecting, held, partialLimit: PARTIAL_LIMIT });
  }

  /** Write a plan's marks in one transaction (a pass reads all of them or none). */
  async #write(plan: MarkPlan): Promise<void> {
    if (plan.full.size === 0 && plan.products.size === 0) return;
    const profileIds: string[] = [];
    const productIds: string[] = [];
    for (const [profileId, products] of plan.products) {
      for (const productId of products) {
        profileIds.push(profileId);
        productIds.push(productId);
      }
    }
    await this.deps.emFactory().transactional(async (em) => {
      if (plan.full.size > 0) {
        await em.execute(`update "price_profiles" set "stale" = true, "marked_at" = clock_timestamp() where "id" = any(?::uuid[])`, [
          uuidArray([...plan.full]),
        ]);
      }
      for (let start = 0; start < profileIds.length; start += MARK_CHUNK) {
        await em.execute(
          `insert into "price_profile_stale_products" ("profile_id", "product_id")
           select m."profile_id", m."product_id"
             from unnest(?::uuid[], ?::uuid[]) as m("profile_id", "product_id")
            where exists (select 1 from "price_profiles" f where f."id" = m."profile_id")`,
          [uuidArray(profileIds.slice(start, start + MARK_CHUNK)), uuidArray(productIds.slice(start, start + MARK_CHUNK))],
        );
      }
    });
  }

  /**
   * The worker's job (`contracts/price-surface.md` §4). Each pass reads its work
   * in one statement — every never-built and every stale profile, every
   * (profile, product) mark — and does it: a never-built or stale profile is
   * built whole from its stored vector, a marked one has just the marked
   * products re-resolved. The everyone profiles go first (never-built before
   * marked), then the buyer profiles (never-built before marked), because a
   * buyer surface is stored as its difference from the everyone surface and
   * must be compared with the everyone surface this pass leaves. A pass clears
   * only the marks it read (by id), so a write that marks a profile
   * during a pass is done by the next; passes repeat while a pass leaves work.
   * Answers how many profiles were built or refreshed.
   */
  async rebuildStale(): Promise<number> {
    let done = 0;
    for (let pass = 0; pass < REBUILD_PASSES; pass += 1) {
      const due = await this.#due();
      if (due.length === 0) break;
      for (const item of due) {
        const profile = await this.deps.books.profileFromVector({
          channelId: item.channelId,
          currencyCode: item.currencyCode,
          precedenceVersion: item.precedenceVersion,
          vector: item.vector,
        });
        const everyone = item.vector.length === 0 ? null : await this.#everyoneOf(profile);
        if (item.state === 'building' || item.stale) await this.#build(profile, everyone, item);
        else await this.#refresh(item, profile, everyone);
        done += 1;
      }
    }
    return done;
  }

  async #due(): Promise<DueProfile[]> {
    const rows = await this.deps.emFactory().execute<
      Array<{
        id: string;
        sales_channel_id: string;
        currency_code: string;
        precedence_version: number;
        book_vector: PricingProfile['vector'];
        state: 'building' | 'ready';
        stale: boolean;
        marked_at: string | null;
        marks: Array<[string | number, string]> | null;
      }>
    >(
      `select f."id", f."sales_channel_id", f."currency_code", f."precedence_version", f."book_vector",
              f."state", f."stale", f."marked_at"::text as "marked_at",
              (select json_agg(json_build_array(m."id"::text, m."product_id"))
                 from "price_profile_stale_products" m where m."profile_id" = f."id") as "marks"
         from "price_profiles" f
        where f."state" = 'building' or f."stale"
           or exists (select 1 from "price_profile_stale_products" m where m."profile_id" = f."id")
        order by (jsonb_array_length(f."book_vector") > 0) asc, (f."state" = 'building') desc,
                 jsonb_array_length(f."book_vector") asc`,
    );
    return rows.map((r) => ({
      id: r.id,
      channelId: r.sales_channel_id,
      currencyCode: r.currency_code.trim(),
      precedenceVersion: Number(r.precedence_version),
      vector: r.book_vector,
      state: r.state,
      stale: r.stale,
      markedAt: r.marked_at,
      marks: (r.marks ?? []).map(([id, productId]) => ({ id: String(id), productId })),
    }));
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
    if (held && held.state === 'ready') return { id: held.id, generation: held.generation, revision: held.revision };
    await this.#ensureRow(profile);
    await this.deps.requestRebuild?.().catch(() => undefined);
    if (query.restrictToProductIds !== undefined && query.restrictToProductIds.length <= LIVE_ORDER_LIMIT) return 'live';
    return 'missing';
  }

  async #profileRow(profile: PricingProfile): Promise<{ id: string; state: string; generation: number; revision: number } | null> {
    const [row] = await this.deps
      .emFactory()
      .execute<Array<{ id: string; state: string; serving_generation: number; revision: number }>>(
        `select "id", "state", "serving_generation", "revision" from "price_profiles"
          where "sales_channel_id" = ? and "currency_code" = ? and "precedence_version" = ? and "key_hash" = ?`,
        [profile.channelId, profile.currencyCode, profile.precedenceVersion, profile.key],
      );
    if (!row) return null;
    return { id: row.id, state: row.state, generation: Number(row.serving_generation), revision: Number(row.revision) };
  }

  /**
   * Whether every product of the everyone surface has a row on the buyer's —
   * answered once per pair of builds and memoised in this process (a build or a
   * targeted refresh moves the revision, so a stale answer is never read; the
   * page statement checks the pair).
   *
   * Each everyone row is probed with a scalar `limit 1` sub-select, which the
   * planner cannot flatten into a join: one primary-key lookup per row,
   * whatever the statistics. Written as `not exists`, it was planned — on a
   * table analysed while empty, as a fresh install's and the bench's are — as a
   * nested-loop anti join filtering every buyer row per everyone row: 428 s for
   * an all-products buyer on the SC-005 fixture (`price-surface-plans.test.ts`).
   */
  async #buyerCoversEveryone(buyer: ReadySurface, everyone: ReadySurface): Promise<boolean> {
    const key = `${buyer.id}@${buyer.revision}|${everyone.id}@${everyone.revision}`;
    const held = this.#coverage.get(key);
    if (held !== undefined) return held;
    const [row] = await this.deps.emFactory().execute<Array<{ uncovered: boolean }>>(
      `select exists (
         select 1 from "price_profile_prices" e
          where e."profile_id" = ? and e."generation" = ?
            and (select 1 from "price_profile_prices" b
                  where b."profile_id" = ? and b."generation" = ? and b."product_id" = e."product_id"
                  limit 1) is null
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

  /** The everyone surface a buyer profile is stored against — built first when it has none. */
  async #everyoneServed(everyone: PricingProfile): Promise<ReadySurface> {
    const held = await this.#profileRow(everyone);
    if (held && held.state === 'ready') return { id: held.id, generation: held.generation, revision: held.revision };
    const id = await this.#build(everyone, null);
    const [row] = await this.deps
      .emFactory()
      .execute<Array<{ serving_generation: number; revision: number }>>(
        `select "serving_generation", "revision" from "price_profiles" where "id" = ?`,
        [id],
      );
    return { id, generation: Number(row?.serving_generation ?? 0), revision: Number(row?.revision ?? 0) };
  }

  /**
   * The products a buyer profile can price differently from the everyone
   * profile: those the rows of its own (buyer) books select — every other
   * product resolves over the same books as the everyone profile and answers
   * what it answers, so it has no row. `'all'` when a row may select anything.
   */
  async #buyerCandidates(profile: PricingProfile): Promise<Set<string> | 'all'> {
    const own = profile.books.filter((b) => b.audience.kind !== 'everyone').map((b) => b.id);
    if (own.length === 0) return new Set();
    return this.#productsOf(await storedSelections(this.deps.emFactory(), own));
  }

  /**
   * The surface rows of `products` for the profile, in chunks: each resolved by
   * the batched resolver the cards use, and — for a buyer profile — only those
   * that differ from the everyone surface's served row (sparse). A product
   * everyone can buy and this profile cannot is not representable as a row,
   * and cannot happen (a buyer row always has the catalogue price to fall back to).
   */
  async #rowsOf(
    em: EntityManager,
    profile: PricingProfile,
    products: readonly PricedProductRef[],
    everyone: ReadySurface | null,
    write: (rows: SurfaceRow[]) => Promise<void>,
  ): Promise<void> {
    for (let start = 0; start < products.length; start += BUILD_CHUNK) {
      const chunk = products.slice(start, start + BUILD_CHUNK);
      const listed = await this.deps.books.resolveListing(chunk, builderViewer(profile), profile);
      let rows = chunk.map((p) => rowOf(p.id, listed.get(p.id))).filter((r): r is SurfaceRow => r !== null);
      if (everyone) {
        const base = new Map(
          (
            await em.execute<
              Array<{ product_id: string; amount: string; max_amount: string; compare_at: string | null; source_tier: SurfaceRow['sourceTier'] }>
            >(
              `select "product_id", "amount", "max_amount", "compare_at", "source_tier"
                 from "price_profile_prices"
                where "profile_id" = ? and "generation" = (select "serving_generation" from "price_profiles" where "id" = ?)
                  and "product_id" = any(?::uuid[])`,
              [everyone.id, everyone.id, uuidArray(chunk.map((p) => p.id))],
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
        rows = rows.filter((r) => {
          const held = base.get(r.productId);
          return !held || !sameRow(held, r);
        });
      }
      if (rows.length > 0) await write(rows);
    }
  }

  async #insertRows(em: EntityManager, id: string, generation: number, rows: readonly SurfaceRow[]): Promise<void> {
    await em.execute(
      `insert into "price_profile_prices" ("profile_id", "generation", "product_id", "amount", "max_amount", "compare_at", "source_tier")
       select ?, ?, * from unnest(?::uuid[], ?::numeric[], ?::numeric[], ?::numeric[], ?::varchar[])`,
      [
        id,
        generation,
        uuidArray(rows.map((r) => r.productId)),
        `{${rows.map((r) => r.amount).join(',')}}`,
        `{${rows.map((r) => r.maxAmount).join(',')}}`,
        `{${rows.map((r) => (r.compareAt === null ? 'NULL' : r.compareAt)).join(',')}}`,
        `{${rows.map((r) => r.sourceTier).join(',')}}`,
      ],
    );
  }

  /** Delete the marks a pass read — by id: a mark a write added since is another row, and stays. */
  async #clearMarks(em: EntityManager, marks: DueProfile['marks']): Promise<void> {
    for (let start = 0; start < marks.length; start += MARK_CHUNK) {
      await em.execute(`delete from "price_profile_stale_products" where "id" = any(?::bigint[])`, [
        `{${marks
          .slice(start, start + MARK_CHUNK)
          .map((m) => m.id)
          .join(',')}}`,
      ]);
    }
  }

  /**
   * Build a profile's next generation in one transaction, serialised per profile
   * by an advisory lock, and swap it in: the everyone profile with every priced
   * product, a buyer profile with the products whose answer differs from the
   * everyone profile's served rows (built first when it has none) — resolving
   * only the products its own books can select. Readers keep the served
   * generation until the commit; the old rows go in the same transaction.
   * `stale` is cleared only when no write marked the profile after the pass
   * read it (`due`), and the marks the pass read go with the build. Called by
   * the worker, never by a request. Answers the id.
   */
  async #build(profile: PricingProfile, everyone: PricingProfile | null, due?: DueProfile): Promise<string> {
    const everyoneServed = everyone ? await this.#everyoneServed(everyone) : null;
    const id = await this.#ensureRow(profile);
    const candidates = everyone ? await this.#buyerCandidates(profile) : 'all';
    const products =
      candidates === 'all' ? await this.deps.listProducts() : candidates.size === 0 ? [] : await this.deps.productsByIds([...candidates]);
    await this.deps.emFactory().transactional(async (em) => {
      await em.execute(`select pg_advisory_xact_lock(hashtext(?))`, [`price_lists.surface:${id}`]);
      const [current] = await em.execute<Array<{ state: string; stale: boolean; serving_generation: number; marked_at: string | null }>>(
        `select "state", "stale", "serving_generation", "marked_at"::text as "marked_at" from "price_profiles" where "id" = ?`,
        [id],
      );
      // Another worker built it while this one waited for the lock.
      if (current?.state === 'ready' && !current.stale) return;
      const next = Number(current?.serving_generation ?? 0) + 1;
      await em.execute(`delete from "price_profile_prices" where "profile_id" = ? and "generation" = ?`, [id, next]);
      await this.#rowsOf(em, profile, products, everyoneServed, (rows) => this.#insertRows(em, id, next, rows));
      // The swap: readers move to the new generation at commit. A whole mark
      // made after the pass read the profile (or, for a build the pass did not
      // ask for, after this one began) keeps it stale.
      const cutoff = due ? due.markedAt : (current?.marked_at ?? null);
      await em.execute(
        `update "price_profiles"
            set "state" = 'ready', "serving_generation" = ?, "built_at" = now(), "revision" = "revision" + 1,
                "stale" = "stale" and "marked_at" is distinct from ?::timestamptz
          where "id" = ?`,
        [next, cutoff, id],
      );
      await em.execute(`delete from "price_profile_prices" where "profile_id" = ? and "generation" <> ?`, [id, next]);
      if (due) await this.#clearMarks(em, due.marks);
    });
    return id;
  }

  /**
   * A targeted refresh (`contracts/price-surface.md` §4): re-resolve the marked
   * products of a served profile and replace their rows of the served
   * generation, in one transaction under the profile's lock — a reader's
   * statement sees the surface before or after the refresh, never a mix — and
   * move the revision. Clears the marks the pass read, if no write moved them.
   */
  async #refresh(due: DueProfile, profile: PricingProfile, everyone: PricingProfile | null): Promise<void> {
    if (due.marks.length === 0) return;
    const everyoneServed = everyone ? await this.#everyoneServed(everyone) : null;
    const ids = [...new Set(due.marks.map((m) => m.productId))];
    const products = await this.deps.productsByIds(ids);
    await this.deps.emFactory().transactional(async (em) => {
      await em.execute(`select pg_advisory_xact_lock(hashtext(?))`, [`price_lists.surface:${due.id}`]);
      const [current] = await em.execute<Array<{ state: string; serving_generation: number }>>(
        `select "state", "serving_generation" from "price_profiles" where "id" = ?`,
        [due.id],
      );
      // Gone, or waiting for a whole build that will cover the marks.
      if (!current || current.state !== 'ready') return;
      const generation = Number(current.serving_generation);
      const rows: SurfaceRow[] = [];
      await this.#rowsOf(em, profile, products, everyoneServed, async (chunk) => {
        rows.push(...chunk);
      });
      for (let start = 0; start < ids.length; start += MARK_CHUNK) {
        await em.execute(
          `delete from "price_profile_prices" where "profile_id" = ? and "generation" = ? and "product_id" = any(?::uuid[])`,
          [due.id, generation, uuidArray(ids.slice(start, start + MARK_CHUNK))],
        );
      }
      for (let start = 0; start < rows.length; start += MARK_CHUNK) {
        await this.#insertRows(em, due.id, generation, rows.slice(start, start + MARK_CHUNK));
      }
      await em.execute(`update "price_profiles" set "revision" = "revision" + 1 where "id" = ?`, [due.id]);
      await this.#clearMarks(em, due.marks);
    });
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
    const revision = `(select "revision" from "price_profiles" where "id" = ?)`;
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
      const sameBuilds = `${revision} = ? and ${revision} = ?`;
      sql += ` where ${sameBuilds} union all select 'x', null, null, null where not (${sameBuilds})`;
      params.push(buyer.id, buyer.revision, everyone.id, everyone.revision);
      params.push(buyer.id, buyer.revision, everyone.id, everyone.revision);
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
