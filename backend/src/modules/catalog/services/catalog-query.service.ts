import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../entities/product.entity.js';
import { ProductVariant } from '../entities/product-variant.entity.js';
import { Category } from '../entities/category.entity.js';
import { AttributeSet } from '../entities/attribute-set.entity.js';
import type {
  CatalogAttributeReadService,
  CatalogAttributeView,
} from './catalog-attribute-read.service.js';
import { GalleryItem } from '../entities/gallery-item.entity.js';
import { GalleryItemLabel } from '../entities/gallery-item-label.entity.js';
import { ProductAttachment } from '../entities/product-attachment.entity.js';
import { AttachmentType } from '../entities/attachment-type.entity.js';
import { Asset } from '../../assets_library/entities/asset.entity.js';
import type { ProductLinkService } from './product-link.service.js';
import type { DefinitionSource } from '../../custom_fields/services/custom-field-value.service.js';
import { GroupedItem } from '../entities/grouped-item.entity.js';
import { ProductPackagingUnit } from '../entities/product-packaging-unit.entity.js';
import { BundleSlot } from '../entities/bundle-slot.entity.js';
import { BundleSlotOption } from '../entities/bundle-slot-option.entity.js';
import {
  ERROR_CODES,
  type CategoryNode,
  type FilterDefinition,
  type ProductDetail,
  type ProductSummary,
  type ProductVariant as VariantDto,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { encodeCursor, decodeCursor } from '../../../http/cursor.js';

function encodeObjectCursor(value: object): string {
  return encodeCursor(JSON.stringify(value));
}

function decodeObjectCursor<T>(cursor: string): T | null {
  const raw = decodeCursor(cursor);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Catalog read-path service (US1). Consumed by the storefront and by external
 * integrations pulling `/catalog/products?changedSince=...`.
 *
 * Sales-channel awareness: each public endpoint resolves the requested channel
 * (default: the one marked `isPublic=true` when no channel was specified) and
 * applies the visibility rules from R-18 — non-public channels omit the `price`
 * field from anonymous responses.
 *
 * For MVP, text search is Postgres ILIKE on the multilingual `name`/`description`
 * blobs. The Meilisearch-backed query path lives in the `search` module
 * (tasks T067/T068); this service falls back to it transparently when available.
 */

/**
 * The request's sales channel, resolved once by the canonical resolver
 * middleware (feature 053 / FR-002). The catalog reads it from the request
 * context instead of re-resolving from the raw header. `isPublic` is the
 * price-visibility flag (display concern, distinct from resolution).
 */
export interface CatalogResolvedChannel {
  id: string;
  code: string;
  isPublic: boolean;
  defaultCurrency: string;
  defaultLanguage: string;
}

export interface CatalogQueryContext {
  /** The request's resolved sales channel (from `request.salesChannel`). */
  resolvedChannel: CatalogResolvedChannel;
  /**
   * Language preference — BCP-47. Used to pick the right string out of the
   * multilingual JSONB blobs. Falls back to the Sales Channel's default language,
   * then to any available key.
   */
  preferredLanguage?: string | undefined;
}

export interface ListProductsParams {
  q?: string | undefined;
  limit: number;
  cursor?: string | undefined;
  sort?: 'relevance' | '-createdAt' | 'name' | '-name' | undefined;
  categorySlug?: string | undefined;
  attributeFilters?: Record<string, string[]> | undefined;
  changedSince?: string | undefined;
}

export interface ListResult<T> {
  data: T[];
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

export class CatalogQueryService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Feature 002 US4 — optional link provider so the PDP `productDetail`
     * carries the pre-grouped Related/Up-sell/Cross-sell links. Optional
     * so tests/composition that don't wire it stay green; when undefined,
     * `productDetail.links` is omitted from the response.
     */
    private readonly productLinkService?: ProductLinkService,
    /**
     * Feature 055 (US4) — optional custom-field definition source. When wired,
     * Category custom fields flagged `config.filterable === true` are merged into
     * the storefront filter set. The catalog interprets the opaque `config` here;
     * the custom-fields core stays unaware of catalog (Principle XIV / FR-006).
     */
    private readonly customFieldDefinitions?: DefinitionSource,
    /**
     * Feature 061 — composed attribute read model. Required for every
     * attribute-metadata read (filters, PDP visible attributes, promo-rule and
     * comparable key ports); optional in the signature so product-only
     * fixtures keep constructing the service without attribute wiring.
     */
    private readonly attributeRead?: CatalogAttributeReadService,
  ) {}

  #requireAttributeRead(): CatalogAttributeReadService {
    if (!this.attributeRead) {
      throw new Error(
        'CatalogQueryService: CatalogAttributeReadService is not wired — attribute reads are unavailable.',
      );
    }
    return this.attributeRead;
  }

  // ------------------------------------------------------------------
  // Products
  // ------------------------------------------------------------------

  async listProducts(
    params: ListProductsParams,
    ctx: CatalogQueryContext,
  ): Promise<ListResult<ProductSummary>> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;

    // --- Filter validation: any filter[attr.<key>] where the attribute is
    // not filterable must return 400 FILTER_NOT_ALLOWED (FR-005, T043).
    if (params.attributeFilters) {
      const keys = Object.keys(params.attributeFilters);
      if (keys.length > 0) {
        const views = await this.#requireAttributeRead().listAll();
        const byKey = new Map(views.map((a) => [a.key, a]));
        for (const k of keys) {
          const a = byKey.get(k);
          if (!a || !a.isFilterable) {
            throw new HttpError(
              400,
              ERROR_CODES.FILTER_NOT_ALLOWED,
              `Attribute "${k}" is not filterable.`,
              [{ path: `filter[attr.${k}]`, issue: 'attribute is not filterable' }],
            );
          }
        }
      }
    }

    const where: Record<string, unknown> = {
      status: 'active',
      deletedAt: null,
    };
    if (params.q) {
      // MVP: DB-only search. Production target uses Meilisearch behind this
      // same query method (T067/T068 — Phase 10 polish); for now we match:
      //   1. SKU ILIKE (covers the seeded EXAMPLE-… ids)
      //   2. attributeValues at any key flagged isSearchable=true
      // The attribute-values match uses Postgres ILIKE on the JSONB cast to
      // text, which is fine for the test corpus and good enough until Meili.
      const searchableKeys = await this.searchableAttributeKeys(em);
      const orClauses: Array<Record<string, unknown>> = [
        { sku: { $ilike: `%${params.q}%` } },
      ];
      for (const key of searchableKeys) {
        // MikroORM's `expr()` would be cleaner; raw cast keeps the dependency
        // surface minimal here.
        orClauses.push({
          // Match any product whose attributeValues[key] (case-insensitive)
          // contains the query.
          attributeValues: this.searchableJsonbClause(key, params.q),
        });
      }
      where['$or'] = orClauses;
    }
    if (params.changedSince) {
      where['updatedAt'] = { $gt: new Date(params.changedSince) };
    }

    // Cursor decoding — encoded as `{ createdAt, id }` in the default sort.
    let cursorClause: Record<string, unknown> | null = null;
    if (params.cursor) {
      const decoded = decodeObjectCursor<{ createdAt: string; id: string }>(params.cursor);
      if (decoded) {
        cursorClause = {
          $or: [
            { createdAt: { $lt: new Date(decoded.createdAt) } },
            { createdAt: new Date(decoded.createdAt), id: { $lt: decoded.id } },
          ],
        };
      }
    }

    const effectiveWhere = cursorClause ? { $and: [where, cursorClause] } : where;

    // Over-fetch by one to detect hasMore.
    const products = await em.find(Product, effectiveWhere, {
      limit: params.limit + 1,
      orderBy: this.orderForSort(params.sort),
    });

    const hasMore = products.length > params.limit;
    const page = hasMore ? products.slice(0, params.limit) : products;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeObjectCursor({ createdAt: page[page.length - 1]!.createdAt.toISOString(), id: page[page.length - 1]!.id })
        : null;

    // Sales Channel visibility — only products associated with the channel
    // are returned. If no channel, everything public-visibility.
    const visibleIds = await this.filterByChannel(
      em,
      page.map((p) => p.id),
      channel,
    );

    // Attribute filter post-filtering (simple equality on attributeValues JSONB).
    const filtered = page.filter((p) => {
      if (!visibleIds.has(p.id)) return false;
      if (!params.attributeFilters) return true;
      for (const [k, values] of Object.entries(params.attributeFilters)) {
        const av = p.attributeValues[k];
        if (av === undefined) return false;
        if (!values.map((v) => String(v)).includes(String(av))) return false;
      }
      return true;
    });

    // Category filter
    let categoryFilteredIds: Set<string> | null = null;
    if (params.categorySlug) {
      categoryFilteredIds = await this.productIdsInCategoryTree(em, params.categorySlug);
    }

    // Build the summaries
    const summaries = await Promise.all(
      filtered
        .filter((p) => (categoryFilteredIds ? categoryFilteredIds.has(p.id) : true))
        .map((p) => this.toSummary(em, p, channel, ctx.preferredLanguage)),
    );

    return {
      data: summaries,
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

  async getProductByIdOrSlug(idOrSlug: string, ctx: CatalogQueryContext): Promise<ProductDetail> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const product = await em.findOne(Product, isUuid ? { id: idOrSlug } : { slug: idOrSlug });
    if (!product || product.deletedAt) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    if (product.status === 'inactive') {
      throw new HttpError(410, ERROR_CODES.PRODUCT_ARCHIVED, 'Product is inactive.');
    }

    // Visibility — if the product is not associated with the requested channel,
    // behave like it doesn't exist. Avoids exposing non-public catalogue.
    const visibleIds = await this.filterByChannel(em, [product.id], channel);
    if (!visibleIds.has(product.id)) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    const summary = await this.toSummary(em, product, channel, ctx.preferredLanguage);

    // Categories
    const categoryRows = await em.getConnection().execute<{ category_id: string }[]>(
      `select category_id from product_categories where product_id = ?`,
      [product.id],
    );
    const categoryIds = categoryRows.map((r) => r.category_id);
    // Feature 068 — the PDP breadcrumb/category list is customer-facing: skip
    // deactivated categories, and deleted ones (never filtered here before).
    const categories = await em.find(Category, {
      id: { $in: categoryIds },
      deletedAt: null,
      isActive: true,
    });

    // Assets
    const assetRows = await em.getConnection().execute<{ asset_id: string; position: number }[]>(
      `select asset_id, position from product_assets where product_id = ? order by position asc`,
      [product.id],
    );
    const assetIds = assetRows.map((r) => r.asset_id);
    const assets = await em.find(Asset, { id: { $in: assetIds } });

    // Variants
    const variants = product.type === 'configurable' ? await em.find(ProductVariant, { parentProductId: product.id }) : [];

    // Feature 002 — Attribute Set wired to this Product. Pulled in a
    // single findOne so PDP renders include the set's localized name
    // without a follow-up call.
    const attributeSetEntity = await em.findOne(AttributeSet, {
      id: product.attributeSetId,
    });

    // Feature 002 US3 — eager-load gallery + attachments for the PDP.
    // Gallery: items + label bridge zipped per item; Asset urls
    // resolved into a flat shape the storefront can render directly.
    const galleryItems = await em.find(
      GalleryItem,
      { productId: product.id },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    const galleryAssetIds = galleryItems.map((g) => g.assetId);
    const galleryAssetsById = new Map<string, Asset>();
    if (galleryAssetIds.length > 0) {
      const galleryAssets = await em.find(Asset, { id: { $in: galleryAssetIds } });
      for (const a of galleryAssets) galleryAssetsById.set(a.id, a);
    }
    const galleryLabels = galleryItems.length > 0
      ? await em.find(GalleryItemLabel, { productId: product.id })
      : [];
    const labelsByItem = new Map<string, ('base_image' | 'small_image' | 'thumbnail')[]>();
    for (const l of galleryLabels) {
      const existing = labelsByItem.get(l.galleryItemId) ?? [];
      existing.push(l.label);
      labelsByItem.set(l.galleryItemId, existing);
    }

    // Attachments + their types, eager-loaded in two queries.
    const attachmentRows = await em.find(
      ProductAttachment,
      { productId: product.id },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    const attachmentTypeIds = [...new Set(attachmentRows.map((a) => a.attachmentTypeId))];
    const attachmentTypesById = new Map<string, AttachmentType>();
    if (attachmentTypeIds.length > 0) {
      const types = await em.find(AttachmentType, { id: { $in: attachmentTypeIds } });
      for (const t of types) attachmentTypesById.set(t.id, t);
    }
    const attachmentAssetIds = [...new Set(attachmentRows.map((a) => a.assetId))];
    const attachmentAssetsById = new Map<string, Asset>();
    if (attachmentAssetIds.length > 0) {
      const aAssets = await em.find(Asset, { id: { $in: attachmentAssetIds } });
      for (const a of aAssets) attachmentAssetsById.set(a.id, a);
    }

    const descriptionText = this.pickLang(product.description, ctx.preferredLanguage, channel);
    const nameText = this.pickLang(product.name, ctx.preferredLanguage, channel);

    // Feature 012 / FR-030 — "Parametry produktu" tab projection.
    // Resolve every attribute that is flagged isVisibleOnProductPage
    // AND has a non-empty value on this product. Render the value per
    // the active locale (option label for select / enum / multiselect,
    // formatted scalar otherwise). Sorted by AttributeSetAttribute
    // position when assigned, by attribute key otherwise.
    const visibleAttributes = await this.buildVisibleAttributesProjection(
      em,
      product,
      ctx.preferredLanguage,
      channel,
    );

    const detail: ProductDetail = {
      ...summary,
      description: descriptionText,
      attributeValues: this.coerceAttributeValues(product.attributeValues),
      assets: assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        url: a.storageUrl,
        altText: a.altText ? this.pickLang(a.altText, ctx.preferredLanguage, channel) : null,
      })),
      variants: variants.map<VariantDto>((v) => ({
        id: v.id,
        sku: v.sku,
        variantAttributeValues: v.variantAttributeValues,
        priceOverride: v.priceOverride != null ? Number(v.priceOverride) : null,
        stockLevel: v.stockLevel ?? null,
      })),
      categories: categories.map((c) => ({
        id: c.id,
        name: this.pickLang(c.name, ctx.preferredLanguage, channel),
        slug: c.slug,
      })),
      seo: {
        metaTitle: nameText,
        metaDescription: descriptionText.slice(0, 160),
        openGraph: {
          title: nameText,
          description: descriptionText.slice(0, 240),
          // T097 — OG image prefers gallery Base Image (then Thumbnail,
          // then primaryAssetUrl). Base Image is the marketer's hero
          // shot, so social shares should land on it.
          imageUrl: (() => {
            const base = galleryItems
              .map((g) => ({
                asset: galleryAssetsById.get(g.assetId) ?? null,
                labels: labelsByItem.get(g.id) ?? [],
              }))
              .find((g) => g.asset && g.labels.includes('base_image'));
            if (base?.asset) return base.asset.storageUrl;
            const thumb = galleryItems
              .map((g) => ({
                asset: galleryAssetsById.get(g.assetId) ?? null,
                labels: labelsByItem.get(g.id) ?? [],
              }))
              .find((g) => g.asset && g.labels.includes('thumbnail'));
            if (thumb?.asset) return thumb.asset.storageUrl;
            return summary.primaryAssetUrl;
          })(),
        },
      },
      structuredDataJsonLd: {
        '@context': 'https://schema.org/',
        '@type': 'Product',
        name: nameText,
        sku: product.sku,
        description: descriptionText,
        ...(summary.price
          ? {
              offers: {
                '@type': 'Offer',
                price: summary.price.amount,
                priceCurrency: summary.price.currency,
                availability:
                  summary.stockIndicator === 'out_of_stock'
                    ? 'https://schema.org/OutOfStock'
                    : 'https://schema.org/InStock',
              },
            }
          : {}),
      },
      ...(attributeSetEntity
        ? {
            attributeSet: {
              id: attributeSetEntity.id,
              code: attributeSetEntity.code,
              name: attributeSetEntity.name,
            },
          }
        : {}),
      gallery: galleryItems.flatMap((g) => {
        const a = galleryAssetsById.get(g.assetId);
        if (!a) return [];
        return [
          {
            id: g.id,
            position: g.position,
            labels: [...(labelsByItem.get(g.id) ?? [])].sort(),
            asset: { id: a.id, kind: a.kind, url: a.storageUrl },
          },
        ];
      }),
      attachments: attachmentRows.flatMap((row) => {
        const t = attachmentTypesById.get(row.attachmentTypeId);
        const a = attachmentAssetsById.get(row.assetId);
        if (!t || !a) return [];
        return [
          {
            id: row.id,
            position: row.position,
            name: row.name,
            description: row.description ?? null,
            type: { id: t.id, code: t.code, name: t.name },
            asset: {
              id: a.id,
              kind: a.kind,
              url: a.storageUrl,
              filename: a.filename,
              sizeBytes: Number(a.sizeBytes),
              mimeType: a.mimeType,
            },
          },
        ];
      }),
      visibleAttributes,
    };

    // Feature 002 US4 — pre-grouped Product Links. Inactive targets and
    // channel-restricted ones are filtered by listForStorefront. Default
    // page sizes per spec.md US4 Assumptions: related=8, up-sell=4,
    // cross-sell=4.
    if (this.productLinkService) {
      const linkRows = await this.productLinkService.listForStorefront(
        product.id,
        {
          resolvedChannel: ctx.resolvedChannel,
          ...(ctx.preferredLanguage ? { preferredLanguage: ctx.preferredLanguage } : {}),
        },
      );
      const sliced = (rows: typeof linkRows, n: number): typeof linkRows =>
        rows.slice(0, n);
      detail.links = {
        related: sliced(
          linkRows.filter((l) => l.kind === 'related'),
          8,
        ),
        upSell: sliced(
          linkRows.filter((l) => l.kind === 'up_sell'),
          4,
        ),
        crossSell: sliced(
          linkRows.filter((l) => l.kind === 'cross_sell'),
          4,
        ),
      };
    }

    // Feature 002 US5 — type-discriminated composite payload. Only the
    // branch matching `product.type` is populated; other branches are
    // omitted so the response stays compact and the storefront can do a
    // simple type switch.
    if (product.type === 'grouped') {
      const items = await em.find(
        GroupedItem,
        { parentProductId: product.id },
        { orderBy: { position: 'asc', id: 'asc' } },
      );
      const childIds = items.map((i) => i.childProductId);
      const summaries = await this.summariesForIds(em, childIds, ctx, channel);
      detail.groupedItems = items.flatMap((i) => {
        const summary = summaries.get(i.childProductId);
        if (!summary) return [];
        return [{ id: i.id, position: i.position, quantity: i.quantity, product: summary }];
      });
    } else if (product.type === 'bundle') {
      const slots = await em.find(
        BundleSlot,
        { parentProductId: product.id },
        { orderBy: { position: 'asc', id: 'asc' } },
      );
      const slotIds = slots.map((s) => s.id);
      const options =
        slotIds.length > 0
          ? await em.find(
              BundleSlotOption,
              { slotId: { $in: slotIds } },
              { orderBy: { position: 'asc', id: 'asc' } },
            )
          : [];
      const optsBySlot = new Map<string, BundleSlotOption[]>();
      for (const opt of options) {
        const list = optsBySlot.get(opt.slotId) ?? [];
        list.push(opt);
        optsBySlot.set(opt.slotId, list);
      }
      const optionProductIds = [...new Set(options.map((o) => o.optionProductId))];
      const summaries = await this.summariesForIds(em, optionProductIds, ctx, channel);
      detail.bundleSlots = slots.map((s) => ({
        id: s.id,
        name: s.name,
        minQuantity: s.minQuantity,
        maxQuantity: s.maxQuantity,
        position: s.position,
        options: (optsBySlot.get(s.id) ?? []).flatMap((o) => {
          const summary = summaries.get(o.optionProductId);
          if (!summary) return [];
          return [
            {
              id: o.id,
              defaultQuantity: o.defaultQuantity,
              position: o.position,
              product: summary,
            },
          ];
        }),
      }));
    } else if (product.type === 'virtual') {
      detail.virtual = {
        downloadAssetId: product.downloadAssetId ?? null,
        downloadUrl: product.downloadUrl ?? null,
      };
    }

    // Feature 043 — packaging units (only meaningful for the eligible types,
    // which are also the only ones that can have rows).
    if (product.type === 'simple' || product.type === 'configurable') {
      const packagingUnits = await em.find(
        ProductPackagingUnit,
        { productId: product.id },
        { orderBy: { position: 'asc', name: 'asc' } },
      );
      if (packagingUnits.length > 0) {
        detail.packagingUnits = packagingUnits.map((u) => ({
          id: u.id,
          name: u.name,
          baseQuantity: u.baseQuantity,
          position: u.position,
          isDefault: u.isDefault,
        }));
      }
    }

    return detail;
  }

  /**
   * Resolve a batch of products into storefront-shape summaries (id, sku,
   * slug, localized name, primary asset url via gallery thumb chain,
   * price honoring sales-channel public flag). Used by US5 composite
   * eager-load — keeps the per-product fanout to a constant 3-4 queries
   * regardless of how many children/options a parent has.
   */
  private async summariesForIds(
    em: EntityManager,
    ids: string[],
    ctx: CatalogQueryContext,
    channel: CatalogResolvedChannel,
  ): Promise<
    Map<
      string,
      {
        id: string;
        sku: string;
        slug: string;
        name: string;
        primaryAssetUrl: string | null;
        price: { amount: number; currency: string } | null;
      }
    >
  > {
    const result = new Map<string, {
      id: string;
      sku: string;
      slug: string;
      name: string;
      primaryAssetUrl: string | null;
      price: { amount: number; currency: string } | null;
    }>();
    if (ids.length === 0) return result;
    const products = await em.find(Product, { id: { $in: ids } });

    // Primary asset url via gallery thumb chain → base_image → first item
    // → legacy product_assets first row (mirrors toSummary).
    const galleryRows = await em.getConnection().execute<{
      product_id: string;
      storage_url: string;
      label: string | null;
      position: number;
    }[]>(
      `select gi.product_id, a.storage_url, gil.label, gi.position
         from gallery_items gi
         join assets a on a.id = gi.asset_id
         left join gallery_item_labels gil on gil.gallery_item_id = gi.id
         where gi.product_id in (${ids.map(() => '?').join(',')})
         order by gi.product_id, gi.position asc, gi.id asc`,
      ids,
    );
    const galleryByProduct = new Map<string, typeof galleryRows>();
    for (const row of galleryRows) {
      const list = galleryByProduct.get(row.product_id) ?? [];
      list.push(row);
      galleryByProduct.set(row.product_id, list);
    }
    const assetUrlByProduct = new Map<string, string | null>();
    for (const id of ids) {
      const gallery = galleryByProduct.get(id) ?? [];
      const findByLabel = (label: string): string | null =>
        gallery.find((r) => r.label === label)?.storage_url ?? null;
      const url =
        findByLabel('thumbnail') ??
        findByLabel('base_image') ??
        gallery[0]?.storage_url ??
        null;
      assetUrlByProduct.set(id, url);
    }
    const missing = ids.filter((id) => !assetUrlByProduct.get(id));
    if (missing.length > 0) {
      const legacy = await em.getConnection().execute<{
        product_id: string;
        storage_url: string;
      }[]>(
        `select pa.product_id, a.storage_url
           from product_assets pa join assets a on a.id = pa.asset_id
           where pa.product_id in (${missing.map(() => '?').join(',')})
           order by pa.product_id, pa.position asc`,
        missing,
      );
      const seen = new Set<string>();
      for (const row of legacy) {
        if (seen.has(row.product_id)) continue;
        seen.add(row.product_id);
        assetUrlByProduct.set(row.product_id, row.storage_url);
      }
    }

    const isPublic = channel?.isPublic ?? true;
    for (const p of products) {
      const rawPrice = Number(
        p.attributeValues['defaultPrice'] ??
          p.attributeValues['price'] ??
          Number.NaN,
      );
      const currency = channel?.defaultCurrency ?? 'PLN';
      const price =
        isPublic && Number.isFinite(rawPrice) ? { amount: rawPrice, currency } : null;
      result.set(p.id, {
        id: p.id,
        sku: p.sku,
        slug: p.slug,
        name: this.pickLang(p.name, ctx.preferredLanguage, channel),
        primaryAssetUrl: assetUrlByProduct.get(p.id) ?? null,
        price,
      });
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Categories
  // ------------------------------------------------------------------

  async getCategoryTree(ctx: CatalogQueryContext): Promise<CategoryNode[]> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;
    // Feature 068 — an inactive category is invisible to customers, and so is
    // everything under it: its children never reach `build()` because only
    // roots seed the walk.
    const rows = await em.find(
      Category,
      { deletedAt: null, isActive: true },
      { orderBy: { sortOrder: 'asc' } },
    );

    // Directly-assigned, channel-visible products per category.
    const directSets = await this.directProductSetsByCategory(em, channel);

    const byParent = new Map<string | null, Category[]>();
    for (const row of rows) {
      const key = row.parentCategoryId ?? null;
      const list = byParent.get(key) ?? [];
      list.push(row);
      byParent.set(key, list);
    }

    // Roll up to a *distinct* product count over each category's whole subtree
    // (self + descendants). A parent category — e.g. the catalog root — would
    // otherwise show 0 because products are assigned to its leaf categories,
    // not to it directly. Counting a Set de-duplicates products that sit in
    // more than one branch of the subtree.
    const subtreeCounts = new Map<string, number>();
    const collectSubtree = (categoryId: string): Set<string> => {
      const acc = new Set<string>(directSets.get(categoryId) ?? []);
      for (const child of byParent.get(categoryId) ?? []) {
        for (const pid of collectSubtree(child.id)) acc.add(pid);
      }
      subtreeCounts.set(categoryId, acc.size);
      return acc;
    };
    for (const root of byParent.get(null) ?? []) collectSubtree(root.id);

    const build = (parentId: string | null): CategoryNode[] => {
      const children = byParent.get(parentId) ?? [];
      return children.map((c) => ({
        id: c.id,
        name: this.pickLang(c.name, ctx.preferredLanguage, channel),
        slug: c.slug,
        sortOrder: c.sortOrder,
        productCount: subtreeCounts.get(c.id) ?? 0,
        children: build(c.id),
      }));
    };
    return build(null);
  }

  // ------------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------------

  async getFilterDefinitions(ctx: CatalogQueryContext): Promise<FilterDefinition[]> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;
    const attrs = await this.#requireAttributeRead().listByFlag('isFilterable');

    // Build option / range facets by scanning Products in the channel.
    const products = await em.find(Product, { status: 'active', deletedAt: null });
    const visibleIds = await this.filterByChannel(em, products.map((p) => p.id), channel);
    const visible = products.filter((p) => visibleIds.has(p.id));

    const definitions = attrs.map((a) => {
      const label = this.pickLang(a.label, ctx.preferredLanguage, channel);
      const def: FilterDefinition = {
        attributeKey: a.key,
        label,
        valueType: a.valueType,
        filterPosition: a.filterPosition,
      };
      if (
        a.valueType === 'enum' ||
        a.valueType === 'select' ||
        a.valueType === 'multiselect' ||
        a.valueType === 'boolean' ||
        a.valueType === 'string'
      ) {
        const optionCounts = new Map<string, number>();
        for (const p of visible) {
          const v = p.attributeValues[a.key];
          if (v === undefined || v === null) continue;
          // multiselect carries an array of selected option values.
          if (Array.isArray(v)) {
            for (const item of v) {
              const key = String(item);
              optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
            }
          } else {
            const key = String(v);
            optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
          }
        }
        def.options = Array.from(optionCounts.entries()).map(([value, count]) => ({
          value,
          label: value,
          count,
        }));
      } else if (a.valueType === 'number' || a.valueType === 'price' || a.valueType === 'date') {
        let min: number | undefined;
        let max: number | undefined;
        for (const p of visible) {
          const raw = p.attributeValues[a.key];
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(n)) continue;
          if (min === undefined || n < min) min = n;
          if (max === undefined || n > max) max = n;
        }
        if (min !== undefined && max !== undefined) {
          def.range = { min, max };
        }
      }
      return def;
    });

    // Feature 012 / FR-029 — omit filters that have zero values across
    // every visible product. Option-style filters with an empty options
    // array (no facet hits) are skipped; range-style filters with no
    // resolved min/max are also skipped.
    const nonEmpty = definitions.filter((d) => {
      if (d.options !== undefined) return d.options.length > 0;
      if (d.range !== undefined) return true;
      return false;
    });

    // Feature 055 (US4) — merge Category custom fields flagged `config.filterable`.
    // These are category-level filters whose options come from the field
    // definition, not from a product-facet scan, so they are appended AFTER the
    // product-facet `nonEmpty` drop. The catalog interprets the opaque `config`
    // (FR-006); the generic custom-fields core is unaware of catalog.
    const customFilters = await this.buildCustomFieldFilters(ctx, channel);

    const merged = [...nonEmpty, ...customFilters];

    // Feature 012 / FR-027 + FR-028 — pre-sort by filterPosition ASC,
    // then by resolved label ASC. Storefront consumes the order verbatim.
    merged.sort((a, b) => {
      if (a.filterPosition !== b.filterPosition) return a.filterPosition - b.filterPosition;
      return a.label.localeCompare(b.label);
    });

    return merged;
  }

  /**
   * Feature 055 (US4) — resolve the filterable Category custom fields into
   * {@link FilterDefinition}s. Returns `[]` when no definition source is wired.
   * Select/multiselect fields carry their defined options; scalar fields carry
   * neither options nor range (they render as a keyword/value filter client-side).
   */
  private async buildCustomFieldFilters(
    ctx: CatalogQueryContext,
    channel: CatalogQueryContext['resolvedChannel'],
  ): Promise<FilterDefinition[]> {
    if (!this.customFieldDefinitions) return [];
    const defs = await this.customFieldDefinitions.listForEntity('category');
    const out: FilterDefinition[] = [];
    for (const { definition, options } of defs) {
      if (definition.config?.['filterable'] !== true) continue;
      const label =
        this.pickLang(definition.label, ctx.preferredLanguage, channel) || definition.labelDefault;
      const isSelect = definition.valueType === 'select' || definition.valueType === 'multiselect';
      const def: FilterDefinition = {
        // Namespaced so a custom field cannot collide with a product attribute key.
        attributeKey: `cf.${definition.key}`,
        label,
        valueType: definition.valueType === 'text' ? 'string' : definition.valueType,
        filterPosition: definition.sortOrder,
        ...(isSelect
          ? {
              options: options.map((o) => ({
                value: o.value,
                label:
                  this.pickLang(o.label, ctx.preferredLanguage, channel) || o.labelDefault,
                count: 0,
              })),
            }
          : {}),
      };
      out.push(def);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Feature 012 / FR-030 — build the "Parametry produktu" tab payload
   * for one product. Returns every attribute that meets BOTH:
   *   1. attribute.isVisibleOnProductPage === true
   *   2. product.attributeValues[attribute.key] is non-null + non-empty
   *
   * For select / enum / multiselect types `valueRendered` is the
   * resolved per-locale option label (with fallback to labelDefault);
   * for boolean types it's 'Yes' / 'No'; for number / price / string
   * types it's the value coerced to string.
   *
   * Sorted by AttributeSetAttribute.position when the product has an
   * Attribute Set, else by attribute key ASC for determinism.
   */
  private async buildVisibleAttributesProjection(
    em: EntityManager,
    product: Product,
    preferredLanguage: string | undefined,
    channel: CatalogResolvedChannel,
  ): Promise<Array<{ key: string; label: string; valueType: CatalogAttributeView['valueType']; valueRendered: string }>> {
    const values = product.attributeValues ?? {};
    const valueKeys = Object.keys(values).filter((k) => {
      const v = values[k];
      return v !== undefined && v !== null && v !== '';
    });
    if (valueKeys.length === 0) return [];

    // Feature 061 — attribute metadata + options come from the composed view.
    const valueKeySet = new Set(valueKeys);
    const allViews = await this.#requireAttributeRead().listAll();
    const attrs = allViews.filter((a) => valueKeySet.has(a.key) && a.isVisibleOnProductPage);
    if (attrs.length === 0) return [];

    const optionLabelByAttrAndValue = new Map<
      string,
      Map<string, { label: Record<string, string>; labelDefault: string }>
    >();
    for (const a of attrs) {
      if (a.options.length === 0) continue;
      const bucket = new Map<string, { label: Record<string, string>; labelDefault: string }>();
      for (const o of a.options) {
        bucket.set(o.value, { label: o.label ?? {}, labelDefault: o.labelDefault });
      }
      optionLabelByAttrAndValue.set(a.id, bucket);
    }

    const renderOptionLabel = (attrId: string, value: string): string => {
      const bucket = optionLabelByAttrAndValue.get(attrId);
      const meta = bucket?.get(value);
      if (!meta) return value;
      return this.pickLang(meta.label, preferredLanguage, channel) || meta.labelDefault;
    };

    // Pull the AttributeSetAttribute positions for sort determinism
    // (membership is definition-keyed since feature 061).
    let positionByKey = new Map<string, number>();
    if (product.attributeSetId) {
      const conn = em.getConnection();
      const posRows = (await conn.execute<
        Array<{ custom_field_definition_id: string; position: number }>
      >(
        `select custom_field_definition_id, position
         from attribute_set_attributes
         where attribute_set_id = ?`,
        [product.attributeSetId],
      )) as Array<{ custom_field_definition_id: string; position: number }>;
      const keyByDefinitionId = new Map(
        allViews.map((v) => [v.customFieldDefinitionId, v.key]),
      );
      positionByKey = new Map(
        posRows
          .map((r) => [keyByDefinitionId.get(r.custom_field_definition_id), r.position] as const)
          .filter((pair): pair is [string, number] => pair[0] !== undefined),
      );
    }

    const items = attrs.map((a) => {
      const raw = values[a.key];
      let valueRendered = '';
      if (Array.isArray(raw)) {
        // multiselect — comma-separated joined option labels
        valueRendered = raw
          .map((item) => renderOptionLabel(a.id, String(item)))
          .filter((s) => s !== '')
          .join(', ');
      } else if (a.valueType === 'select' || a.valueType === 'enum') {
        valueRendered = renderOptionLabel(a.id, String(raw));
      } else if (a.valueType === 'boolean') {
        valueRendered = raw === true || raw === 'true' ? 'Yes' : 'No';
      } else {
        valueRendered = String(raw);
      }
      const label = this.pickLang(a.label, preferredLanguage, channel) || a.labelDefault;
      return {
        key: a.key,
        label,
        valueType: a.valueType,
        valueRendered,
      };
    });

    items.sort((x, y) => {
      const px = positionByKey.get(x.key) ?? Number.MAX_SAFE_INTEGER;
      const py = positionByKey.get(y.key) ?? Number.MAX_SAFE_INTEGER;
      if (px !== py) return px - py;
      return x.key.localeCompare(y.key);
    });

    return items;
  }

  /** Cached per-call list of attribute keys that should match free-text search. */
  private async searchableAttributeKeys(_em: EntityManager): Promise<string[]> {
    const attrs = await this.#requireAttributeRead().listByFlag('isSearchable');
    return attrs.map((a) => a.key);
  }

  /**
   * Feature 007 — list of attribute keys flagged `is_comparable=true`,
   * sorted alphabetically. Consumed by the comparisons module's
   * comparison-page projection (`ComparableAttributeProjection`). Public
   * because it crosses a module boundary (Constitution I — comparisons
   * MUST consume catalog through a documented service port, not by
   * importing internals).
   */
  async comparableAttributeKeys(): Promise<string[]> {
    // listByFlag orders by key ASC (legacy parity).
    const attrs = await this.#requireAttributeRead().listByFlag('isComparable');
    return attrs.map((a) => a.key);
  }

  /**
   * Feature 012 / US8 — list of attribute keys flagged `is_promo_rule=true`,
   * sorted alphabetically. Consumed by the promotions module's rule-target
   * picker endpoint and by the promotion-rule resolver's skip-on-toggle
   * check (FR-039). Public because it crosses a module boundary
   * (Constitution I — promotions MUST consume catalog through a documented
   * service port, not by importing internals).
   */
  async promoRuleAttributeKeys(): Promise<string[]> {
    // listByFlag orders by key ASC (legacy parity).
    const attrs = await this.#requireAttributeRead().listByFlag('isPromoRule');
    return attrs.map((a) => a.key);
  }

  /**
   * Feature 012 / US8 — load one attribute by key with its option list
   * inline. Returns `null` when the attribute does not exist. The option
   * list is empty for non-select-style types. Used by:
   *   - Promotion-rule editor (criterion picker payload)
   *   - PromotionRuleService.matches() to validate option values
   *     against the attribute's authoritative option set.
   */
  async getAttributeWithOptions(key: string): Promise<{
    id: string;
    key: string;
    label: Record<string, string>;
    labelDefault: string;
    valueType: CatalogAttributeView['valueType'];
    isPromoRule: boolean;
    options: Array<{ value: string; label: Record<string, string>; labelDefault: string }>;
  } | null> {
    const attr = await this.#requireAttributeRead().getByIdOrKey(key);
    if (!attr) return null;
    const options = [...attr.options]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
      .map((o) => ({
        value: o.value,
        label: o.label ?? {},
        labelDefault: o.labelDefault,
      }));
    return {
      id: attr.id,
      key: attr.key,
      label: attr.label ?? {},
      labelDefault: attr.labelDefault,
      valueType: attr.valueType,
      isPromoRule: attr.isPromoRule,
      options,
    };
  }

  /**
   * Build a MikroORM where-clause for "attributeValues[key] contains query
   * (case-insensitive)". MikroORM doesn't have a first-class JSONB query
   * helper for the `->>` operator, so we use `$jsonb` style by selecting the
   * value via the operators object.
   */
  private searchableJsonbClause(key: string, query: string): Record<string, unknown> {
    // expr` returns the property at `key` cast to text; ILIKE handles
    // case-insensitivity. We rely on MikroORM's `raw()` operator-form passed
    // through to Knex.
    return { [key]: { $ilike: `%${query}%` } };
  }

  private orderForSort(sort: ListProductsParams['sort']): Record<string, 'asc' | 'desc'> {
    switch (sort) {
      case 'name':
        return { slug: 'asc', id: 'asc' };
      case '-name':
        return { slug: 'desc', id: 'desc' };
      case '-createdAt':
      case 'relevance':
      default:
        return { createdAt: 'desc', id: 'desc' };
    }
  }

  private async filterByChannel(
    em: EntityManager,
    productIds: string[],
    channel: CatalogResolvedChannel,
  ): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    // Feature 053 / Principle XII: a channel is ALWAYS resolved, so the catalog
    // constrains to the resolved channel's `sales_channel_products` membership
    // and fails closed to an empty set — never the full cross-channel set.
    const rows = await em.getConnection().execute<{ product_id: string }[]>(
      `select product_id from sales_channel_products where sales_channel_id = ? and product_id in (${productIds.map(() => '?').join(',')})`,
      [channel.id, ...productIds],
    );
    return new Set(rows.map((r) => r.product_id));
  }

  /**
   * Product ids assigned to each requested category **or any of its
   * descendants**, keyed by the requested category id.
   *
   * Exported as a cross-module port (Constitution I): feature 067's feed
   * criteria compiler needs "category membership including descendants"
   * (FR-025) and must not learn the shape of `product_categories` or of the
   * category tree to get it. Unknown or deleted category ids come back as
   * empty sets rather than being dropped, so a criterion naming a deleted
   * category narrows to nothing instead of silently disappearing.
   *
   * No channel scoping here on purpose — the caller applies its own
   * eligibility floor, which for a feed is stricter than the storefront's.
   */
  async expandCategoryProductIds(categoryIds: string[]): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    if (categoryIds.length === 0) return result;
    const em = this.emFactory();

    const requested = [...new Set(categoryIds)];
    // Descendant ids per requested root (BFS, one query per level for the
    // whole batch — the tree is shallow and this keeps the round trips flat).
    const descendants = new Map<string, string[]>();
    for (const id of requested) descendants.set(id, [id]);

    // Visited set per root. Re-parenting is guarded against cycles
    // (`category-admin.service.ts`), but that guard itself is written to
    // tolerate *pre-existing* cycles in the data, so a corrupted
    // `parent_category_id` chain is reachable here. Without this the loop
    // never terminates: it would re-query the same level forever and grow
    // `descendants` without bound.
    const seen = new Map<string, Set<string>>(requested.map((id) => [id, new Set([id])]));

    let frontier = new Map<string, string[]>(requested.map((id) => [id, [id]]));
    while (frontier.size > 0) {
      const parentIds = [...new Set([...frontier.values()].flat())];
      const children = await em.find(Category, {
        parentCategoryId: { $in: parentIds },
        deletedAt: null,
      });
      if (children.length === 0) break;
      const childrenByParent = new Map<string, string[]>();
      for (const child of children) {
        const parent = String(child.parentCategoryId);
        childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), child.id]);
      }
      const next = new Map<string, string[]>();
      for (const [root, level] of frontier) {
        const visited = seen.get(root) ?? new Set<string>();
        const nextLevel = level
          .flatMap((id) => childrenByParent.get(id) ?? [])
          .filter((id) => !visited.has(id));
        if (nextLevel.length === 0) continue;
        for (const id of nextLevel) visited.add(id);
        seen.set(root, visited);
        descendants.set(root, [...(descendants.get(root) ?? []), ...nextLevel]);
        next.set(root, nextLevel);
      }
      frontier = next;
    }

    const allIds = [...new Set([...descendants.values()].flat())];
    const rows = await em.getConnection().execute<{ category_id: string; product_id: string }[]>(
      `select category_id, product_id from product_categories
        where category_id in (${allIds.map(() => '?').join(',')})`,
      allIds,
    );
    const productsByCategory = new Map<string, string[]>();
    for (const row of rows) {
      productsByCategory.set(row.category_id, [
        ...(productsByCategory.get(row.category_id) ?? []),
        row.product_id,
      ]);
    }
    for (const id of requested) {
      const set = new Set<string>();
      for (const categoryId of descendants.get(id) ?? []) {
        for (const productId of productsByCategory.get(categoryId) ?? []) set.add(productId);
      }
      result.set(id, set);
    }
    return result;
  }

  private async productIdsInCategoryTree(
    em: EntityManager,
    categorySlug: string,
  ): Promise<Set<string>> {
    // Feature 068 — an inactive category narrows to nothing, and an inactive
    // branch contributes no products to an active ancestor.
    const root = await em.findOne(Category, {
      slug: categorySlug,
      deletedAt: null,
      isActive: true,
    });
    if (!root) return new Set();

    // Collect descendant ids (BFS).
    const all: string[] = [root.id];
    let frontier: string[] = [root.id];
    while (frontier.length > 0) {
      const children = await em.find(Category, {
        parentCategoryId: { $in: frontier },
        deletedAt: null,
        isActive: true,
      });
      const nextIds = children.map((c) => c.id);
      all.push(...nextIds);
      frontier = nextIds;
    }

    const rows = await em.getConnection().execute<{ product_id: string }[]>(
      `select product_id from product_categories where category_id in (${all.map(() => '?').join(',')})`,
      all,
    );
    return new Set(rows.map((r) => r.product_id));
  }

  /**
   * Set of channel-visible product ids directly assigned to each category
   * (i.e. via a `product_categories` row). Subtree roll-up to ancestors is
   * done by the caller, which has the parent map to walk.
   */
  private async directProductSetsByCategory(
    em: EntityManager,
    channel: CatalogResolvedChannel,
  ): Promise<Map<string, Set<string>>> {
    const base = await em.getConnection().execute<{ category_id: string; product_id: string }[]>(
      `select category_id, product_id from product_categories`,
    );
    if (base.length === 0) return new Map();

    // Filter by visibility.
    const visibleIds = await this.filterByChannel(
      em,
      base.map((r) => r.product_id),
      channel,
    );
    const sets = new Map<string, Set<string>>();
    for (const row of base) {
      if (!visibleIds.has(row.product_id)) continue;
      let set = sets.get(row.category_id);
      if (!set) {
        set = new Set<string>();
        sets.set(row.category_id, set);
      }
      set.add(row.product_id);
    }
    return sets;
  }

  private async toSummary(
    em: EntityManager,
    product: Product,
    channel: CatalogResolvedChannel,
    preferredLanguage?: string,
  ): Promise<ProductSummary> {
    // Primary asset — for listings prefer the gallery's Thumbnail (US3),
    // then Base Image, then any first gallery item, finally the legacy
    // product_assets row. Resolution chain pinned by T096.
    const galleryRows = await em.getConnection().execute<{
      storage_url: string;
      label: string | null;
      position: number;
    }[]>(
      `select a.storage_url, gil.label, gi.position
         from gallery_items gi
         join assets a on a.id = gi.asset_id
         left join gallery_item_labels gil on gil.gallery_item_id = gi.id
         where gi.product_id = ?
         order by gi.position asc, gi.id asc`,
      [product.id],
    );
    let primaryAssetUrl: string | null = null;
    const findByLabel = (label: string): string | null =>
      galleryRows.find((r) => r.label === label)?.storage_url ?? null;
    primaryAssetUrl =
      findByLabel('thumbnail') ??
      findByLabel('base_image') ??
      galleryRows[0]?.storage_url ??
      null;
    if (!primaryAssetUrl) {
      const primary = await em.getConnection().execute<{ storage_url: string }[]>(
        `select a.storage_url from product_assets pa join assets a on a.id = pa.asset_id where pa.product_id = ? order by pa.position asc limit 1`,
        [product.id],
      );
      primaryAssetUrl = primary[0]?.storage_url ?? null;
    }

    // Category slugs
    const catRows = await em.getConnection().execute<{ slug: string }[]>(
      `select c.slug from product_categories pc join categories c on c.id = pc.category_id where pc.product_id = ?`,
      [product.id],
    );

    // Price (from PriceList module in US2; for US1 we derive from attributeValues.defaultPrice
    // if set, otherwise null). Sales Channel visibility strips price on non-public channels.
    const rawPrice = Number(
      product.attributeValues['defaultPrice'] ?? product.attributeValues['price'] ?? Number.NaN,
    );
    const currency = channel?.defaultCurrency ?? 'PLN';
    const showPrice = channel?.isPublic ?? true;
    const price =
      showPrice && Number.isFinite(rawPrice) ? { amount: rawPrice, currency } : null;

    const nameText = this.pickLang(product.name, preferredLanguage, channel);

    return {
      id: product.id,
      sku: product.sku,
      type: product.type,
      name: nameText,
      slug: product.slug,
      categorySlugs: catRows.map((r) => r.slug),
      primaryAssetUrl,
      price,
      stockIndicator: null,
      stockLevel: null,
    };
  }

  private pickLang(
    blob: Record<string, string>,
    preferred?: string,
    channel?: CatalogResolvedChannel,
  ): string {
    const preferredLangs = [preferred, channel?.defaultLanguage, 'en-US', 'en'].filter(
      (v): v is string => typeof v === 'string',
    );
    for (const lang of preferredLangs) {
      const hit = blob[lang];
      if (hit) return hit;
    }
    const anyKey = Object.keys(blob)[0];
    return anyKey ? (blob[anyKey] ?? '') : '';
  }

  private coerceAttributeValues(v: Record<string, unknown>): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        out[k] = val;
      } else if (val !== null && val !== undefined) {
        out[k] = String(val);
      }
    }
    return out;
  }
}
