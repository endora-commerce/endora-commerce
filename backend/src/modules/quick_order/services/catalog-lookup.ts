import { isProductVisibleTo, type CatalogProductReadPort } from '@b2b/contracts';
import type { SalesChannelMembershipPort } from '../../../kernel/ports/sales-channel.js';
import { productIdsInRequestChannel } from '../../../kernel/sales-channels/request-channel-assortment.js';
import type {
  ProductLike,
  QuickOrderCatalogLookup,
  QuickOrderImportAudience,
  VariantBySku,
} from './import-pipeline.js';
import type { VariantLike } from './variant-resolver.js';

/**
 * {@link QuickOrderCatalogLookup} over `catalog`'s published read port
 * (feature 075, Phase C).
 *
 * It used to run three `em.find` calls against `Product` and `ProductVariant`
 * — two tables `catalog` owns — so a switched-off `catalog` still resolved
 * SKUs out of rows deactivation leaves in place, and a CSV import went on
 * recognising products the platform had stopped serving. Each call is now the
 * port's own batched equivalent, and an absent owner refuses at the seam.
 *
 * The three mappings stay here: the pipeline owns the resolution logic and
 * wants only the four or five fields below, so what crosses is narrower than
 * the record.
 */
export class CatalogPortLookup implements QuickOrderCatalogLookup {
  constructor(
    private readonly catalogProducts: CatalogProductReadPort,
    /**
     * The sanctioned bridge accessor (Constitution XII), for the channel half
     * of the same answer (issue #259).
     */
    private readonly channelMembership: SalesChannelMembershipPort,
  ) {}

  /**
   * Narrow to what the request's channel publishes — the second filter
   * `isProductVisibleTo` says it is not (issue #259).
   *
   * A pasted SKU list is the cheapest enumeration oracle on the platform, which
   * is why issue #227 gave this file an audience. The channel is the other axis
   * of the same oracle: without it a buyer shopping one storefront could paste
   * another's private assortment and have every line come back recognised.
   *
   * `'unrestricted'` skips it for the same reason it skips the audience filter:
   * `POST /api/v1/admin/quick-order/import` is gated by `orders:write` and the
   * operator names the organisation — and therefore the buyer, and therefore
   * the channel — one step later on the *build* call. At import time there is
   * nobody to answer for on either axis, and the permission is the enforcement.
   */
  async #publishedHere(
    audience: QuickOrderImportAudience,
    productIds: string[],
  ): Promise<ReadonlySet<string> | null> {
    if (audience === 'unrestricted') return null;
    return productIdsInRequestChannel(this.channelMembership, productIds);
  }

  async findProductsBySku(
    skus: string[],
    audience: QuickOrderImportAudience,
  ): Promise<ProductLike[]> {
    if (skus.length === 0) return [];
    const products = (await this.catalogProducts.findBySkus(skus)).filter(
      (p) => audience === 'unrestricted' || isProductVisibleTo(p, audience),
    );
    const publishedHere = await this.#publishedHere(
      audience,
      products.map((p) => p.id),
    );
    return products
      .filter((p) => publishedHere === null || publishedHere.has(p.id))
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        status: p.status,
        deletedAt: p.deletedAt,
      }));
  }

  async findVariantsBySku(
    skus: string[],
    audience: QuickOrderImportAudience,
  ): Promise<VariantBySku[]> {
    if (skus.length === 0) return [];
    const variants = await this.catalogProducts.findVariantsBySkus(skus);
    if (variants.length === 0 || audience === 'unrestricted') {
      return variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        parentProductId: v.parentProductId,
      }));
    }
    // A variant carries no visibility of its own — its parent's answer is the
    // whole answer (issue #227). Without this pass a pasted *variant* SKU
    // resolved a restricted parent's id, which is the same oracle by one more
    // hop; the parents are fetched here rather than left to the pipeline
    // because only the record carries the two columns.
    const parents = await this.catalogProducts.findByIds(
      Array.from(new Set(variants.map((v) => v.parentProductId))),
    );
    const visibleParents = parents.filter((p) => isProductVisibleTo(p, audience));
    // Issue #259 — and the channel answer is the parent's too. A variant SKU
    // that resolved a parent this channel does not publish is the same oracle
    // by one more hop, which is the reason the parents are fetched at all.
    const publishedHere = await this.#publishedHere(
      audience,
      visibleParents.map((p) => p.id),
    );
    const acquirableParents = new Set(
      visibleParents
        .filter((p) => publishedHere === null || publishedHere.has(p.id))
        .map((p) => p.id),
    );
    return variants
      .filter((v) => acquirableParents.has(v.parentProductId))
      .map((v) => ({ id: v.id, sku: v.sku, parentProductId: v.parentProductId }));
  }

  async findVariantsByParent(
    productIds: string[],
  ): Promise<Array<VariantLike & { parentProductId: string }>> {
    if (productIds.length === 0) return [];
    const variants = await this.catalogProducts.listVariantsByProductIds(productIds);
    return variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      parentProductId: v.parentProductId,
      variantAttributeValues: v.variantAttributeValues,
    }));
  }
}
