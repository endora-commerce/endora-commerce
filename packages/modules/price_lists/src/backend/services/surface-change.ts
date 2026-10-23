import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * What a pricing change concerns on the price surface — feature 160,
 * `contracts/price-surface.md` §4 (owner ruling 2026-10-23: implement the
 * targeted refresh of the trigger table, not a rebuild of every profile).
 *
 * A writer describes its change; `PriceSurface.markChanged` turns the
 * description into marks at (profile) and (profile, product) granularity, and
 * the worker re-resolves only what is marked. The description is the writer's
 * because only the writer knows what it changed (a book's channels before a
 * channel-set write, a deleted book's rows); the profiles it reaches are the
 * surface's, because only the surface knows which profiles exist.
 *
 * The pricing cache is not narrowed by any of this: every change still bumps
 * `PricingGeneration`, which clears every process's cached prices as before.
 */

/** One selection of a book row: which coordinates are set (the price is not needed). */
export interface RowSelection {
  productId: string | null;
  categoryId: string | null;
  attributeKey: string | null;
}

/** What the surface needs to know about a book to find the profiles it reaches. */
export interface SurfaceBookFacts {
  bookId: string;
  currencyCode: string;
  audienceKind: 'everyone' | 'organizations' | 'customer_groups';
  isSystem: boolean;
  /** The book's channel set; absent, the surface reads the current one. */
  channelIds?: readonly string[];
  /** `active` or `scheduled` — it prices, or will by its dates. A book that is neither prices nowhere. */
  live: boolean;
}

/** One book's change: its facts before and after, and the rows whose products moved. */
export interface SurfaceBookChange {
  facts: readonly SurfaceBookFacts[];
  /** The rows concerned, or `'stored'` for every row the book holds now. */
  selections: readonly RowSelection[] | 'stored';
  /** The book is gone: the buyer profiles whose vector holds it can never be asked for again. */
  retire?: boolean;
}

export type SurfaceChange =
  /** Nothing the surface stores moved (a display mode, a name). */
  | { kind: 'none' }
  /** Every profile, rebuilt — the default when a writer says nothing, and the precedence (P3). */
  | { kind: 'all' }
  /** Every profile of these channels, rebuilt (a channel's currencies or identity). */
  | { kind: 'channels'; channelIds?: readonly string[]; channelCodes?: readonly string[] }
  /** Books: header, status, channel set, members, rows, deletion, a status sweep. */
  | { kind: 'books'; books: readonly SurfaceBookChange[] }
  /** Products, in every profile (of these currencies, when named): base prices, catalogue product events. */
  | { kind: 'products'; productIds: readonly string[]; currencyCodes?: readonly string[] }
  /** The products of these categories' subtrees, in every profile. */
  | { kind: 'categories'; categoryIds: readonly string[] }
  /** The products the rows naming these attributes select, in the profiles of those books. */
  | { kind: 'attributes'; attributeKeys: readonly string[] };

export const isLiveStatus = (status: string): boolean => status === 'active' || status === 'scheduled';

/** A profile as the marking reads it. */
export interface SurfaceProfileRef {
  id: string;
  channelId: string;
  currencyCode: string;
  /** The buyer books of its vector; empty for an everyone profile. */
  bookIds: readonly string[];
}

/**
 * The profiles one change reaches, at two levels:
 *
 * - **own** — profiles whose vector holds a changed buyer book: every product
 *   the change concerns may move there;
 * - **shared** — profiles that share a changed everyone or base book: the
 *   everyone profile takes every product, and a buyer profile only the
 *   products {@link planMarks} finds relevant to it (a buyer surface stores
 *   only what differs from the everyone surface, so a product no buyer book of
 *   the profile can select, and of which the profile holds no row, answers
 *   what the everyone profile answers — before the change and after it).
 */
export interface ChangeTargets {
  own: SurfaceProfileRef[];
  shared: SurfaceProfileRef[];
}

/** The book facts with their channel sets resolved. */
export type ResolvedBookFacts = SurfaceBookFacts & { channelIds: readonly string[] };

export function targetsForBooks(facts: readonly ResolvedBookFacts[], profiles: readonly SurfaceProfileRef[]): ChangeTargets {
  const own = new Map<string, SurfaceProfileRef>();
  const shared = new Map<string, SurfaceProfileRef>();
  for (const f of facts) {
    if (!f.live) continue;
    const currency = f.currencyCode.trim().toUpperCase();
    if (f.isSystem || f.audienceKind === 'everyone') {
      const channels = new Set(f.channelIds);
      for (const p of profiles) {
        if (p.currencyCode !== currency) continue;
        // A base book is channel-independent (D-287 §5.1); an everyone book reaches its channels.
        if (!f.isSystem && !channels.has(p.channelId)) continue;
        shared.set(p.id, p);
      }
      continue;
    }
    for (const p of profiles) if (p.bookIds.includes(f.bookId)) own.set(p.id, p);
  }
  for (const id of own.keys()) shared.delete(id);
  return { own: [...own.values()], shared: [...shared.values()] };
}

export function targetsForProducts(profiles: readonly SurfaceProfileRef[], currencyCodes?: readonly string[]): ChangeTargets {
  const currencies = currencyCodes ? new Set(currencyCodes.map((c) => c.trim().toUpperCase())) : null;
  return { own: [], shared: profiles.filter((p) => !currencies || currencies.has(p.currencyCode)) };
}

/**
 * The products a set of row selections can price: a product (or variant) row
 * its product, a category row (with or without an attribute) the products
 * assigned to the category — the resolver matches a category row on the
 * product's own assignments, not on descendants — and an attribute-only or an
 * all-products row **every** product (`'all'`): which products carry an
 * attribute is not a question `catalog`'s ports answer without reading the
 * catalogue, and an all-products row moves every price anyway.
 */
export async function productsOfSelections(
  selections: readonly RowSelection[],
  productIdsInCategory: (categoryId: string) => Promise<readonly string[]>,
): Promise<Set<string> | 'all'> {
  const out = new Set<string>();
  const categories = new Set<string>();
  for (const s of selections) {
    if (s.productId !== null) out.add(s.productId);
    else if (s.categoryId !== null) categories.add(s.categoryId);
    else return 'all';
  }
  for (const categoryId of categories) for (const id of await productIdsInCategory(categoryId)) out.add(id);
  return out;
}

/** The books whose rows may select each product, as {@link selectingBooks} answers it. */
export interface SelectingBooks {
  /** product → books with a row naming it, or a category row on one of its categories. */
  byProduct: ReadonlyMap<string, ReadonlySet<string>>;
  /** Books with an attribute-only or an all-products row: they may select any product. */
  any: ReadonlySet<string>;
}

/** The marks one change leaves: profiles to rebuild whole, and products to refresh per profile. */
export interface MarkPlan {
  full: Set<string>;
  products: Map<string, Set<string>>;
}

export function emptyPlan(): MarkPlan {
  return { full: new Set(), products: new Map() };
}

export function mergePlan(into: MarkPlan, plan: MarkPlan): MarkPlan {
  for (const id of plan.full) into.full.add(id);
  for (const [id, products] of plan.products) {
    const held = into.products.get(id);
    if (held) for (const p of products) held.add(p);
    else into.products.set(id, new Set(products));
  }
  for (const id of into.full) into.products.delete(id);
  return into;
}

/**
 * The marks of one change: every target rebuilt whole when the change concerns
 * every product (or more than `partialLimit` of them); otherwise an own target
 * takes every product, an everyone profile among the shared targets every
 * product, and a buyer profile among them the products a book of its vector may
 * select or of which it holds a row.
 */
export function planMarks(input: {
  targets: ChangeTargets;
  products: ReadonlySet<string> | 'all';
  selecting: SelectingBooks;
  /** profile → the products (among `products`) its served surface holds a row for. */
  held: ReadonlyMap<string, ReadonlySet<string>>;
  partialLimit: number;
}): MarkPlan {
  const plan = emptyPlan();
  const { targets, products } = input;
  if (products === 'all' || products.size > input.partialLimit) {
    for (const p of [...targets.own, ...targets.shared]) plan.full.add(p.id);
    return plan;
  }
  if (products.size === 0) return plan;
  for (const p of targets.own) plan.products.set(p.id, new Set(products));
  for (const p of targets.shared) {
    if (p.bookIds.length === 0) {
      plan.products.set(p.id, new Set(products));
      continue;
    }
    const books = new Set(p.bookIds);
    const anyBook = p.bookIds.some((b) => input.selecting.any.has(b));
    const held = input.held.get(p.id);
    const relevant = new Set<string>();
    for (const productId of products) {
      if (anyBook || held?.has(productId)) {
        relevant.add(productId);
        continue;
      }
      const selecting = input.selecting.byProduct.get(productId);
      if (selecting && [...selecting].some((b) => books.has(b))) relevant.add(productId);
    }
    if (relevant.size > 0) plan.products.set(p.id, relevant);
  }
  return plan;
}

const uuidArray = (ids: readonly string[]): string => `{${ids.join(',')}}`;

/** The distinct row selections of these books, now — one statement. */
export async function storedSelections(em: EntityManager, bookIds: readonly string[]): Promise<RowSelection[]> {
  if (bookIds.length === 0) return [];
  const rows = await em.execute<Array<{ product_id: string | null; category_id: string | null; attribute_key: string | null }>>(
    `select distinct "product_id", "category_id", "attribute_key"
       from "price_list_matrix_entries" where "price_list_id" = any(?::uuid[])`,
    [uuidArray(bookIds)],
  );
  return rows.map((r) => ({ productId: r.product_id, categoryId: r.category_id, attributeKey: r.attribute_key }));
}

/**
 * Which of `bookIds` may select each of `productIds` — two statements and, when
 * a category row is among them, one call for the products' category
 * assignments. Over-inclusive by design (an attribute-only row may select
 * anything; a category ∩ attribute row is read as its category), never under.
 */
export async function selectingBooks(
  em: EntityManager,
  bookIds: readonly string[],
  productIds: readonly string[],
  assignments: (productIds: readonly string[]) => Promise<ReadonlyArray<{ productId: string; categoryId: string }>>,
): Promise<SelectingBooks> {
  const byProduct = new Map<string, Set<string>>();
  const any = new Set<string>();
  if (bookIds.length === 0 || productIds.length === 0) return { byProduct, any };
  const add = (productId: string, bookId: string) => {
    const held = byProduct.get(productId);
    if (held) held.add(bookId);
    else byProduct.set(productId, new Set([bookId]));
  };
  const rows = await em.execute<Array<{ price_list_id: string; product_id: string | null; category_id: string | null }>>(
    `select distinct "price_list_id", "product_id", "category_id"
       from "price_list_matrix_entries"
      where "price_list_id" = any(?::uuid[])
        and ("product_id" = any(?::uuid[]) or "product_id" is null)`,
    [uuidArray(bookIds), uuidArray(productIds)],
  );
  const byCategory = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.product_id !== null) add(r.product_id, r.price_list_id);
    else if (r.category_id !== null) {
      const held = byCategory.get(r.category_id);
      if (held) held.add(r.price_list_id);
      else byCategory.set(r.category_id, new Set([r.price_list_id]));
    } else any.add(r.price_list_id);
  }
  if (byCategory.size > 0) {
    for (const a of await assignments(productIds)) {
      for (const bookId of byCategory.get(a.categoryId) ?? []) add(a.productId, bookId);
    }
  }
  return { byProduct, any };
}
