import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  URL_REDIRECTS_PER_CHANNEL_MAX,
  normaliseUrlKey,
  productPath,
  productSlugSchema,
  sameLanguage,
  toScopeChannel,
  type ProductUrlKeysResponse,
  type PutProductUrlKeysRequest,
  type ScopeChannel,
  type ScopeRef,
  type UrlKeyRedirectTakeoverRequiredDetails,
  type UrlKeyTakenDetails,
  type UrlKeyWriteOutcome,
} from '@endora-commerce/contracts';
import type { Command, CommandBus, CommandEvent } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { Product } from '../entities/product.entity.js';
import { ProductUrlKey } from '../entities/product-url-key.entity.js';
import { ProductUrlRedirect } from '../entities/product-url-redirect.entity.js';
import { channelUrlFactsOf } from './channel-url-facts.js';
import { bumpScopeVersion } from './scoped-values-state.js';

/**
 * Feature 172 (T039; `contracts/url-keys.md`, research R12) — URL keys at Global (`products.slug`),
 * Channel and Channel × language, and the redirects per (channel, language).
 *
 * **The one writer.** Every key writer — the product create and duplicate slug, the scoped-values
 * save, `PUT …/url-keys`, the CSV import and the connector port — goes through this service:
 * {@link UrlKeyService.lockAndCheck} for a key write, {@link UrlKeyService.allocateSlug} for a new
 * product's slug. Both take the advisory lock of every key they touch (sorted, `lock_timeout` 5 s)
 * and decide under it. Nothing else writes `product_url_keys`, `product_url_redirects` or
 * `products.slug` (`backend/test/unit/catalog/url-key-writer-ownership.test.ts`, T149).
 *
 * Invariants (§2): a key text belongs to at most one product per channel across all its
 * languages, orphans included (row vs row: the exclusion constraint; slug vs row and redirects:
 * here); a product's slug equals no other product's slug, row key or redirect; a redirect never
 * points at a product whose key it is in that channel, and at most
 * {@link URL_REDIRECTS_PER_CHANNEL_MAX} exist per (product, channel), oldest dropped.
 */

const LOCK_PREFIX = 'catalog.url-key:';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One key write at one scope. */
export interface UrlKeyWrite {
  scope: ScopeRef;
  op: { op: 'set'; key: string } | { op: 'inherit' };
}

/** How {@link UrlKeyService.lockAndCheck} answers a taken key (§3). */
export interface UrlKeyCheckOptions {
  /**
   * `interactive` (an operator on a `catalog:write` route): a taken key refuses the call, and a
   * key held by another product's redirect is taken over when `confirmTakeover` names it.
   * `integration` (CSV, connector): a taken key is skipped and reported, never taken over;
   * `confirmTakeover` is ignored.
   */
  mode: 'interactive' | 'integration';
  confirmTakeover?: readonly string[];
}

export interface UrlRedirectAuditRow {
  id: string;
  productId: string;
  channelId: string;
  languageCode: string;
  key: string;
}

type KeyList = Array<{ channelId: string; languageCode: string | null; key: string }>;

/** What a key write changed, for the caller's audit before / after (R21). */
export interface UrlKeySideEffects {
  changed: boolean;
  before: { slug: string; keys: KeyList; redirectsDeleted: UrlRedirectAuditRow[] };
  after: { slug: string; keys: KeyList; redirectsInserted: UrlRedirectAuditRow[] };
  /** Integration mode: the writes that were not made, each with its holder. */
  issues: Array<Extract<UrlKeyWriteOutcome, { written: false }>['issue']>;
}

/** A key written by an integration (CSV, connector): `channelId` `null` = Global; `languageCode` `null` = the Channel key. */
export interface ProductUrlKeyWrite {
  channelId: string | null;
  languageCode: string | null;
  /** `null` = inherit (remove the own key). */
  key: string | null;
}

// --- Locks ---------------------------------------------------------------------------

/**
 * Take the advisory lock of every key, in sorted order, with a 5 s `lock_timeout`. Must run inside
 * the caller's transaction: the locks are released when it ends.
 */
export async function lockUrlKeys(em: EntityManager, keys: readonly string[]): Promise<void> {
  const sorted = [...new Set(keys)].sort();
  if (sorted.length === 0) return;
  await em.execute(`set local lock_timeout = '5s'`);
  for (const key of sorted) {
    await em.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`${LOCK_PREFIX}${key}`]);
  }
}

/**
 * Whether `key` is free to become a **new** product's slug (§2.2): no product's slug (soft-deleted
 * ones included — the column is unique), no live product's row key in any channel, no redirect.
 */
export async function isUrlKeyFree(em: EntityManager, key: string): Promise<boolean> {
  const rows = await em.execute<unknown[]>(
    `select 1 from "products" where "slug" = ?
     union all
     select 1 from "product_url_keys" k join "products" p on p."id" = k."product_id"
       where k."key" = ? and p."deleted_at" is null
     union all
     select 1 from "product_url_redirects" where "key" = ?
     limit 1`,
    [key, key, key],
  );
  return rows.length === 0;
}

/**
 * {@link UrlKeyService.allocateSlug} as a function, for the product create and duplicate paths that
 * hold no service instance: the free-looking candidates (at most `limit`) are locked together in
 * sorted order and re-checked under the locks in the given order; the first still free wins.
 */
export async function allocateFreeSlug(em: EntityManager, candidates: readonly string[], limit = candidates.length): Promise<string | null> {
  const probes: string[] = [];
  for (const candidate of candidates) {
    if (probes.length >= limit) break;
    if (!probes.includes(candidate) && (await isUrlKeyFree(em, candidate))) probes.push(candidate);
  }
  if (probes.length === 0) return null;
  await lockUrlKeys(em, probes);
  for (const candidate of probes) if (await isUrlKeyFree(em, candidate)) return candidate;
  return null;
}

// --- Pure helpers --------------------------------------------------------------------

export interface KeyRowLike {
  salesChannelId: string;
  languageCode: string | null;
  key: string;
}

/** P's effective key at (C, L): its C×L row → its C row → the slug (§1). */
export function effectiveKeyAt(rows: readonly KeyRowLike[], slug: string, channelId: string, languageCode: string): string {
  const cl = rows.find((row) => row.salesChannelId === channelId && row.languageCode != null && sameLanguage(row.languageCode, languageCode));
  if (cl) return cl.key;
  const c = rows.find((row) => row.salesChannelId === channelId && row.languageCode == null);
  return c?.key ?? slug;
}

/** P's keys in channel C (§1): every row of C (orphans included), plus the slug where some language of C uses it. */
export function keysInChannel(rows: readonly KeyRowLike[], slug: string, channel: ScopeChannel | undefined, channelId: string): Set<string> {
  const keys = new Set(rows.filter((row) => row.salesChannelId === channelId).map((row) => row.key));
  if (channel && channel.languages.some((languageCode) => effectiveKeyAt(rows, slug, channelId, languageCode) === slug)) keys.add(slug);
  return keys;
}

const display = (product: Pick<Product, 'name' | 'sku'>): string => (product.name?.trim() ? product.name : product.sku);

/** A residual constraint violation is a taken key — never a 500, never the constraint's name. */
function isKeyViolation(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
  return code === '23P01' || code === '23505';
}

const keyRowsOf = (rows: readonly ProductUrlKey[]): KeyRowLike[] =>
  rows.map((row) => ({ salesChannelId: row.salesChannelId, languageCode: row.languageCode ?? null, key: row.key }));

const keyList = (list: readonly KeyRowLike[]): KeyList =>
  list
    .map((row) => ({ channelId: row.salesChannelId, languageCode: row.languageCode, key: row.key }))
    .sort((a, b) => a.channelId.localeCompare(b.channelId) || (a.languageCode ?? '').localeCompare(b.languageCode ?? ''));

function urlKeysUpdatedEvent(
  productId: string,
): CommandEvent<{ eventId: string; occurredAt: string; productId: string; changedFields: string[] }> {
  return {
    eventName: 'product.updated.v1',
    payload: { eventId: randomUUID(), occurredAt: new Date().toISOString(), productId, changedFields: ['urlKeys'] },
  };
}

interface Conflict {
  holderId: string;
  key: string;
  channelId: string | null;
  languageCode: string | null;
  kind: 'current' | 'redirect';
}

// --- The service ---------------------------------------------------------------------

export class UrlKeyService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity' | 'filterEntityIdsInChannel'>,
    private readonly commandBus?: CommandBus,
    /** Whether `seo` is effectively present: it decides whether redirects are listed (Q-C). Writes never ask. */
    private readonly seoPresent: () => boolean = () => effectiveState.isPresent('seo'),
  ) {}

  /**
   * §3 — the one key write. On the caller's `em`, inside the caller's transaction: locks, checks
   * and writes. A taken key throws (`interactive`) or is reported and skipped (`integration`);
   * every other refusal (`SCOPE_INVALID`, the grammar) throws in both modes.
   */
  async lockAndCheck(
    em: EntityManager,
    productId: string,
    writes: readonly UrlKeyWrite[],
    options: UrlKeyCheckOptions,
  ): Promise<UrlKeySideEffects> {
    // command-coverage-ignore: runs only on the caller's Command `em` (the scoped-values save,
    // PUT …/url-keys, the import and connector Commands).
    const product = await em.findOne(Product, { id: productId });
    if (!product || product.deletedAt) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    const [members, ownRows, ownRedirects] = await Promise.all([
      this.membership.listChannelsForEntity('product', productId),
      em.find(ProductUrlKey, { productId }),
      em.find(ProductUrlRedirect, { productId }),
    ]);
    const channels = new Map(members.map((channel) => [channel.id, toScopeChannel(channel)]));
    const confirm = new Set(options.mode === 'interactive' ? (options.confirmTakeover ?? []).map(normaliseUrlKey) : []);

    // The planned state: own rows and slug after every write; languages in the channel's spelling.
    const slugBefore = product.slug;
    const beforeRows = keyRowsOf(ownRows);
    const rows: KeyRowLike[] = keyRowsOf(ownRows);
    let slug = slugBefore;
    for (const write of writes) {
      const key = write.op.op === 'set' ? normaliseUrlKey(write.op.key) : null;
      if (key !== null && !productSlugSchema.safeParse(key).success) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A URL key must be lower-case words joined by hyphens.', { field: 'urlKey' });
      }
      if (write.scope.level === 'global') {
        if (key === null) {
          throw new HttpError(422, ERROR_CODES.SCOPED_VALUE_INVALID, 'The Global URL key cannot inherit.', {
            fields: [{ field: 'urlKey', scope: write.scope, reason: 'inherit_at_global' }],
          });
        }
        slug = key;
        continue;
      }
      const channelId = write.scope.channelId;
      const channel = channels.get(channelId);
      let languageCode: string | null = null;
      if (write.scope.level === 'channel_language') {
        const wanted = write.scope.languageCode;
        languageCode = channel?.languages.find((code) => sameLanguage(code, wanted)) ?? wanted;
      }
      const index = rows.findIndex(
        (row) =>
          row.salesChannelId === channelId &&
          (languageCode === null ? row.languageCode === null : row.languageCode !== null && sameLanguage(row.languageCode, languageCode)),
      );
      if (key === null) {
        // Removing an own key is always allowed, an orphan's included (163 FR-015).
        if (index !== -1) rows.splice(index, 1);
        continue;
      }
      const offered = channel !== undefined && (languageCode === null || channel.languages.some((code) => sameLanguage(code, languageCode)));
      if (!offered) {
        throw new HttpError(
          422,
          ERROR_CODES.SCOPE_INVALID,
          channel ? 'The sales channel does not offer this language.' : 'The product is not a member of this sales channel.',
          { channelId, ...(languageCode ? { languageCode } : {}), reason: channel ? 'language_not_offered' : 'not_a_member' },
        );
      }
      if (index !== -1) rows[index] = { ...rows[index]!, key };
      else rows.push({ salesChannelId: channelId, languageCode, key });
    }

    // Lock every key the write touches: both slugs, every outgoing and newly effective key, every new row key.
    const touched = new Set<string>([slugBefore, slug, ...rows.map((row) => row.key)]);
    for (const [channelId, channel] of channels) {
      for (const languageCode of channel.languages) {
        touched.add(effectiveKeyAt(beforeRows, slugBefore, channelId, languageCode));
        touched.add(effectiveKeyAt(rows, slug, channelId, languageCode));
      }
    }
    await lockUrlKeys(em, [...touched]);

    // Under the locks: the keys P newly holds — the slug anywhere, and per channel every key it did not hold there.
    const conflicts: Conflict[] = [];
    if (slug !== slugBefore) {
      for (const holder of await this.#slugConflicts(em, productId, slug)) conflicts.push({ ...holder, key: slug });
    }
    for (const [channelId, channel] of channels) {
      const held = keysInChannel(beforeRows, slugBefore, channel, channelId);
      for (const key of keysInChannel(rows, slug, channel, channelId)) {
        if (held.has(key)) continue;
        for (const holder of await this.#channelConflicts(em, productId, channelId, key)) conflicts.push({ ...holder, key, channelId });
      }
    }

    if (options.mode === 'integration' && conflicts.length > 0) {
      const blocked = new Set(conflicts.map((conflict) => conflict.key));
      const kept = writes.filter((write) => !(write.op.op === 'set' && blocked.has(normaliseUrlKey(write.op.key))));
      const issues = conflicts.map((conflict) => ({
        channelId: conflict.channelId,
        languageCode: conflict.languageCode,
        key: conflict.key,
        heldByProductId: conflict.holderId,
        kind: conflict.kind,
      }));
      if (kept.length === writes.length) {
        // The conflict comes from a key that only becomes effective (an `inherit`): nothing is written.
        const keys = keyList(beforeRows);
        return { changed: false, before: { slug: slugBefore, keys, redirectsDeleted: [] }, after: { slug: slugBefore, keys, redirectsInserted: [] }, issues };
      }
      const retried = await this.lockAndCheck(em, productId, kept, options);
      return { ...retried, issues: [...issues, ...retried.issues] };
    }
    const current = conflicts.filter((conflict) => conflict.kind === 'current');
    if (current.length > 0) {
      const names = await this.#names(em, current.map((conflict) => conflict.holderId));
      const details: UrlKeyTakenDetails = {
        conflicts: current.map((conflict) => ({
          channelId: conflict.channelId,
          languageCode: conflict.languageCode,
          key: conflict.key,
          heldByProductId: conflict.holderId,
          heldByProductName: names.get(conflict.holderId) ?? conflict.holderId,
        })),
      };
      throw new HttpError(409, ERROR_CODES.URL_KEY_TAKEN, 'This URL key is used by another product.', details);
    }
    const redirectConflicts = conflicts.filter((conflict) => conflict.kind === 'redirect');
    const unconfirmed = redirectConflicts.filter((conflict) => !confirm.has(conflict.key));
    if (unconfirmed.length > 0) {
      const names = await this.#names(em, unconfirmed.map((conflict) => conflict.holderId));
      const details: UrlKeyRedirectTakeoverRequiredDetails = {
        takeovers: unconfirmed.map((conflict) => ({
          channelId: conflict.channelId,
          languageCode: conflict.languageCode,
          key: conflict.key,
          losingProductId: conflict.holderId,
          losingProductName: names.get(conflict.holderId) ?? conflict.holderId,
        })),
      };
      throw new HttpError(409, ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED, 'This URL key redirects to another product; confirm to take it over.', details);
    }

    // Apply. Takeovers first: another product's redirects for the confirmed keys go (listed in the audit).
    const deleted: UrlRedirectAuditRow[] = [];
    for (const conflict of redirectConflicts) {
      const lost = await em.find(ProductUrlRedirect, {
        key: conflict.key,
        productId: conflict.holderId,
        ...(conflict.channelId ? { salesChannelId: conflict.channelId } : {}),
      });
      for (const row of lost) {
        if (deleted.some((d) => d.id === row.id)) continue;
        deleted.push({ id: row.id, productId: row.productId, channelId: row.salesChannelId, languageCode: row.languageCode, key: row.key });
        em.remove(row);
      }
    }

    // P's redirects: one per pair whose effective key moved from k0, unless k0 is still one of P's keys in C.
    const inserted: UrlRedirectAuditRow[] = [];
    const live = [...ownRedirects];
    for (const [channelId, channel] of channels) {
      const after = keysInChannel(rows, slug, channel, channelId);
      for (const languageCode of channel.languages) {
        const k0 = effectiveKeyAt(beforeRows, slugBefore, channelId, languageCode);
        const k1 = effectiveKeyAt(rows, slug, channelId, languageCode);
        if (k0 === k1 || after.has(k0)) continue;
        if (live.some((row) => row.salesChannelId === channelId && sameLanguage(row.languageCode, languageCode) && row.key === k0)) continue;
        const row = em.create(ProductUrlRedirect, { id: randomUUID(), productId, salesChannelId: channelId, languageCode, key: k0, createdAt: new Date() });
        em.persist(row);
        live.push(row);
        inserted.push({ id: row.id, productId, channelId, languageCode, key: k0 });
      }
    }
    // No self-redirect (§2.3): a redirect of P whose key is one of P's keys in its channel goes.
    for (const row of [...live]) {
      if (!keysInChannel(rows, slug, channels.get(row.salesChannelId), row.salesChannelId).has(row.key)) continue;
      em.remove(row);
      live.splice(live.indexOf(row), 1);
      const fresh = inserted.findIndex((i) => i.id === row.id);
      if (fresh !== -1) inserted.splice(fresh, 1);
      else deleted.push({ id: row.id, productId, channelId: row.salesChannelId, languageCode: row.languageCode, key: row.key });
    }
    // The cap per (product, channel): the oldest beyond it go, listed in the audit.
    for (const channelId of new Set(live.map((row) => row.salesChannelId))) {
      const list = live
        .filter((row) => row.salesChannelId === channelId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
      for (const row of list.slice(URL_REDIRECTS_PER_CHANNEL_MAX)) {
        em.remove(row);
        deleted.push({ id: row.id, productId, channelId, languageCode: row.languageCode, key: row.key });
      }
    }

    // The key rows and the slug.
    for (const row of ownRows) {
      const next = rows.find((r) => r.salesChannelId === row.salesChannelId && sameLanguage(r.languageCode, row.languageCode ?? null));
      if (!next) em.remove(row);
      else if (next.key !== row.key) {
        row.key = next.key;
        row.updatedAt = new Date();
        em.persist(row);
      }
    }
    for (const next of rows) {
      if (ownRows.some((row) => row.salesChannelId === next.salesChannelId && sameLanguage(row.languageCode ?? null, next.languageCode))) continue;
      em.persist(em.create(ProductUrlKey, { id: randomUUID(), productId, salesChannelId: next.salesChannelId, languageCode: next.languageCode, key: next.key }));
    }
    if (slug !== slugBefore) product.slug = slug;
    try {
      await em.flush();
    } catch (err) {
      if (isKeyViolation(err)) throw new HttpError(409, ERROR_CODES.URL_KEY_TAKEN, 'This URL key is used by another product.', { conflicts: [] });
      throw err;
    }
    const changed =
      slug !== slugBefore || JSON.stringify(keyList(beforeRows)) !== JSON.stringify(keyList(rows)) || inserted.length > 0 || deleted.length > 0;
    return {
      changed,
      before: { slug: slugBefore, keys: keyList(beforeRows), redirectsDeleted: deleted },
      after: { slug, keys: keyList(rows), redirectsInserted: inserted },
      issues: [],
    };
  }

  /** §2.2 — another product holding `key` as its slug, a row key (any channel) or a redirect. */
  async #slugConflicts(em: EntityManager, productId: string, key: string): Promise<Array<Omit<Conflict, 'key'>>> {
    const rows = await em.execute<Array<{ product_id: string; channel_id: string | null; language_code: string | null; kind: 'current' | 'redirect' }>>(
      `select id::text as product_id, null::text as channel_id, null::text as language_code, 'current' as kind from products where slug = ? and id <> ?
       union all
       select k.product_id::text, k.sales_channel_id::text, k.language_code, 'current' from product_url_keys k
         join products p on p.id = k.product_id where k.key = ? and k.product_id <> ? and p.deleted_at is null
       union all
       select r.product_id::text, r.sales_channel_id::text, r.language_code, 'redirect' from product_url_redirects r where r.key = ? and r.product_id <> ?`,
      [key, productId, key, productId, key, productId],
    );
    return rows.map((row) => ({ holderId: row.product_id, channelId: row.channel_id, languageCode: row.language_code, kind: row.kind }));
  }

  /** §3 — `key` taken in channel C by another product: one of its rows in C, its slug where C uses it, or its redirect in C. */
  async #channelConflicts(
    em: EntityManager,
    productId: string,
    channelId: string,
    key: string,
  ): Promise<Array<Omit<Conflict, 'key' | 'channelId'>>> {
    const out: Array<Omit<Conflict, 'key' | 'channelId'>> = [];
    const rows = await em.execute<Array<{ product_id: string; language_code: string | null }>>(
      `select k.product_id::text as product_id, k.language_code from product_url_keys k
         join products p on p.id = k.product_id
        where k.sales_channel_id = ? and k.key = ? and k.product_id <> ? and p.deleted_at is null`,
      [channelId, key, productId],
    );
    for (const row of rows) out.push({ holderId: row.product_id, languageCode: row.language_code, kind: 'current' });
    const slugHolders = await em.find(Product, { slug: key, id: { $ne: productId }, deletedAt: null });
    if (slugHolders.length > 0) {
      const members = new Set(await this.membership.filterEntityIdsInChannel(channelId, 'product', slugHolders.map((p) => p.id)));
      for (const holder of slugHolders) {
        if (!members.has(holder.id)) continue;
        const channel = (await this.membership.listChannelsForEntity('product', holder.id)).find((c) => c.id === channelId);
        const holderRows = keyRowsOf(await em.find(ProductUrlKey, { productId: holder.id, salesChannelId: channelId }));
        if (keysInChannel(holderRows, holder.slug, channel ? toScopeChannel(channel) : undefined, channelId).has(key)) {
          out.push({ holderId: holder.id, languageCode: null, kind: 'current' });
        }
      }
    }
    const redirects = await em.execute<Array<{ product_id: string; language_code: string }>>(
      `select product_id::text as product_id, language_code from product_url_redirects where sales_channel_id = ? and key = ? and product_id <> ?`,
      [channelId, key, productId],
    );
    for (const row of redirects) out.push({ holderId: row.product_id, languageCode: row.language_code, kind: 'redirect' });
    return out;
  }

  async #names(em: EntityManager, ids: readonly string[]): Promise<Map<string, string>> {
    const products = await em.find(Product, { id: { $in: [...new Set(ids)] } }, { fields: ['id', 'name', 'sku'] });
    return new Map(products.map((product) => [product.id, display(product)]));
  }

  /**
   * A free slug for a **new** product (create, duplicate): the free-looking candidates are locked
   * together in sorted order — the order every key writer locks in — and re-checked under the
   * locks in the given order; the first still free wins. `null` = none is free.
   */
  allocateSlug(em: EntityManager, candidates: readonly string[]): Promise<string | null> {
    return allocateFreeSlug(em, candidates);
  }

  /** `GET /admin/catalog/products/:id/url-keys` (§5). */
  async read(productId: string): Promise<ProductUrlKeysResponse['data']> {
    if (!UUID_SHAPE.test(productId)) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: productId, deletedAt: null });
    if (!product) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    const [members, keyRows, redirects] = await Promise.all([
      this.membership.listChannelsForEntity('product', productId),
      em.find(ProductUrlKey, { productId }),
      em.find(ProductUrlRedirect, { productId }),
    ]);
    const memberById = new Map(members.map((channel) => [channel.id, channel]));
    const rows = keyRowsOf(keyRows);
    const effective: ProductUrlKeysResponse['data']['effective'] = [];
    for (const channel of [...members].sort((a, b) => a.code.localeCompare(b.code))) {
      for (const languageCode of toScopeChannel(channel).languages) {
        const key = effectiveKeyAt(rows, product.slug, channel.id, languageCode);
        const cl = rows.find((row) => row.salesChannelId === channel.id && row.languageCode != null && sameLanguage(row.languageCode, languageCode));
        const c = rows.find((row) => row.salesChannelId === channel.id && row.languageCode == null);
        effective.push({
          channelId: channel.id,
          languageCode,
          key,
          source: cl ? 'channel_language' : c ? 'channel' : 'global',
          url: productPath({ key, languageCode, channel: channelUrlFactsOf(channel) }),
        });
      }
    }
    return {
      globalKey: product.slug,
      channelKeys: keyList(rows).map((row) => {
        const channel = memberById.get(row.channelId);
        return {
          ...row,
          orphaned:
            !channel ||
            (row.languageCode !== null && !toScopeChannel(channel).languages.some((code) => sameLanguage(code, row.languageCode))),
        };
      }),
      effective,
      // Q-C: the redirect list is `seo`'s surface — omitted while it is off; the rows stay and keep reserving.
      ...(this.seoPresent()
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

  /** `PUT /admin/catalog/products/:id/url-keys` (API; §3) — interactive, takeover by confirmation. */
  async update(productId: string, request: PutProductUrlKeysRequest): Promise<ProductUrlKeysResponse['data']> {
    if (!UUID_SHAPE.test(productId)) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    const writes: UrlKeyWrite[] = [];
    if (request.globalKey !== undefined) writes.push({ scope: { level: 'global' }, op: { op: 'set', key: request.globalKey } });
    for (const entry of request.channelKeys ?? []) {
      const scope: ScopeRef = entry.languageCode
        ? { level: 'channel_language', channelId: entry.channelId, languageCode: entry.languageCode }
        : { level: 'channel', channelId: entry.channelId };
      writes.push({ scope, op: typeof entry.key === 'string' ? { op: 'set', key: entry.key } : { op: 'inherit' } });
    }
    await this.#runWrite(this.#writeCommand(productId, writes, { mode: 'interactive', confirmTakeover: request.confirmTakeover ?? [] }));
    return this.read(productId);
  }

  /**
   * An integration's keys (CSV, connector; §3): a taken key is not written and comes back as an
   * issue naming the holder; a redirect is never taken over. One Command per call.
   */
  async importKeys(productId: string, writes: readonly ProductUrlKeyWrite[], source: string): Promise<UrlKeyWriteOutcome[]> {
    if (!UUID_SHAPE.test(productId)) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    if (writes.length === 0) return [];
    const keyWrites: UrlKeyWrite[] = writes.map((write) => {
      const scope: ScopeRef =
        write.channelId === null
          ? { level: 'global' }
          : write.languageCode
            ? { level: 'channel_language', channelId: write.channelId, languageCode: write.languageCode }
            : { level: 'channel', channelId: write.channelId };
      return { scope, op: write.key === null ? { op: 'inherit' } : { op: 'set', key: write.key } };
    });
    const effects = await this.#runWrite(this.#writeCommand(productId, keyWrites, { mode: 'integration' }, source));
    return writes.map((write) => {
      const issue = effects.issues.find((i) => write.key !== null && i.key === normaliseUrlKey(write.key));
      return issue ? { written: false as const, issue } : { written: true as const };
    });
  }

  /** `DELETE /admin/catalog/products/:id/url-redirects/:redirectId` (Command `product.url_redirect.delete`). */
  async deleteRedirect(productId: string, redirectId: string): Promise<void> {
    if (!UUID_SHAPE.test(productId) || !UUID_SHAPE.test(redirectId)) {
      throw new HttpError(404, ERROR_CODES.URL_REDIRECT_NOT_FOUND, 'Redirect not found.', { redirectId });
    }
    await this.#run<{ id: string }>({
      action: 'product.url_redirect.delete',
      objectType: 'product',
      objectId: productId,
      run: async ({ em }) => {
        const row = await em.findOne(ProductUrlRedirect, { id: redirectId, productId });
        if (!row) throw new HttpError(404, ERROR_CODES.URL_REDIRECT_NOT_FOUND, 'Redirect not found.', { redirectId });
        const before = {
          id: row.id,
          productId: row.productId,
          channelId: row.salesChannelId,
          languageCode: row.languageCode,
          key: row.key,
          createdAt: row.createdAt.toISOString(),
        };
        em.remove(row);
        await em.flush();
        return { result: { id: row.id }, before, after: null };
      },
    });
  }

  #writeCommand(productId: string, writes: readonly UrlKeyWrite[], options: UrlKeyCheckOptions, source?: string): Command<UrlKeySideEffects> {
    return {
      action: 'product.url_keys.update',
      objectType: 'product',
      objectId: productId,
      run: async ({ em }) => {
        // Feature 172 (R7) — a key write is Save-overwritable: it moves the editor's version.
        await bumpScopeVersion(em, productId);
        const effects = await this.lockAndCheck(em, productId, writes, options);
        // A write that changes nothing rolls the version bump back (code review warn).
        if (!effects.changed) throw new UrlKeysNothingChanged(effects);
        return {
          result: effects,
          before: { ...effects.before },
          after: { ...effects.after, changedFields: ['urlKeys'], ...(source ? { source } : {}) },
        };
      },
      event: (effects) => (effects.changed ? urlKeysUpdatedEvent(productId) : undefined),
    };
  }

  /** A key write; one that changes nothing answers its effects with nothing committed. */
  async #runWrite(command: Command<UrlKeySideEffects>): Promise<UrlKeySideEffects> {
    try {
      return await this.#run(command);
    } catch (error) {
      if (error instanceof UrlKeysNothingChanged) return error.effects;
      throw error;
    }
  }

  async #run<T>(command: Command<T>): Promise<T> {
    if (this.commandBus) return this.commandBus.run(command);
    return this.emFactory().transactional(async (em) => {
      const outcome = await command.run({ em, actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' } });
      return outcome.result;
    });
  }
}

/** Thrown inside a key write that changes nothing, so its version bump rolls back. */
class UrlKeysNothingChanged extends Error {
  constructor(readonly effects: UrlKeySideEffects) {
    super('url keys: nothing changed');
  }
}
