import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForeignKeyConstraintViolationException, UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { BUILD_CHUNK, PriceSurface, isVanishedProduct } from './price-surface.js';
import type { BookPricing } from './book-pricing.js';
import type { PricingProfile, ProfileVectorEntry } from './pricing-profile.js';
import type { PricedProductRef } from './pricing-service.interface.js';

/**
 * Issue #416 — a whole build of a profile, as the worker's pass runs it, over
 * a scripted database that keeps the invariants the real one does: a
 * transaction that rolls back on failure, the `product_id` foreign key of
 * `price_profile_prices`, marks deleted by id, and the swap's cutoff
 * (`"stale" and "marked_at" is distinct from ?`).
 *
 * What a whole build must hold (`contracts/price-surface.md` §3–§4, research
 * R19):
 *
 * - it prices the catalogue as it is when **that build** starts, never as an
 *   earlier build of the pass read it (review of #424: a per-pass snapshot
 *   priced a product deleted mid-pass, failing on the foreign key, and resolved
 *   attribute values a change had already replaced);
 * - a product deleted between its read and its insert costs the build a retry
 *   on a fresh read; a build whose products still vanish after three attempts
 *   fails the pass — nothing swapped, every mark kept, no buyer of the channel
 *   built against an everyone surface that failed — so the job fails and the
 *   queue's own retry runs it again (review 2 of #424); a retry starts only
 *   once the attempt it replaces has settled its reads;
 * - a whole-profile mark landing after the build read the catalogue survives
 *   the swap, also for a build no pass asked for (an everyone profile built
 *   because a buyer needs it);
 * - the next batch is resolved while the previous one is written, and a
 *   buyer's comparison rows are read beside its resolution;
 * - a write or a resolution failing in any batch swaps nothing — the
 *   transaction rolls back — fails at once rather than after the next
 *   resolution, and leaves no unhandled rejection.
 */

interface FakeProfile {
  id: string;
  key: string;
  vector: ProfileVectorEntry[];
  state: 'building' | 'ready';
  stale: boolean;
  markedAt: string | null;
  generation: number;
  revision: number;
}

interface FakeRow {
  profileId: string;
  generation: number;
  productId: string;
  amount: string;
}

interface State {
  profiles: FakeProfile[];
  rows: FakeRow[];
  marks: Array<{ id: string; profileId: string; productId: string }>;
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `pgArray`'s literal back to its values. */
function parseArray(literal: unknown): Array<string | null> {
  const body = String(literal).slice(1, -1);
  if (body.length === 0) return [];
  return body.split(',').map((v) => (v === 'NULL' ? null : v.replace(/^"|"$/g, '')));
}

const money = (n: number) => n.toFixed(4);

interface Options {
  /** Products in the catalogue, `p0…`, each priced at its `price` attribute (10 by default). */
  products: number;
  /** Buyer profiles, each with one all-products −1 row (every product differs from the everyone price). */
  buyers: number;
  /** Register the everyone profile up front (`false`: a buyer's build creates and builds it, with no `due`). */
  everyoneRegistered?: boolean;
  /** Called after the n-th catalogue read (whole builds and refreshes). */
  afterCatalogueRead?: (n: number, h: Harness) => void;
  /** Called after a profile's swap commits. */
  afterSwap?: (profileId: string, h: Harness) => void;
  /** The n-th insert fails with a non-foreign-key error. */
  failInsert?: number;
  /** The n-th resolution fails. */
  failResolve?: number;
  resolveMs?: number;
  insertMs?: number;
  servedMs?: number;
}

interface Harness {
  surface: PriceSurface;
  log: string[];
  readonly state: State;
  catalogue: Map<string, Record<string, unknown>>;
  reads: { catalogue: number };
  profile(id: string): FakeProfile;
  served(id: string): Map<string, string>;
  /** A (profile, product) mark, as `markChanged` inserts one. */
  mark(profileId: string, productId: string): void;
  /** A whole-profile mark, as `markChanged` writes one: `stale`, and a `marked_at` no earlier one equals. */
  markWhole(profileId: string): void;
}

function harness(options: Options): Harness {
  const log: string[] = [];
  const reads = { catalogue: 0 };
  let inserts = 0;
  let resolutions = 0;
  let served = 0;
  let markSeq = 0;
  let clock = 0;
  const catalogue = new Map<string, Record<string, unknown>>(
    Array.from({ length: options.products }, (_, i) => [`p${i}`, { price: 10 }]),
  );
  const profile = (id: string, key: string, vector: ProfileVectorEntry[]): FakeProfile => ({
    id,
    key,
    vector,
    state: 'building',
    stale: false,
    markedAt: null,
    generation: 0,
    revision: 0,
  });
  let state: State = {
    profiles: [
      ...(options.everyoneRegistered === false ? [] : [profile('e', 'key-e', [])]),
      ...Array.from({ length: options.buyers }, (_, i) =>
        profile(`b${i}`, `key-b${i}`, [{ bookId: `book-${i}`, audienceKind: 'organizations', depth: 0 }]),
      ),
    ],
    rows: [],
    marks: [],
  };
  const byKey = (key: unknown) => state.profiles.find((p) => p.key === key);
  const byId = (id: unknown) => state.profiles.find((p) => p.id === id);

  // What the driver answers, wrapped as MikroORM wraps it.
  const fkViolation = (productId: string) =>
    new ForeignKeyConstraintViolationException(
      Object.assign(
        new Error(
          `insert or update on table "price_profile_prices" violates foreign key constraint "price_profile_prices_product_id_foreign" (${productId})`,
        ),
        { code: '23503', constraint: 'price_profile_prices_product_id_foreign', table: 'price_profile_prices' },
      ),
    );

  let h: Harness;

  const execute = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    const s = sql.trim().replace(/\s+/g, ' ');
    if (/where f\."state" = 'building' or f\."stale"/.test(s)) {
      log.push('due');
      return state.profiles
        .filter((p) => p.state === 'building' || p.stale || state.marks.some((m) => m.profileId === p.id))
        .sort((a, b) => a.vector.length - b.vector.length)
        .map((p) => {
          const marks = state.marks.filter((m) => m.profileId === p.id).map((m) => [m.id, m.productId]);
          return {
            id: p.id,
            sales_channel_id: 'ch',
            currency_code: 'PLN',
            precedence_version: 1,
            book_vector: p.vector,
            state: p.state,
            stale: p.stale,
            marked_at: p.markedAt,
            marks: marks.length > 0 ? marks : null,
          };
        });
    }
    if (/^select "id", "state", "serving_generation", "revision" from "price_profiles"/.test(s)) {
      const p = byKey(params[3]);
      return p ? [{ id: p.id, state: p.state, serving_generation: p.generation, revision: p.revision }] : [];
    }
    if (/^insert into "price_profiles"/.test(s)) {
      if (!byKey(params[4])) {
        const vector = JSON.parse(String(params[5])) as ProfileVectorEntry[];
        state.profiles.push(profile(vector.length === 0 ? 'e' : String(params[0]), String(params[4]), vector));
      }
      return [];
    }
    if (/^select distinct "product_id", "category_id", "attribute_key"/.test(s)) {
      return [{ product_id: null, category_id: null, attribute_key: null }];
    }
    if (/pg_advisory_xact_lock/.test(s)) return [];
    if (/^select "state", "stale", "serving_generation", "marked_at"::text as "marked_at" from "price_profiles"/.test(s)) {
      const p = byId(params[0])!;
      return [{ state: p.state, stale: p.stale, serving_generation: p.generation, marked_at: p.markedAt }];
    }
    if (/^select "marked_at"::text as "marked_at" from "price_profiles"/.test(s)) {
      const p = byId(params[0]);
      return p ? [{ marked_at: p.markedAt }] : [];
    }
    if (/^select "state", "serving_generation" from "price_profiles"/.test(s)) {
      const p = byId(params[0]);
      return p ? [{ state: p.state, serving_generation: p.generation }] : [];
    }
    if (/^select "serving_generation", "revision" from "price_profiles"/.test(s)) {
      const p = byId(params[0])!;
      return [{ serving_generation: p.generation, revision: p.revision }];
    }
    if (/^insert into "price_profile_prices"/.test(s)) {
      inserts += 1;
      const n = inserts;
      log.push(`insert:start:${n}`);
      await sleep(options.insertMs ?? 5);
      if (options.failInsert === n) {
        log.push(`insert:fail:${n}`);
        throw new Error(`insert ${n} failed`);
      }
      const products = parseArray(params[2]);
      const amounts = parseArray(params[3]);
      const gone = products.find((id) => !catalogue.has(id!));
      if (gone) {
        log.push(`insert:fk:${n}`);
        throw fkViolation(gone);
      }
      products.forEach((productId, i) =>
        state.rows.push({ profileId: String(params[0]), generation: Number(params[1]), productId: productId!, amount: amounts[i]! }),
      );
      log.push(`insert:end:${n}`);
      return [];
    }
    if (/^select "product_id", "amount", "max_amount", "compare_at", "source_tier" from "price_profile_prices"/.test(s)) {
      served += 1;
      const n = served;
      log.push(`served:start:${n}`);
      await sleep(options.servedMs ?? 1);
      const p = byId(params[0])!;
      const wanted = new Set(parseArray(params[2]));
      log.push(`served:end:${n}`);
      return state.rows
        .filter((r) => r.profileId === p.id && r.generation === p.generation && wanted.has(r.productId))
        .map((r) => ({ product_id: r.productId, amount: r.amount, max_amount: r.amount, compare_at: null, source_tier: 'base' }));
    }
    if (/^delete from "price_profile_prices" where "profile_id" = \? and "generation" = \? and "product_id" = any/.test(s)) {
      const wanted = new Set(parseArray(params[2]));
      state.rows = state.rows.filter((r) => !(r.profileId === params[0] && r.generation === Number(params[1]) && wanted.has(r.productId)));
      return [];
    }
    if (/^delete from "price_profile_prices" where "profile_id" = \? and "generation" = \?$/.test(s)) {
      state.rows = state.rows.filter((r) => !(r.profileId === params[0] && r.generation === Number(params[1])));
      return [];
    }
    if (/^delete from "price_profile_prices" where "profile_id" = \? and "generation" <> \?$/.test(s)) {
      state.rows = state.rows.filter((r) => !(r.profileId === params[0] && r.generation !== Number(params[1])));
      return [];
    }
    if (/from "pg_class"/.test(s)) return [{ reltuples: 1_000_000 }];
    if (/^analyze/.test(s)) return [];
    if (/^update "price_profiles" set "state" = 'ready'/.test(s)) {
      const p = byId(params[2])!;
      p.state = 'ready';
      p.generation = Number(params[0]);
      p.revision += 1;
      p.stale = p.stale && p.markedAt !== (params[1] ?? null);
      log.push(`swap:${p.id}`);
      return [];
    }
    if (/^update "price_profiles" set "revision" = "revision" \+ 1/.test(s)) {
      byId(params[0])!.revision += 1;
      log.push(`refresh:${String(params[0])}`);
      return [];
    }
    if (/^delete from "price_profile_stale_products" where "id" = any/.test(s)) {
      const ids = new Set(parseArray(params[0]));
      state.marks = state.marks.filter((m) => !ids.has(m.id));
      return [];
    }
    throw new Error(`unexpected statement: ${s}`);
  };

  const em = {
    execute,
    // A transaction: its writes stay only if the work succeeds; any failure rolls all of them back.
    transactional: async <T>(work: (em: unknown) => Promise<T>) => {
      const before = structuredClone(state);
      const mark = log.length;
      try {
        const result = await work(em);
        const swapped = log.slice(mark).find((l) => l.startsWith('swap:'));
        if (swapped) options.afterSwap?.(swapped.slice('swap:'.length), h);
        return result;
      } catch (err) {
        state = before;
        log.push('rollback');
        throw err;
      }
    },
  };

  const books = {
    profileFromVector: async (input: { channelId: string; currencyCode: string; precedenceVersion: number; vector: ProfileVectorEntry[] }) =>
      ({
        key: input.vector.length === 0 ? 'key-e' : `key-b${input.vector[0]!.bookId.slice('book-'.length)}`,
        channelId: input.channelId,
        currencyCode: input.currencyCode,
        precedenceVersion: input.precedenceVersion,
        vector: input.vector,
        books: input.vector.map((v) => ({ id: v.bookId, name: v.bookId, type: 'regular', isSystem: false, priority: 0, audience: { kind: 'organizations', depth: 0 } })),
      }) as unknown as PricingProfile,
    resolveProfileListing: async (products: readonly PricedProductRef[], profile: PricingProfile) => {
      resolutions += 1;
      const n = resolutions;
      log.push(`resolve:start:${n}`);
      await sleep(options.resolveMs ?? 1);
      if (options.failResolve === n) {
        log.push(`resolve:fail:${n}`);
        throw new Error(`resolution ${n} failed`);
      }
      log.push(`resolve:end:${n}`);
      const discount = profile.vector.length === 0 ? 0 : 1;
      return new Map(
        products.map((p) => [
          p.id,
          {
            resolution: { price: { amount: money(Number(p.attributeValues['price'] ?? 10) - discount), source: 'base', compareAt: null } },
            maxAmount: null,
            variesByVariant: false,
          },
        ]),
      );
    },
  } as unknown as BookPricing;

  const read = (ids?: readonly string[]): PricedProductRef[] => {
    reads.catalogue += 1;
    const out = [...catalogue]
      .filter(([id]) => !ids || ids.includes(id))
      .map(([id, attributeValues]) => ({ id, attributeValues: { ...attributeValues } }));
    log.push(`catalogue:${reads.catalogue}`);
    options.afterCatalogueRead?.(reads.catalogue, h);
    return out;
  };

  const surface = new PriceSurface({
    emFactory: () => em as unknown as EntityManager,
    books,
    listProducts: async () => read(),
    productsByIds: async (ids) => read(ids),
    categories: {
      listProductIdsInCategory: async () => [],
      listProductIdsInSubtree: async () => [],
      listAssignmentsForProducts: async () => [],
    },
    bookChannels: async () => ['ch'],
  });

  h = {
    surface,
    log,
    get state() {
      return state;
    },
    catalogue,
    reads,
    profile: (id) => byId(id)!,
    served: (id) => {
      const p = byId(id)!;
      return new Map(state.rows.filter((r) => r.profileId === id && r.generation === p.generation).map((r) => [r.productId, r.amount]));
    },
    mark: (profileId, productId) => {
      markSeq += 1;
      state.marks.push({ id: String(markSeq), profileId, productId });
    },
    markWhole: (profileId) => {
      clock += 1;
      const p = byId(profileId)!;
      p.stale = true;
      p.markedAt = `2026-10-24 12:00:00.${String(clock).padStart(6, '0')}+00`;
    },
  };
  return h;
}

describe('PriceSurface — a whole build prices the catalogue as it is when the build starts', () => {
  it('a product deleted after an earlier build of the pass is not priced by a later one, and the pass completes', async () => {
    const h = harness({
      products: 4,
      buyers: 2,
      afterSwap: (id, harness) => {
        if (id === 'e') harness.catalogue.delete('p1');
      },
    });
    await expect(h.surface.rebuildStale()).resolves.toBeGreaterThanOrEqual(3);
    for (const id of ['b0', 'b1']) {
      expect(h.profile(id).state, id).toBe('ready');
      expect(h.served(id).has('p1'), id).toBe(false);
      expect(h.served(id).get('p0'), id).toBe('9.0000');
    }
  });

  it('a product deleted between a build’s read and its insert costs that build a retry on a fresh read, not the pass', async () => {
    const h = harness({
      products: 3,
      buyers: 1,
      afterCatalogueRead: (n, harness) => {
        if (n === 1) harness.catalogue.delete('p2');
      },
    });
    await expect(h.surface.rebuildStale()).resolves.toBe(2);
    expect(h.log).toContain('rollback');
    expect(h.profile('e')).toMatchObject({ state: 'ready', generation: 1 });
    expect([...h.served('e').keys()].sort()).toEqual(['p0', 'p1']);
    expect([...h.served('b0').keys()].sort()).toEqual(['p0', 'p1']);
    expect(unhandled).toEqual([]);
  });

  /** A catalogue that loses one product the build just read, after every read in `reads`. */
  const vanishing = (reads: (n: number) => boolean) => {
    let fresh = 0;
    return (n: number, harness: Harness) => {
      if (!reads(n)) return;
      harness.catalogue.delete([...harness.catalogue.keys()][0]!);
      harness.catalogue.set(`new${fresh++}`, { price: 10 });
    };
  };

  it('an everyone build whose products keep vanishing fails the pass after three attempts; no buyer of the channel is built against it', async () => {
    const h = harness({ products: 3, buyers: 2, afterCatalogueRead: vanishing(() => true) });
    await expect(h.surface.rebuildStale()).rejects.toThrow(/vanished/);
    expect(h.reads.catalogue).toBe(3);
    expect(h.log.some((l) => l.startsWith('swap:'))).toBe(false);
    for (const id of ['e', 'b0', 'b1']) expect(h.profile(id), id).toMatchObject({ state: 'building', generation: 0 });
    expect(unhandled).toEqual([]);
  });

  it('an everyone surface built on a buyer’s demand that keeps vanishing costs three attempts in all, not three per buyer', async () => {
    const h = harness({ products: 3, buyers: 3, everyoneRegistered: false, afterCatalogueRead: vanishing(() => true) });
    await expect(h.surface.rebuildStale()).rejects.toThrow(/vanished/);
    expect(h.reads.catalogue).toBe(3);
    expect(h.log.some((l) => l.startsWith('swap:'))).toBe(false);
  });

  it('a buyer whose products keep vanishing fails the pass: what was built before it stays, it and the rest keep their marks', async () => {
    // The everyone build is read 1; b0's three attempts are reads 2–4.
    const h = harness({ products: 3, buyers: 2, afterCatalogueRead: vanishing((n) => n >= 2 && n <= 4) });
    await expect(h.surface.rebuildStale()).rejects.toThrow(/vanished/);
    expect(h.profile('e')).toMatchObject({ state: 'ready', generation: 1 });
    expect(h.profile('b0')).toMatchObject({ state: 'building', generation: 0 });
    expect(h.profile('b1')).toMatchObject({ state: 'building', generation: 0 });
    // The job's retry — another call — finishes the work.
    await expect(h.surface.rebuildStale()).resolves.toBe(2);
    expect(h.profile('b0').state).toBe('ready');
    expect(h.profile('b1').state).toBe('ready');
  });

  it('a retry starts only once the attempt it replaces has settled the reads it had in flight', async () => {
    const h = harness({
      products: BUILD_CHUNK * 3,
      buyers: 0,
      insertMs: 2,
      resolveMs: 60,
      afterCatalogueRead: (n, harness) => {
        if (n === 1) harness.catalogue.delete('p1');
      },
    });
    await h.surface.rebuildStale();
    // Attempt 1: resolution 1, insert 1 fails on the key while resolution 2 runs; attempt 2 reads afresh.
    expect(h.log.indexOf('insert:fk:1')).toBeGreaterThan(-1);
    expect(h.log.indexOf('rollback')).toBeLessThan(h.log.indexOf('resolve:end:2'));
    expect(h.log.indexOf('catalogue:2')).toBeGreaterThan(h.log.indexOf('resolve:end:2'));
    expect(h.profile('e')).toMatchObject({ state: 'ready', generation: 1 });
    expect(h.served('e').has('p1')).toBe(false);
  });

  it('attribute values changed mid-pass: a later build resolves the new ones, and the mark the change left is done by the next pass', async () => {
    const h = harness({
      products: 3,
      buyers: 1,
      afterSwap: (id, harness) => {
        if (id !== 'e' || harness.catalogue.get('p0')!['price'] === 20) return;
        // An attribute change committed after the everyone build: `product.updated.v1` marks the product.
        harness.catalogue.set('p0', { price: 20 });
        harness.mark('e', 'p0');
        harness.mark('b0', 'p0');
      },
    });
    await h.surface.rebuildStale();
    expect(h.served('e').get('p0')).toBe('20.0000');
    expect(h.served('b0').get('p0')).toBe('19.0000');
    expect(h.state.marks).toEqual([]);
  });

  it('a later build of the pass never resolves attribute values an earlier read saw, once a change replaced them', async () => {
    const h = harness({
      products: 2,
      buyers: 1,
      afterSwap: (id, harness) => {
        if (id === 'e') harness.catalogue.set('p0', { price: 30 });
      },
    });
    await h.surface.rebuildStale();
    // 30 − 1 for the buyer: its build read the catalogue after the change, not before.
    expect(h.served('b0').get('p0')).toBe('29.0000');
  });

  it('a whole-profile mark landing after a build read the catalogue survives the swap — a build no pass asked for included', async () => {
    const h = harness({
      products: 2,
      buyers: 1,
      everyoneRegistered: false,
      afterCatalogueRead: (n, harness) => {
        // The everyone profile, built because b0 needs it: a write marks it whole right after its read.
        if (n === 1) harness.markWhole('e');
      },
    });
    await h.surface.rebuildStale();
    // Still stale after the first swap, so a later pass rebuilt it.
    expect(h.log.filter((l) => l === 'swap:e').length).toBe(2);
    expect(h.profile('e')).toMatchObject({ state: 'ready', stale: false });
  });
});

describe('PriceSurface — the pipeline of a whole build', () => {
  it('the everyone build resolves the next batch while the previous one is written', async () => {
    const h = harness({ products: BUILD_CHUNK * 3, buyers: 0, insertMs: 10 });
    await h.surface.rebuildStale();
    expect(h.log.indexOf('resolve:start:2')).toBeLessThan(h.log.indexOf('insert:end:1'));
    expect(h.log.filter((l) => l.startsWith('insert:end')).length).toBe(3);
    expect(h.served('e').size).toBe(BUILD_CHUNK * 3);
  });

  it('a buyer build reads its comparison rows beside its resolution, and writes while the next batch resolves', async () => {
    const h = harness({ products: BUILD_CHUNK * 3, buyers: 1, insertMs: 10, resolveMs: 5, servedMs: 5 });
    await h.surface.rebuildStale();
    // The everyone build is resolutions 1–3 and inserts 1–3; the buyer's, resolutions 4–6,
    // comparison reads 1–3 and inserts 4–6.
    expect(h.log.indexOf('served:start:1')).toBeLessThan(h.log.indexOf('resolve:end:4'));
    expect(h.log.indexOf('resolve:start:5')).toBeLessThan(h.log.indexOf('insert:end:4'));
    expect(h.served('b0').size).toBe(BUILD_CHUNK * 3);
    expect([...h.served('b0').values()].every((a) => a === '9.0000')).toBe(true);
  });

  it('a write failing swaps nothing, and rolls back before the batch resolving beside it ends', async () => {
    const h = harness({ products: BUILD_CHUNK * 3, buyers: 0, failInsert: 1, insertMs: 2, resolveMs: 60 });
    const failed = h.surface.rebuildStale().then(
      () => 'resolved',
      (err: Error) => {
        h.log.push('rejected');
        return err.message;
      },
    );
    expect(await failed).toBe('insert 1 failed');
    await sleep(120);
    expect(h.log.indexOf('resolve:start:2')).toBeGreaterThan(-1);
    // The transaction is rolled back at once, not after the batch resolving beside the write.
    expect(h.log.indexOf('rollback')).toBeLessThan(h.log.indexOf('resolve:end:2'));
    expect(h.log.some((l) => l.startsWith('swap:'))).toBe(false);
    expect(h.profile('e')).toMatchObject({ state: 'building', generation: 0 });
    expect(h.state.rows).toEqual([]);
    expect(unhandled).toEqual([]);
  });

  it('a resolution failing while a batch is written swaps nothing, rolls back, and leaves no unhandled rejection', async () => {
    const h = harness({ products: BUILD_CHUNK * 3, buyers: 0, failResolve: 2, insertMs: 30 });
    await expect(h.surface.rebuildStale()).rejects.toThrow('resolution 2 failed');
    await sleep(60);
    expect(h.log.some((l) => l.startsWith('swap:'))).toBe(false);
    expect(h.profile('e')).toMatchObject({ state: 'building', generation: 0 });
    expect(h.state.rows).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

describe('isVanishedProduct — what the driver answers for a product deleted under a build', () => {
  const pg = (code: string, constraint: string) =>
    Object.assign(new Error(`violates constraint "${constraint}"`), { code, constraint, table: 'price_profile_prices' });

  it('is the foreign key of price_profile_prices.product_id, as MikroORM wraps it', () => {
    expect(isVanishedProduct(new ForeignKeyConstraintViolationException(pg('23503', 'price_profile_prices_product_id_foreign')))).toBe(true);
  });

  it('reads the constraint from the error’s cause when the wrapper does not carry it', () => {
    const wrapped = new ForeignKeyConstraintViolationException(new Error('fk'));
    Object.defineProperty(wrapped, 'cause', { value: pg('23503', 'price_profile_prices_product_id_foreign') });
    expect(isVanishedProduct(wrapped)).toBe(true);
  });

  it('is not another foreign key, another violation or another error', () => {
    expect(isVanishedProduct(new ForeignKeyConstraintViolationException(pg('23503', 'price_profile_prices_profile_id_foreign')))).toBe(false);
    expect(isVanishedProduct(new UniqueConstraintViolationException(pg('23505', 'price_profile_prices_pkey')))).toBe(false);
    expect(isVanishedProduct(new Error('price_profile_prices_product_id_foreign'))).toBe(false);
    expect(isVanishedProduct(null)).toBe(false);
  });
});

describe('PriceSurface.hasPendingWork — what the worker checks when a job completes (issue #427)', () => {
  it('answers whether a pass would find work: never-built, a product mark, a whole-profile mark', async () => {
    const h = harness({ products: 2, buyers: 1 });
    await expect(h.surface.hasPendingWork()).resolves.toBe(true);
    await h.surface.rebuildStale();
    await expect(h.surface.hasPendingWork()).resolves.toBe(false);
    h.mark('b0', 'p0');
    await expect(h.surface.hasPendingWork()).resolves.toBe(true);
    await h.surface.rebuildStale();
    await expect(h.surface.hasPendingWork()).resolves.toBe(false);
    h.markWhole('e');
    await expect(h.surface.hasPendingWork()).resolves.toBe(true);
    await h.surface.rebuildStale();
    await expect(h.surface.hasPendingWork()).resolves.toBe(false);
  });
});
