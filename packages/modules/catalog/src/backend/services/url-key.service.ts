import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import {
  ERROR_CODES,
  productPath,
  type ProductUrlKeysResponse,
  type PutProductUrlKeysRequest,
  type UrlKeyWriteOutcome,
  type UrlKeyRedirectTakeoverRequiredDetails,
  type UrlKeyTakenDetails,
  sameLanguage,
  toScopeChannel,
} from '@endora-commerce/contracts';
import type { Command, CommandBus, CommandEvent } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SalesChannel, effectiveState } from '@endora-commerce/platform/kernel';
import { Product } from '../entities/product.entity.js';
import { ProductUrlKey } from '../entities/product-url-key.entity.js';
import { channelUrlFactsOf } from './channel-url-facts.js';
import { ProductUrlRedirect } from '../entities/product-url-redirect.entity.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/`) — a product's URL keys per language
 * and per sales channel × language, and the redirects their changes leave behind
 * (`contracts/url-keys-and-redirects.md` §1–§3, data-model §5, research R11, R29).
 *
 * **The invariant** (FR-070, FR-072, SC-008): in no language does one key belong to
 * two products, current or redirecting. A product's keys in L are its rows of L
 * (any channel, orphans included) plus its global key (`products.slug`) where it has
 * no language key of L; a language-less redirect counts in every language. No set
 * of indexes expresses that, so every write runs as one Command that first locks the
 * product row, then takes `pg_advisory_xact_lock(hashtextextended('catalog.url-key:'
 * || key, 0))` for every key it can touch **in sorted order** (no deadlock between two
 * writers), and only then reads the other products' rows — two writers of one key are
 * serialised and the second sees the first's commit.
 *
 * The rules live in {@link planUrlKeyWrite}, a pure function the Command runs inside
 * its transaction: a refusal is a refusal of the whole request with nothing written.
 * Each write is one audit entry whose `before` is itself a valid request restoring
 * every key it touched, plus every redirect row it removed (another product's
 * included); `after` holds the keys and the redirect rows it inserted (R29 — no
 * single-write undo, Q-D → A). `product.updated.v1` follows with `['urlKeys']`.
 *
 * Without a `CommandBus` (a composition that wires none, such as a unit rig) every write
 * still runs as one transaction, so the locks hold, but it is **not audited** and
 * announces no `product.updated.v1`.
 */

const LOCK_PREFIX = 'catalog.url-key:';

// --- 168-shim: the 163 planner's own shapes ------------------------------------------
//
// Feature 168 replaced the language keys with Channel and Channel × language keys
// (`specs/168-product-editor-scope-switcher/contracts/url-keys.md`). Until T039 rewrites this
// planner on that model (one helper, `lockAndCheck`, the exclusion constraint), the 163 planner
// runs on its own request shape: Channel × language keys only, no language keys. A Channel key
// (`languageCode` absent) is refused `422 VALIDATION_FAILED` here, and redirects are written per
// (channel, language) of the product's member channels.

/** 168-shim — the 163 planner's request: Channel × language keys, `key: null` = inherit. */
export interface LegacyUrlKeysRequest {
  globalKey?: string;
  languageKeys?: Array<{ languageCode: string; key: string | null }>;
  channelKeys?: Array<{ channelId: string; languageCode: string; key: string | null }>;
  confirmTakeover?: Array<{ languageCode: string | null; key: string }>;
}

/** 168-shim — a key written by an integration: `channelId: null` = a language key (refused). */
export interface ProductUrlKeyWrite {
  languageCode: string;
  channelId: string | null;
  /** `null` = use inherited. */
  key: string | null;
}

/** 168-shim — the 168 PUT body as the 163 planner reads it. */
export function legacyRequestOf(request: PutProductUrlKeysRequest): LegacyUrlKeysRequest {
  const channelKeys = (request.channelKeys ?? []).map((entry) => {
    if (entry.languageCode == null) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Channel keys without a language arrive with T039.', {
        field: 'channelKeys',
        channelId: entry.channelId,
      });
    }
    return { channelId: entry.channelId, languageCode: entry.languageCode, key: typeof entry.key === 'string' ? entry.key : null };
  });
  return {
    ...(request.globalKey !== undefined ? { globalKey: request.globalKey } : {}),
    ...(channelKeys.length > 0 ? { channelKeys } : {}),
    ...(request.confirmTakeover ? { confirmTakeover: request.confirmTakeover.map((key) => ({ languageCode: null, key })) } : {}),
  };
}

// --- Pure planner ------------------------------------------------------------------

export interface UrlKeyRow {
  productId: string;
  languageCode: string;
  /** `null` = the language key. */
  channelId: string | null;
  key: string;
}

export interface UrlRedirectRow {
  id: string;
  productId: string;
  /** `null` = a former global key, redirecting in every language (H1). */
  languageCode: string | null;
  key: string;
}

/** Another product whose global key is one of the touched keys. */
export interface OtherProductSlug {
  productId: string;
  slug: string;
  /** The languages in which it has a language key — where its slug is *not* its key. */
  languageKeyLanguages: readonly string[];
}

/** Everything {@link planUrlKeyWrite} needs, read in the transaction after the locks. */
export interface UrlKeyWriteState {
  productId: string;
  slug: string;
  ownKeys: readonly UrlKeyRow[];
  ownRedirects: readonly UrlRedirectRow[];
  /** Other live products' key rows whose key is a touched key. */
  otherKeys: readonly UrlKeyRow[];
  /** Other products — soft-deleted ones included — whose global key is a touched key. */
  otherSlugs: readonly OtherProductSlug[];
  /** Other products' redirects whose key is a touched key. */
  otherRedirects: readonly UrlRedirectRow[];
  /** Display names for the products a refusal may name. */
  productNames: ReadonlyMap<string, string>;
  /** Every language some sales channel offers, in the channels' spelling. */
  channelLanguages: readonly string[];
  /** The product's member channels → their languages. */
  memberChannels: ReadonlyMap<string, readonly string[]>;
}

export interface UrlRedirectAuditRow {
  id?: string;
  productId: string;
  languageCode: string | null;
  key: string;
}

/** The audit projection: the PUT body's shape with every touched key explicit, plus redirect rows. */
export interface UrlKeyAuditState {
  globalKey?: string;
  languageKeys: Array<{ languageCode: string; key: string | null }>;
  channelKeys: Array<{ channelId: string; languageCode: string; key: string | null }>;
  redirects: UrlRedirectAuditRow[];
  [key: string]: unknown;
}

export interface UrlKeyWritePlan {
  /** The new global key; `null` = unchanged. */
  slug: string | null;
  /** Scopes whose key changes; `next: null` deletes the row. */
  keyRows: Array<{ languageCode: string; channelId: string | null; next: string | null }>;
  insertRedirects: Array<{ languageCode: string | null; key: string }>;
  /** The product's own rows and other products' rows taken over. */
  deleteRedirects: UrlRedirectRow[];
  before: UrlKeyAuditState;
  after: UrlKeyAuditState;
  changed: boolean;
}

interface ScopeOp {
  channelId: string | null;
  languageCode: string;
  prev: string | null;
  next: string | null;
}

const lower = (value: string): string => value.toLowerCase();

/**
 * Every key a PUT can touch, sorted and once: the keys it writes, the keys it
 * replaces at each named scope, the current and the requested global key. These
 * are the advisory locks the Command takes, and the keys whose holders it reads.
 */
export function urlKeysToLock(
  slug: string,
  ownKeys: readonly UrlKeyRow[],
  request: LegacyUrlKeysRequest,
): string[] {
  const keys = new Set<string>([slug]);
  if (request.globalKey !== undefined) keys.add(request.globalKey);
  for (const entry of request.languageKeys ?? []) {
    if (entry.key !== null) keys.add(entry.key);
    const prev = ownKeys.find((row) => row.channelId === null && sameLanguage(row.languageCode, entry.languageCode));
    if (prev) keys.add(prev.key);
  }
  for (const entry of request.channelKeys ?? []) {
    if (entry.key !== null) keys.add(entry.key);
    const prev = ownKeys.find(
      (row) => row.channelId === entry.channelId && sameLanguage(row.languageCode, entry.languageCode),
    );
    if (prev) keys.add(prev.key);
  }
  return [...keys].sort();
}

/**
 * The other products whose global key is a touched key, as the planner reads them.
 * `products.slug` is unique across soft-deleted rows too, so a deleted product is kept
 * — its global key stays taken — but its language keys no longer count, which makes
 * that key taken in **every** language (Phase 16 review: without it the planner said
 * "free" and the flush answered a unique violation as a 500).
 */
export function otherProductSlugs(
  products: ReadonlyArray<{ id: string; slug: string; deletedAt?: Date | null }>,
  languageKeys: readonly UrlKeyRow[],
): OtherProductSlug[] {
  return products.map((product) => ({
    productId: product.id,
    slug: product.slug,
    languageKeyLanguages:
      product.deletedAt != null
        ? []
        : languageKeys
            .filter((row) => row.productId === product.id && row.channelId === null)
            .map((row) => row.languageCode),
  }));
}

function collectScopeOps(state: UrlKeyWriteState, request: LegacyUrlKeysRequest): ScopeOp[] {
  const ops: ScopeOp[] = [];
  const seen = new Set<string>();
  const spelling = (requested: string, offered: readonly string[] | undefined, channelId: string | null): string =>
    offered?.find((code) => sameLanguage(code, requested)) ??
    state.ownKeys.find((row) => row.channelId === channelId && sameLanguage(row.languageCode, requested))?.languageCode ??
    requested;

  for (const entry of request.languageKeys ?? []) {
    const id = `*|${lower(entry.languageCode)}`;
    if (seen.has(id)) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A language is named more than once.', {
        field: 'languageKeys',
        languageCode: entry.languageCode,
      });
    }
    seen.add(id);
    const offered = state.channelLanguages.some((code) => sameLanguage(code, entry.languageCode));
    if (entry.key !== null && !offered) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'No sales channel offers this language.', {
        field: 'languageKeys',
        languageCode: entry.languageCode,
      });
    }
    const languageCode = spelling(entry.languageCode, state.channelLanguages, null);
    const prev = state.ownKeys.find((row) => row.channelId === null && sameLanguage(row.languageCode, languageCode));
    ops.push({ channelId: null, languageCode, prev: prev?.key ?? null, next: entry.key });
  }

  for (const entry of request.channelKeys ?? []) {
    const id = `${entry.channelId}|${lower(entry.languageCode)}`;
    if (seen.has(id)) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A channel and language are named more than once.', {
        field: 'channelKeys',
        channelId: entry.channelId,
        languageCode: entry.languageCode,
      });
    }
    seen.add(id);
    const languages = state.memberChannels.get(entry.channelId);
    // FR-014 for a value; removing an orphaned override is always allowed (FR-015).
    if (entry.key !== null) {
      if (languages === undefined) {
        throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The product is not a member of this sales channel.', {
          channelId: entry.channelId,
          reason: 'not_a_member',
        });
      }
      if (!languages.some((code) => sameLanguage(code, entry.languageCode))) {
        throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The sales channel does not offer this language.', {
          channelId: entry.channelId,
          languageCode: entry.languageCode,
          reason: 'language_not_offered',
        });
      }
    }
    const languageCode = spelling(entry.languageCode, languages, entry.channelId);
    const prev = state.ownKeys.find(
      (row) => row.channelId === entry.channelId && sameLanguage(row.languageCode, languageCode),
    );
    ops.push({ channelId: entry.channelId, languageCode, prev: prev?.key ?? null, next: entry.key });
  }
  return ops;
}

/**
 * What a URL-keys PUT writes (data-model §5's table). Pure; throws the request's
 * refusal as an `HttpError` — `URL_KEY_TAKEN` (every holder) before
 * `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` (every unconfirmed losing product), so an
 * operator is never asked to confirm a write that would be refused anyway.
 */
export function planUrlKeyWrite(state: UrlKeyWriteState, request: LegacyUrlKeysRequest): UrlKeyWritePlan {
  const ops = collectScopeOps(state, request);
  const newSlug = request.globalKey ?? state.slug;
  const slugChanged = newSlug !== state.slug;

  const finalRows: UrlKeyRow[] = [
    ...state.ownKeys.filter(
      (row) => !ops.some((op) => op.channelId === row.channelId && sameLanguage(op.languageCode, row.languageCode)),
    ),
    ...ops
      .filter((op) => op.next !== null)
      .map((op) => ({ productId: state.productId, languageCode: op.languageCode, channelId: op.channelId, key: op.next! })),
  ];
  const hasLanguageKey = (languageCode: string): boolean =>
    finalRows.some((row) => row.channelId === null && sameLanguage(row.languageCode, languageCode));
  const ownRowKeyIn = (languageCode: string, key: string): boolean =>
    finalRows.some((row) => row.key === key && sameLanguage(row.languageCode, languageCode));
  const isOwnCurrent = (languageCode: string, key: string): boolean =>
    ownRowKeyIn(languageCode, key) || (key === newSlug && !hasLanguageKey(languageCode));

  const name = (productId: string): string => state.productNames.get(productId) ?? productId;
  // 168-shim: `confirmTakeover` names keys only (R21), so a confirmation covers every language.
  const confirmed = (_languageCode: string | null, key: string): boolean =>
    (request.confirmTakeover ?? []).some((entry) => entry.key === key);

  /** Other products holding `key` as a current key in `languageCode` (`null` = in any language). */
  const otherCurrent = (languageCode: string | null, key: string): Array<{ productId: string; languageCode: string | null }> => {
    const out: Array<{ productId: string; languageCode: string | null }> = [];
    for (const row of state.otherKeys) {
      if (row.key !== key) continue;
      if (languageCode === null || sameLanguage(row.languageCode, languageCode)) {
        out.push({ productId: row.productId, languageCode: languageCode ?? row.languageCode });
      }
    }
    for (const other of state.otherSlugs) {
      if (other.slug !== key) continue;
      if (languageCode === null || !other.languageKeyLanguages.some((code) => sameLanguage(code, languageCode))) {
        out.push({ productId: other.productId, languageCode });
      }
    }
    return out;
  };
  /** Other products' redirects with `key` in `languageCode` — a language-less one counts in every language. */
  const otherRedirects = (languageCode: string | null, key: string): UrlRedirectRow[] =>
    state.otherRedirects.filter(
      (row) =>
        row.key === key &&
        (languageCode === null || row.languageCode === null || sameLanguage(row.languageCode, languageCode)),
    );

  const conflicts = new Map<string, UrlKeyTakenDetails['conflicts'][number]>();
  const takeovers = new Map<string, UrlKeyRedirectTakeoverRequiredDetails['takeovers'][number]>();
  const taken = new Map<string, UrlRedirectRow>();
  const ownDeletes = new Map<string, UrlRedirectRow>();
  const candidates: Array<{ languageCode: string; key: string; forced: boolean }> = [];

  /** `key` becomes one of the product's keys in `languageCode` (`null` = in every language). */
  const claim = (languageCode: string | null, key: string): void => {
    for (const holder of otherCurrent(languageCode, key)) {
      conflicts.set(`${holder.languageCode ?? '*'}|${key}|${holder.productId}`, {
        channelId: null,
        languageCode: holder.languageCode,
        key,
        heldByProductId: holder.productId,
        heldByProductName: name(holder.productId),
      });
    }
    for (const row of otherRedirects(languageCode, key)) {
      if (confirmed(row.languageCode, key)) {
        taken.set(row.id, row);
      } else {
        takeovers.set(row.id, {
          channelId: null,
          languageCode: row.languageCode,
          key,
          losingProductId: row.productId,
          losingProductName: name(row.productId),
        });
      }
    }
  };
  const dropOwnRedirect = (languageCode: string, key: string): void => {
    for (const row of state.ownRedirects) {
      if (row.languageCode !== null && row.key === key && sameLanguage(row.languageCode, languageCode)) {
        ownDeletes.set(row.id, row);
      }
    }
  };

  for (const op of ops) {
    if (op.prev === op.next) continue;
    if (op.next !== null) {
      claim(op.languageCode, op.next);
      // The product's own redirect of this language becomes current again (no self-redirect);
      // its own language-less redirect stays, serving every other language (H1).
      dropOwnRedirect(op.languageCode, op.next);
      if (op.prev !== null) {
        candidates.push({ languageCode: op.languageCode, key: op.prev, forced: false });
      } else if (op.channelId === null && !slugChanged) {
        // The first language key: the global key becomes a redirect in L only (FR-072 consequence 1).
        candidates.push({ languageCode: op.languageCode, key: state.slug, forced: false });
      }
    } else {
      if (op.channelId === null) {
        // "Use inherited": the global key is the product's key in L again — checked as a
        // write of it, unless no channel offers L (an orphan's removal is always allowed).
        if (state.channelLanguages.some((code) => sameLanguage(code, op.languageCode))) claim(op.languageCode, newSlug);
        dropOwnRedirect(op.languageCode, newSlug);
      }
      candidates.push({ languageCode: op.languageCode, key: op.prev!, forced: false });
    }
  }

  if (slugChanged) {
    claim(null, newSlug);
    for (const row of state.ownRedirects) {
      if (row.key !== newSlug) continue;
      if (row.languageCode === null) {
        // Its own language-less redirect written back: replaced per language in which the
        // product holds a language or channel × language key (there the slug is not its key).
        ownDeletes.set(row.id, row);
        const held = new Map<string, string>();
        for (const own of finalRows) held.set(lower(own.languageCode), own.languageCode);
        for (const languageCode of held.values()) candidates.push({ languageCode, key: newSlug, forced: true });
      } else if (!hasLanguageKey(row.languageCode)) {
        ownDeletes.set(row.id, row);
      }
    }
  }

  if (conflicts.size > 0) {
    throw new HttpError(409, ERROR_CODES.URL_KEY_TAKEN, 'This URL key is already used by another product.', {
      conflicts: [...conflicts.values()],
    } satisfies UrlKeyTakenDetails);
  }
  if (takeovers.size > 0) {
    throw new HttpError(
      409,
      ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED,
      "This URL key redirects to another product; confirm taking it over.",
      { takeovers: [...takeovers.values()] } satisfies UrlKeyRedirectTakeoverRequiredDetails,
    );
  }

  const inserts = new Map<string, { languageCode: string | null; key: string }>();
  const ownRedirectStays = (languageCode: string | null, key: string): boolean =>
    state.ownRedirects.some(
      (row) =>
        row.key === key &&
        !ownDeletes.has(row.id) &&
        (languageCode === null ? row.languageCode === null : row.languageCode !== null && sameLanguage(row.languageCode, languageCode)),
    );
  const freeOfOthers = (languageCode: string, key: string): boolean =>
    otherCurrent(languageCode, key).length === 0 && otherRedirects(languageCode, key).every((row) => taken.has(row.id));
  const addRedirect = (candidate: { languageCode: string; key: string; forced: boolean }): void => {
    if (candidate.forced ? ownRowKeyIn(candidate.languageCode, candidate.key) : isOwnCurrent(candidate.languageCode, candidate.key)) {
      return;
    }
    if (ownRedirectStays(candidate.languageCode, candidate.key)) return;
    if (!freeOfOthers(candidate.languageCode, candidate.key)) return;
    inserts.set(`${lower(candidate.languageCode)}|${candidate.key}`, {
      languageCode: candidate.languageCode,
      key: candidate.key,
    });
  };
  for (const candidate of candidates) addRedirect(candidate);

  if (slugChanged) {
    // The old global key: one language-less redirect when no other product holds it in any
    // language; otherwise one per language where it is free, none where it is taken (HIGH-2).
    const old = state.slug;
    const othersHold =
      otherCurrent(null, old).length > 0 || otherRedirects(null, old).some((row) => !taken.has(row.id));
    if (!othersHold) {
      if (!ownRedirectStays(null, old)) inserts.set(`*|${old}`, { languageCode: null, key: old });
    } else {
      const languages = new Map<string, string>();
      for (const code of state.channelLanguages) languages.set(lower(code), code);
      for (const languageCode of languages.values()) addRedirect({ languageCode, key: old, forced: false });
    }
  }

  const deleteRedirects = [...ownDeletes.values(), ...taken.values()];
  const keyRows = ops
    .filter((op) => op.prev !== op.next)
    .map((op) => ({ languageCode: op.languageCode, channelId: op.channelId, next: op.next }));
  const insertRedirects = [...inserts.values()];

  const projection = (
    pick: 'prev' | 'next',
  ): Pick<UrlKeyAuditState, 'languageKeys' | 'channelKeys'> & { globalKey?: string } => ({
    ...(request.globalKey !== undefined ? { globalKey: pick === 'prev' ? state.slug : newSlug } : {}),
    languageKeys: ops
      .filter((op) => op.channelId === null)
      .map((op) => ({ languageCode: op.languageCode, key: op[pick] })),
    channelKeys: ops
      .filter((op) => op.channelId !== null)
      .map((op) => ({ channelId: op.channelId!, languageCode: op.languageCode, key: op[pick] })),
  });

  return {
    slug: slugChanged ? newSlug : null,
    keyRows,
    insertRedirects,
    deleteRedirects,
    before: {
      ...projection('prev'),
      redirects: deleteRedirects.map((row) => ({
        id: row.id,
        productId: row.productId,
        languageCode: row.languageCode,
        key: row.key,
      })),
    },
    after: {
      ...projection('next'),
      redirects: insertRedirects.map((row) => ({ productId: state.productId, ...row })),
    },
    changed: slugChanged || keyRows.length > 0 || insertRedirects.length > 0 || deleteRedirects.length > 0,
  };
}

// --- Database helpers shared with the product write paths ----------------------------

/**
 * Take the advisory lock of every key, in sorted order. Must run inside the caller's
 * transaction: the locks are released when it ends.
 */
export async function lockUrlKeys(em: EntityManager, keys: readonly string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await em.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`${LOCK_PREFIX}${key}`]);
  }
}

/**
 * Whether `key` is free to become a **new** product's global key (A-11): not a
 * product's global key (any product — `products.slug` is unique), and not a current
 * or redirecting key of a live product in any language. Used by slug allocation on
 * create and duplicate, which holds the key's lock while it decides.
 */
export async function isUrlKeyFree(em: EntityManager, key: string): Promise<boolean> {
  const rows = (await em.execute(
    `select 1 from "products" where "slug" = ?
     union all
     select 1 from "product_url_keys" k join "products" p on p."id" = k."product_id"
       where k."key" = ? and p."deleted_at" is null
     union all
     select 1 from "product_url_redirects" where "key" = ?
     limit 1`,
    [key, key, key],
  )) as unknown[];
  return rows.length === 0;
}

// --- The service ---------------------------------------------------------------------

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A `:id` that is not a UUID names no product: 404, before Postgres refuses the cast as a 500. */
function assertProductIdShape(productId: string): void {
  if (!UUID_SHAPE.test(productId)) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
}

function displayName(product: Pick<Product, 'name' | 'sku'>): string {
  return product.name?.trim() ? product.name : product.sku;
}

/** 168-shim: a Channel key row (no language) is not a row the 163 planner can read; none is written yet. */
function toKeyRow(row: ProductUrlKey): UrlKeyRow {
  return { productId: row.productId, languageCode: row.languageCode ?? '', channelId: row.salesChannelId, key: row.key };
}

function toRedirectRow(row: ProductUrlRedirect): UrlRedirectRow {
  return { id: row.id, productId: row.productId, languageCode: row.languageCode ?? null, key: row.key };
}

function urlKeysUpdatedEvent(
  productId: string,
): CommandEvent<{ eventId: string; occurredAt: string; productId: string; changedFields: string[] }> {
  return {
    eventName: 'product.updated.v1',
    payload: { eventId: randomUUID(), occurredAt: new Date().toISOString(), productId, changedFields: ['urlKeys'] },
  };
}

/**
 * The import-mode issue for a "taken" refusal of `write` (FR-093), or `null` when
 * the refusal is of another kind and refuses the whole call.
 */
function takenIssue(
  err: unknown,
  write: ProductUrlKeyWrite,
): Extract<UrlKeyWriteOutcome, { written: false }>['issue'] | null {
  if (!(err instanceof HttpError)) return null;
  const details = (err.details ?? {}) as Partial<UrlKeyTakenDetails & UrlKeyRedirectTakeoverRequiredDetails>;
  if (err.code === ERROR_CODES.URL_KEY_TAKEN && details.conflicts?.[0]) {
    const conflict = details.conflicts[0];
    return {
      languageCode: write.languageCode,
      channelId: write.channelId,
      key: conflict.key,
      heldByProductId: conflict.heldByProductId,
      kind: 'current',
    };
  }
  if (err.code === ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED && details.takeovers?.[0]) {
    const takeover = details.takeovers[0];
    return {
      languageCode: write.languageCode,
      channelId: write.channelId,
      key: takeover.key,
      heldByProductId: takeover.losingProductId,
      kind: 'redirect',
    };
  }
  return null;
}

/** An integration's keys as the PUT body the planner reads. */
export function importRequest(entries: readonly ProductUrlKeyWrite[]): LegacyUrlKeysRequest {
  const languageKeys = entries
    .filter((entry) => entry.channelId === null)
    .map((entry) => ({ languageCode: entry.languageCode, key: entry.key }));
  const channelKeys = entries
    .filter((entry): entry is ProductUrlKeyWrite & { channelId: string } => entry.channelId !== null)
    .map((entry) => ({ channelId: entry.channelId, languageCode: entry.languageCode, key: entry.key }));
  return {
    ...(languageKeys.length > 0 ? { languageKeys } : {}),
    ...(channelKeys.length > 0 ? { channelKeys } : {}),
  };
}

/**
 * Import mode (FR-093), pure: each key is admitted only if the keys admitted before
 * it plus this one plan without a "taken" refusal; a refused key is reported with
 * its holder and left out, so the product keeps its previous key there. Any other
 * refusal is thrown — it refuses the whole call. Never passes `confirmTakeover`.
 */
export function admitImportKeys(
  state: UrlKeyWriteState,
  writes: readonly ProductUrlKeyWrite[],
): { accepted: ProductUrlKeyWrite[]; outcomes: UrlKeyWriteOutcome[] } {
  const accepted: ProductUrlKeyWrite[] = [];
  const outcomes: UrlKeyWriteOutcome[] = [];
  for (const write of writes) {
    try {
      planUrlKeyWrite(state, importRequest([...accepted, write]));
      accepted.push(write);
      outcomes.push({ written: true });
    } catch (err) {
      const issue = takenIssue(err, write);
      if (issue === null) throw err;
      outcomes.push({ written: false, issue });
    }
  }
  return { accepted, outcomes };
}

export class UrlKeyService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly membership: SalesChannelMembershipPort,
    private readonly commandBus?: CommandBus,
    /**
     * Whether `seo` is effectively present: it decides whether redirects are part
     * of the answer (Q-C, Constitution XVII). Writes never ask it.
     */
    private readonly seoPresent: () => boolean = () => effectiveState.isPresent('seo'),
  ) {}

  /** `GET /admin/catalog/products/:id/url-keys` (§1). */
  async read(productId: string): Promise<ProductUrlKeysResponse['data']> {
    assertProductIdShape(productId);
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: productId, deletedAt: null });
    if (!product) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    const [members, keyRows, redirects] = await Promise.all([
      this.membership.listChannelsForEntity('product', productId),
      em.find(ProductUrlKey, { productId }),
      em.find(ProductUrlRedirect, { productId }),
    ]);
    const memberById = new Map(members.map((channel) => [channel.id, channel]));
    const channelKeys = [...keyRows].sort(
      (a, b) =>
        a.salesChannelId.localeCompare(b.salesChannelId) || (a.languageCode ?? '').localeCompare(b.languageCode ?? ''),
    );

    const effective: ProductUrlKeysResponse['data']['effective'] = [];
    for (const channel of [...members].sort((a, b) => a.code.localeCompare(b.code))) {
      for (const languageCode of toScopeChannel(channel).languages) {
        const clKey = channelKeys.find(
          (row) => row.salesChannelId === channel.id && row.languageCode !== null && sameLanguage(row.languageCode, languageCode),
        );
        const cKey = channelKeys.find((row) => row.salesChannelId === channel.id && row.languageCode === null);
        const [key, source] = clKey
          ? [clKey.key, 'channel_language' as const]
          : cKey
            ? [cKey.key, 'channel' as const]
            : [product.slug, 'global' as const];
        effective.push({
          channelId: channel.id,
          languageCode,
          key,
          source,
          url: productPath({ key, languageCode, channel: channelUrlFactsOf(channel) }),
        });
      }
    }

    // Q-C: the redirect list is `seo`'s surface — omitted while it is off. The rows
    // stay, keep reserving their keys, and come back with it (FR-111).
    const listRedirects = this.seoPresent();
    return {
      globalKey: product.slug,
      channelKeys: channelKeys.map((row) => {
        const channel = memberById.get(row.salesChannelId);
        return {
          channelId: row.salesChannelId,
          languageCode: row.languageCode,
          key: row.key,
          orphaned:
            !channel ||
            (row.languageCode !== null &&
              !toScopeChannel(channel).languages.some((code) => sameLanguage(code, row.languageCode))),
        };
      }),
      effective,
      ...(listRedirects
        ? {
            redirects: redirects
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.key.localeCompare(b.key))
              .map((row) => ({
                id: row.id,
                channelId: row.salesChannelId,
                languageCode: row.languageCode,
                key: row.key,
                createdAt: row.createdAt.toISOString(),
              })),
          }
        : {}),
    };
  }

  /** `PUT /admin/catalog/products/:id/url-keys` (§2) — answers the keys as `read` does. */
  async update(productId: string, request: PutProductUrlKeysRequest): Promise<ProductUrlKeysResponse['data']> {
    assertProductIdShape(productId);
    await this.#run(this.#updateCommand(productId, request));
    return this.read(productId);
  }

  /** `DELETE /admin/catalog/products/:id/url-redirects/:redirectId` (§3). */
  async deleteRedirect(productId: string, redirectId: string): Promise<void> {
    if (!UUID_SHAPE.test(productId) || !UUID_SHAPE.test(redirectId)) {
      throw new HttpError(404, ERROR_CODES.URL_REDIRECT_NOT_FOUND, 'Redirect not found.', { redirectId });
    }
    await this.#run(this.#deleteRedirectCommand(productId, redirectId));
  }

  async #run<T>(command: Command<T>): Promise<T> {
    if (this.commandBus) return this.commandBus.run(command);
    return this.emFactory().transactional(async (em) => {
      const outcome = await command.run({
        em,
        actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' },
      });
      return outcome.result;
    });
  }

  /**
   * Inside a Command's transaction: lock the product row (one writer per product),
   * take every touched key's advisory lock in sorted order, then read the state the
   * planner decides on. `keys` must cover every key any request planned against it
   * can touch.
   */
  async #lockAndLoad(
    em: EntityManager,
    productId: string,
    keysFor: (slug: string, ownKeys: readonly UrlKeyRow[]) => string[],
  ): Promise<{ product: Product; ownKeyEntities: ProductUrlKey[]; state: UrlKeyWriteState }> {
    const locked = (await em.execute(
      `select "id" from "products" where "id" = ? and "deleted_at" is null for update`,
      [productId],
    )) as unknown[];
    if (locked.length === 0) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    const product = await em.findOneOrFail(Product, { id: productId });
    const ownKeyEntities = await em.find(ProductUrlKey, { productId });
    const ownKeys = ownKeyEntities.map(toKeyRow);
    const keys = keysFor(product.slug, ownKeys);
    await lockUrlKeys(em, keys);

    const [ownRedirects, otherKeys, otherRedirects, otherSlugProducts, channels, members] = await Promise.all([
      em.find(ProductUrlRedirect, { productId }),
      em.find(ProductUrlKey, { key: { $in: keys }, productId: { $ne: productId } }),
      em.find(ProductUrlRedirect, { key: { $in: keys }, productId: { $ne: productId } }),
      // Deleted products included: `products.slug` is unique across them (`otherProductSlugs`).
      em.find(Product, { slug: { $in: keys }, id: { $ne: productId } }),
      em.find(SalesChannel, {}),
      this.membership.listChannelsForEntity('product', productId),
    ]);
    const holderIds = [...new Set([...otherKeys.map((row) => row.productId), ...otherRedirects.map((row) => row.productId)])];
    const holders = holderIds.length === 0 ? [] : await em.find(Product, { id: { $in: holderIds } });
    const liveHolders = new Set(holders.filter((p) => p.deletedAt == null).map((p) => p.id));
    const liveSlugProductIds = otherSlugProducts.filter((p) => p.deletedAt == null).map((p) => p.id);
    const slugLanguageKeys =
      liveSlugProductIds.length === 0
        ? []
        : await em.find(ProductUrlKey, { productId: { $in: liveSlugProductIds }, salesChannelId: null });
    const channelLanguages = new Map<string, string>();
    for (const channel of channels) {
      for (const code of toScopeChannel(channel).languages) if (!channelLanguages.has(lower(code))) channelLanguages.set(lower(code), code);
    }
    return {
      product,
      ownKeyEntities,
      state: {
        productId,
        slug: product.slug,
        ownKeys,
        ownRedirects: ownRedirects.map(toRedirectRow),
        otherKeys: otherKeys.filter((row) => liveHolders.has(row.productId)).map(toKeyRow),
        otherSlugs: otherProductSlugs(otherSlugProducts, slugLanguageKeys.map(toKeyRow)),
        otherRedirects: otherRedirects.map(toRedirectRow),
        productNames: new Map([...holders, ...otherSlugProducts].map((p) => [p.id, displayName(p)])),
        channelLanguages: [...channelLanguages.values()],
        memberChannels: new Map(members.map((channel) => [channel.id, toScopeChannel(channel).languages])),
      },
    };
  }

  /** Writes a plan the planner answered; answers the redirect rows it inserted. */
  async #applyPlan(
    em: EntityManager,
    productId: string,
    product: Product,
    ownKeyEntities: readonly ProductUrlKey[],
    plan: UrlKeyWritePlan,
    memberChannels: ReadonlyMap<string, readonly string[]>,
  ): Promise<UrlRedirectAuditRow[]> {
    if (plan.deleteRedirects.length > 0) {
      await em.nativeDelete(ProductUrlRedirect, { id: { $in: plan.deleteRedirects.map((row) => row.id) } });
    }
    for (const { languageCode, channelId, next } of plan.keyRows) {
      const row = ownKeyEntities.find(
        (entity) => entity.salesChannelId === channelId && sameLanguage(entity.languageCode, languageCode),
      );
      if (next === null) {
        if (row) em.remove(row);
      } else if (row) {
        row.key = next;
      } else if (channelId !== null) {
        em.persist(
          em.create(ProductUrlKey, { id: randomUUID(), productId, languageCode, salesChannelId: channelId, key: next }),
        );
      }
    }
    if (plan.slug !== null) product.slug = plan.slug;
    // 168-shim: a redirect answers at one (channel, language) now — the planner's language (or
    // every language, for a former Global key) at each member channel offering it.
    const inserted = plan.insertRedirects.flatMap((row) =>
      [...memberChannels].flatMap(([salesChannelId, languages]) =>
        languages
          .filter((code) => row.languageCode === null || sameLanguage(code, row.languageCode))
          .map((languageCode) => ({ id: randomUUID(), productId, salesChannelId, languageCode, key: row.key })),
      ),
    );
    for (const row of inserted) em.persist(em.create(ProductUrlRedirect, row));
    await em.flush();
    return inserted;
  }

  #updateCommand(productId: string, body: PutProductUrlKeysRequest): Command<{ changed: boolean }> {
    const request = legacyRequestOf(body);
    return {
      action: 'product.url_keys.update',
      objectType: 'product',
      objectId: productId,
      run: async ({ em }) => {
        const { product, ownKeyEntities, state } = await this.#lockAndLoad(em, productId, (slug, ownKeys) =>
          urlKeysToLock(slug, ownKeys, request),
        );
        const plan = planUrlKeyWrite(state, request);
        if (!plan.changed) return { result: { changed: false }, skipAudit: true };
        const inserted = await this.#applyPlan(em, productId, product, ownKeyEntities, plan, state.memberChannels);
        return {
          result: { changed: true },
          before: plan.before,
          after: { ...plan.after, redirects: inserted, changedFields: ['urlKeys'] },
        };
      },
      event: ({ changed }) => (changed ? urlKeysUpdatedEvent(productId) : undefined),
    };
  }

  /**
   * `catalogProductScopeWritePort.applyScopes(…).urlKeys` (contract §5, FR-093) —
   * an integration's keys, in import mode: each key the operator's write would
   * refuse as **taken** (another product's current key, or another product's
   * redirect) is not written and comes back as an issue naming the holder, and the
   * product keeps its previous key at that scope. A redirect is never taken over
   * and nothing asks for confirmation — that is an operator's act (FR-072). Every
   * other refusal (a channel the product is not in, a language no channel offers)
   * refuses the call, as the admin write does.
   *
   * One Command for the call: the accepted keys are written together, one audit
   * entry, `product.updated.v1` with `['urlKeys']` when anything changed.
   */
  async importKeys(productId: string, writes: readonly ProductUrlKeyWrite[], source: string): Promise<UrlKeyWriteOutcome[]> {
    assertProductIdShape(productId);
    if (writes.length === 0) return [];
    return this.#run(this.#importCommand(productId, writes, source));
  }

  #importCommand(
    productId: string,
    writes: readonly ProductUrlKeyWrite[],
    source: string,
  ): Command<UrlKeyWriteOutcome[]> {
    let changed = false;
    return {
      action: 'product.url_keys.update',
      objectType: 'product',
      objectId: productId,
      run: async ({ em }) => {
        const full = importRequest(writes);
        const { product, ownKeyEntities, state } = await this.#lockAndLoad(em, productId, (slug, ownKeys) =>
          urlKeysToLock(slug, ownKeys, full),
        );
        const { accepted, outcomes } = admitImportKeys(state, writes);
        if (accepted.length === 0) return { result: outcomes, skipAudit: true };
        const plan = planUrlKeyWrite(state, importRequest(accepted));
        if (!plan.changed) return { result: outcomes, skipAudit: true };
        const inserted = await this.#applyPlan(em, productId, product, ownKeyEntities, plan, state.memberChannels);
        changed = true;
        return {
          result: outcomes,
          before: plan.before,
          after: { ...plan.after, redirects: inserted, changedFields: ['urlKeys'], source },
        };
      },
      event: () => (changed ? urlKeysUpdatedEvent(productId) : undefined),
    };
  }

  #deleteRedirectCommand(productId: string, redirectId: string): Command<{ id: string }> {
    return {
      action: 'product.url_redirect.delete',
      objectType: 'product',
      objectId: productId,
      run: async ({ em }) => {
        const row = await em.findOne(ProductUrlRedirect, { id: redirectId, productId });
        if (!row) {
          throw new HttpError(404, ERROR_CODES.URL_REDIRECT_NOT_FOUND, 'Redirect not found.', { redirectId });
        }
        const before = {
          id: row.id,
          productId: row.productId,
          languageCode: row.languageCode ?? null,
          key: row.key,
          createdAt: row.createdAt.toISOString(),
        };
        em.remove(row);
        await em.flush();
        return { result: { id: row.id }, before, after: null };
      },
    };
  }
}
