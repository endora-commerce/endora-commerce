import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  productPath,
  resolveScopeLanguage,
  toScopeChannel,
  type CatalogProductUrlKeyReadPort,
  type ProductKeyResolution,
  sameLanguage,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SalesChannel, effectiveState } from '@endora-commerce/platform/kernel';
import { Product } from '../entities/product.entity.js';
import { ProductUrlKey } from '../entities/product-url-key.entity.js';
import { ProductUrlRedirect } from '../entities/product-url-redirect.entity.js';
import type { CatalogQueryContext } from './catalog-query.service.js';
import { channelUrlFactsOf } from './channel-url-facts.js';
import { inIdChunks } from './sql-id-arrays.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/`) — which product a URL key names
 * at (sales channel C, language L), and what a product's keys are where it is read
 * (`contracts/url-keys-and-redirects.md` §1, §4, §6; data-model §5; research R12,
 * R28).
 *
 * A key is valid only in its own language (K1): at (C, L) the keys of L resolve —
 * a product's current keys in L serve it or redirect to its effective key there,
 * its redirect keys in L redirect — and nothing else does. Every redirect target
 * is the path {@link productPath} builds for the product's effective key at
 * (C, L), the one helper every emitted product URL goes through.
 *
 * `catalog` owns the redirect rows; `seo` owns whether they are **served**
 * (research R12, Q-C): with `seo` not effectively present a redirect key answers
 * exactly what a key of no product answers. Current keys keep serving.
 */

/**
 * The effective key per channel language of each product: its channel × language
 * key for (C, L), else its language key for L, else its global key (FR-070). One
 * statement per {@link inIdChunks} chunk, whatever the number of products — the
 * listing reads it page-wide (issue #263), the sitemap channel-wide.
 *
 * Products are answered as given; whether the channel carries them is the caller's.
 */
export async function loadEffectiveKeys(
  em: EntityManager,
  products: ReadonlyArray<{ id: string; slug: string }>,
  channel: { id: string; languages: readonly string[] },
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  if (products.length === 0) return out;
  const ids = [...new Set(products.map((product) => product.id))];
  const rows = await inIdChunks(ids, (chunk) =>
    em.find(
      ProductUrlKey,
      { productId: { $in: chunk }, salesChannelId: channel.id },
      { fields: ['productId', 'languageCode', 'salesChannelId', 'key'] },
    ),
  );
  const rowsByProduct = new Map<string, Array<Pick<ProductUrlKey, 'languageCode' | 'salesChannelId' | 'key'>>>();
  for (const row of rows) {
    const list = rowsByProduct.get(row.productId) ?? [];
    list.push(row);
    rowsByProduct.set(row.productId, list);
  }
  for (const product of products) {
    const own = rowsByProduct.get(product.id) ?? [];
    const keys = new Map<string, string>();
    for (const languageCode of channel.languages) {
      // Feature 168 (`contracts/url-keys.md` §1) — the C×L key, else the Channel key, else the slug.
      // 168-shim: the rest of this file (current holder, redirect target) is T039's rewrite.
      const clKey = own.find(
        (row) => row.languageCode !== null && sameLanguage(row.languageCode, languageCode),
      );
      const cKey = own.find((row) => row.languageCode === null);
      keys.set(languageCode, clKey?.key ?? cKey?.key ?? product.slug);
    }
    out.set(product.id, keys);
  }
  return out;
}

/**
 * The live product holding `key` as a **current** key in `languageCode`: a URL-key
 * row of that language (any channel, orphans included), or the global key of a
 * product with no language key for it (FR-070). Uniqueness per language (Phase 16)
 * makes the answer at most one product. Never a redirect.
 */
export async function findCurrentKeyHolder(
  em: EntityManager,
  key: string,
  languageCode: string,
): Promise<Product | null> {
  const rows = await em.find(ProductUrlKey, { key }, { fields: ['productId', 'languageCode'] });
  const holderIds = [...new Set(rows.filter((row) => sameLanguage(row.languageCode, languageCode)).map((row) => row.productId))];
  if (holderIds.length > 0) {
    const holders = await em.find(Product, { id: { $in: holderIds }, deletedAt: null });
    if (holders[0]) return holders[0];
  }
  const bySlug = await em.findOne(Product, { slug: key, deletedAt: null });
  if (!bySlug) return null;
  const languageKeys = await em.find(
    ProductUrlKey,
    { productId: bySlug.id, salesChannelId: null },
    { fields: ['languageCode'] },
  );
  return languageKeys.some((row) => sameLanguage(row.languageCode, languageCode)) ? null : bySlug;
}

/**
 * The product a redirect key of `languageCode` points at: a redirect row of that
 * language, else a language-less one (a former global key — it redirects in every
 * language, whatever language keys its product holds; H1).
 */
async function findRedirectTarget(
  em: EntityManager,
  key: string,
  languageCode: string,
): Promise<Product | null> {
  const rows = await em.find(ProductUrlRedirect, { key });
  const row =
    rows.find((r) => r.languageCode != null && sameLanguage(r.languageCode, languageCode)) ??
    rows.find((r) => r.languageCode == null);
  if (!row) return null;
  return em.findOne(Product, { id: row.productId, deletedAt: null });
}

/** What the resolution asks of the product read path: the one reachability decision. */
export interface ProductReachability {
  /**
   * Throws the product page's own answer when `product` may not be shown to this
   * request at (C, L): `404 PRODUCT_NOT_FOUND` (absent, out of the channel, outside
   * the audience, off in the scope, outside its window) or `410 PRODUCT_ARCHIVED`.
   */
  assertReachable(product: Product, ctx: CatalogQueryContext): Promise<unknown>;
}

export class UrlKeyResolutionService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly reachability: ProductReachability,
    /** Whether `seo` is effectively present — it decides whether redirects are served (Q-C). */
    private readonly seoPresent: () => boolean = () => effectiveState.isPresent('seo'),
  ) {}

  /** `GET /api/v1/catalog/products/resolve/:key` (§4). */
  async resolve(key: string, ctx: CatalogQueryContext): Promise<ProductKeyResolution> {
    const notFound = (): HttpError => new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    const channel = toScopeChannel(ctx.resolvedChannel);
    const languageCode = resolveScopeLanguage(channel, ctx.preferredLanguage);
    const em = this.emFactory();

    let product = await findCurrentKeyHolder(em, key, languageCode);
    // A redirect is served only while `seo` is present; otherwise it is a key of
    // no product, and answers exactly that (FR-111).
    if (!product && this.seoPresent()) product = await findRedirectTarget(em, key, languageCode);
    // Feature 167 (FR-024, research R-9) — a current key of the product in another
    // **channel** language (channel order; a language the channel does not serve is
    // not considered, XII). It is never served under L (K1): it redirects to the
    // product's own key at L, temporarily, because a key held in another language
    // today may be another product's tomorrow.
    let crossLanguage = false;
    if (!product) {
      for (const other of channel.languages) {
        if (other === languageCode) continue;
        product = await findCurrentKeyHolder(em, key, other);
        if (product) {
          crossLanguage = true;
          break;
        }
      }
    }
    if (!product) throw notFound();

    // Availability before any answer naming the product: an unavailable target is
    // the absent key's 404, never a redirect that would disclose it (FR-071).
    await this.reachability.assertReachable(product, ctx);

    const effective =
      (await loadEffectiveKeys(em, [product], { id: channel.id, languages: [languageCode] }))
        .get(product.id)
        ?.get(languageCode) ?? product.slug;
    if (effective === key && !crossLanguage) return { kind: 'product', productId: product.id, key };
    return {
      kind: 'redirect',
      key: effective,
      languageCode,
      path: productPath({ key: effective, languageCode, channel: channelUrlFactsOf(ctx.resolvedChannel) }),
      // A former key, or another current key of L that is not the effective one, is
      // a property of the URL (308); a key of another language is not (307).
      permanent: !crossLanguage,
    };
  }
}

/**
 * `catalogProductUrlKeyReadPort` (R28) — the effective key per channel language of
 * each product the channel carries, for whole-channel readers such as `seo`'s
 * sitemap generator. Membership through the kernel's accessor (Constitution XII);
 * an unknown channel carries nothing.
 */
export class ProductUrlKeyReadService implements CatalogProductUrlKeyReadPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly membership: Pick<SalesChannelMembershipPort, 'filterEntityIdsInChannel'>,
  ) {}

  async effectiveKeys(productIds: readonly string[], channelId: string): Promise<Map<string, Map<string, string>>> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return new Map();
    const em = this.emFactory();
    const record = await em.findOne(SalesChannel, { id: channelId });
    if (!record) return new Map();
    const channel = toScopeChannel(record);
    const members = await this.membership.filterEntityIdsInChannel(channel.id, 'product', ids);
    if (members.length === 0) return new Map();
    const products = await inIdChunks(members, (chunk) =>
      em.find(Product, { id: { $in: chunk } }, { fields: ['id', 'slug'] }),
    );
    return loadEffectiveKeys(em, products, channel);
  }
}
