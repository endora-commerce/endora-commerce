import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import type {
  CatalogProductPricingRef,
  CatalogAttributeValueQuery,
  CatalogAdminNamePageQuery,
  CatalogPackagingUnitRecord,
  CatalogProductLinkRow,
  CatalogProductLookupOptions,
  CatalogProductReadPort,
  CatalogProductRecord,
  CatalogProductValueOverrideRecord,
  CatalogValueOverrideLookupOptions,
  CatalogProductVariantRecord,
  ProductLinkKind,
} from '@endora-commerce/contracts';
import { adminNameLanguage } from '@endora-commerce/contracts';
import { Product } from '../entities/product.entity.js';
import { ProductLink } from '../entities/product-link.entity.js';
import { ProductPackagingUnit } from '../entities/product-packaging-unit.entity.js';
import { ProductValueOverride } from '../entities/product-value-override.entity.js';
import { ProductVariant } from '../entities/product-variant.entity.js';
import { uuidArrayLiteral } from './sql-id-arrays.js';

/**
 * The row-level read model `catalog` publishes (feature 075, Phase P).
 *
 * Forty-six of this module's 107 inbound import sites are a read of the
 * `Product` entity, and the sixty across `Product` and `Category` together are
 * the largest single cluster in the sweep. They reduce to four questions — by
 * id, by ids, by sku, by skus — differing only in which of the three
 * soft-delete / status filters each caller happened to apply.
 *
 * That variation is the reason the filters are an **options object** rather
 * than separate methods. Sixteen call sites pass `deletedAt: null`, four also
 * pass `status: 'active'`, and the rest deliberately pass neither, because an
 * inactive or soft-deleted product still has to resolve from a historical
 * order, invoice, RFQ or shopping list. Naming the two narrowings is what
 * makes each caller's choice visible; defaulting both to `false` keeps the
 * wider read the default it already is.
 */
export class CatalogProductReadService implements CatalogProductReadPort {
  readonly #sparseSearchLimit: number;

  constructor(
    private readonly emFactory: () => EntityManager,
    options: {
      /**
       * Feature 161 (G15): at most this many matching members, a searched page
       * is cut from the trigram hits; above it, from the ordered index walk.
       * Both answer the same page; a test forces each.
       */
      sparseSearchLimit?: number;
    } = {},
  ) {
    this.#sparseSearchLimit = options.sparseSearchLimit ?? SPARSE_SEARCH_LIMIT;
  }

  async findById(
    id: string,
    options?: CatalogProductLookupOptions,
  ): Promise<CatalogProductRecord | null> {
    const product = await this.emFactory().findOne(Product, {
      id,
      ...productFilter(options),
    });
    return product ? toCatalogProductRecord(product) : null;
  }

  async findByIds(
    ids: readonly string[],
    options?: CatalogProductLookupOptions,
  ): Promise<CatalogProductRecord[]> {
    if (ids.length === 0) return [];
    const products = await this.emFactory().find(Product, {
      id: { $in: [...ids] },
      ...productFilter(options),
    });
    return products.map(toCatalogProductRecord);
  }

  async findBySku(
    sku: string,
    options?: CatalogProductLookupOptions,
  ): Promise<CatalogProductRecord | null> {
    const product = await this.emFactory().findOne(Product, {
      sku,
      ...productFilter(options),
    });
    return product ? toCatalogProductRecord(product) : null;
  }

  async findBySkus(
    skus: readonly string[],
    options?: CatalogProductLookupOptions,
  ): Promise<CatalogProductRecord[]> {
    if (skus.length === 0) return [];
    const products = await this.emFactory().find(Product, {
      sku: { $in: [...skus] },
      ...productFilter(options),
    });
    return products.map(toCatalogProductRecord);
  }

  async countByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.emFactory().count(Product, { id: { $in: [...ids] } });
  }

  async listAll(options?: CatalogProductLookupOptions): Promise<CatalogProductRecord[]> {
    const products = await this.emFactory().find(
      Product,
      productFilter(options) as FilterQuery<Product>,
      { orderBy: { sku: 'asc' } },
    );
    return products.map(toCatalogProductRecord);
  }

  /**
   * Issue #416 — one statement over `products`, no entity built: the price
   * surface's worker reads it per whole build, and `listAll` hydrated every
   * product (3.8 s for 50 000) to use two fields.
   */
  async listPricingRefs(): Promise<CatalogProductPricingRef[]> {
    const rows = await this.emFactory().execute<Array<{ id: string; attribute_values: Record<string, unknown> | null }>>(
      `select "id", "attribute_values" from "products" order by "id"`,
    );
    return rows.map(toPricingRef);
  }

  async findPricingRefsByIds(ids: readonly string[]): Promise<CatalogProductPricingRef[]> {
    if (ids.length === 0) return [];
    // One array parameter, whatever the size of the set: a whole build's
    // candidates can be the catalogue (review 2 of #424).
    const rows = await this.emFactory().execute<Array<{ id: string; attribute_values: Record<string, unknown> | null }>>(
      `select "id", "attribute_values" from "products" where "id" = any(?::uuid[]) order by "id"`,
      [uuidArrayLiteral([...new Set(ids)])],
    );
    return rows.map(toPricingRef);
  }

  async listVariantsByProductIds(
    productIds: readonly string[],
  ): Promise<CatalogProductVariantRecord[]> {
    if (productIds.length === 0) return [];
    const variants = await this.emFactory().find(
      ProductVariant,
      { parentProductId: { $in: [...productIds] } },
      { orderBy: { sku: 'asc' } },
    );
    return variants.map(toCatalogProductVariantRecord);
  }

  async findVariantsBySkus(skus: readonly string[]): Promise<CatalogProductVariantRecord[]> {
    if (skus.length === 0) return [];
    const variants = await this.emFactory().find(ProductVariant, { sku: { $in: [...skus] } });
    return variants.map(toCatalogProductVariantRecord);
  }

  async findVariantInProduct(
    parentProductId: string,
    variantId: string,
  ): Promise<CatalogProductVariantRecord | null> {
    const variant = await this.emFactory().findOne(ProductVariant, {
      id: variantId,
      parentProductId,
    });
    return variant ? toCatalogProductVariantRecord(variant) : null;
  }

  async findPackagingUnitInProduct(
    productId: string,
    packagingUnitId: string,
  ): Promise<CatalogPackagingUnitRecord | null> {
    const unit = await this.emFactory().findOne(ProductPackagingUnit, {
      id: packagingUnitId,
      productId,
    });
    return unit ? toCatalogPackagingUnitRecord(unit) : null;
  }

  /**
   * Feature 155 — one query over every given product, ordered by product id,
   * then position, then name (`contracts/catalog-api.md` §5). No policy: the
   * caller passes ids it has already vetted (threat F12).
   */
  async listPackagingUnitsByProductIds(
    productIds: readonly string[],
  ): Promise<CatalogPackagingUnitRecord[]> {
    if (productIds.length === 0) return [];
    const units = await this.emFactory().find(
      ProductPackagingUnit,
      { productId: { $in: [...productIds] } },
      { orderBy: { productId: 'asc', position: 'asc', name: 'asc' } },
    );
    return units.map(toCatalogPackagingUnitRecord);
  }

  async listLinksBySourceIds(
    sourceProductIds: readonly string[],
    kind?: ProductLinkKind,
  ): Promise<CatalogProductLinkRow[]> {
    if (sourceProductIds.length === 0) return [];
    const links = await this.emFactory().find(
      ProductLink,
      {
        sourceProductId: { $in: [...sourceProductIds] },
        ...(kind === undefined ? {} : { kind }),
      },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    return links.map(toCatalogProductLinkRow);
  }

  async listValueOverridesByProductIds(
    productIds: readonly string[],
    options: CatalogValueOverrideLookupOptions = {},
  ): Promise<CatalogProductValueOverrideRecord[]> {
    if (productIds.length === 0) return [];
    const overrides = await this.emFactory().find(ProductValueOverride, {
      productId: { $in: [...productIds] },
      ...(options.channelId !== undefined ? { channelId: options.channelId } : {}),
    });
    return overrides.map(toCatalogProductValueOverrideRecord);
  }

  /**
   * Feature 148 — the products an attribute value selects, structurally (see
   * the port). One statement over the product's own JSONB; the `jsonb` forms
   * keep a stored string `"true"` from matching a boolean selection and a
   * scalar from matching an array one.
   */
  async listProductIdsByAttributeValue(query: CatalogAttributeValueQuery): Promise<string[]> {
    const predicate =
      query.match === 'array'
        ? `jsonb_typeof(p.attribute_values -> ?) = 'array' and (p.attribute_values -> ?) @> jsonb_build_array(?::text)`
        : query.match === 'boolean'
          ? `(p.attribute_values -> ?) = to_jsonb(?::boolean) and (p.attribute_values -> ?) is not null`
          : `(p.attribute_values -> ?) = to_jsonb(?::text) and (p.attribute_values -> ?) is not null`;
    const params =
      query.match === 'array'
        ? [query.key, query.key, query.value]
        : query.match === 'boolean'
          ? [query.key, query.value === 'true', query.key]
          : [query.key, query.value, query.key];
    const rows = await this.emFactory().execute<Array<{ id: string }>>(
      `select p.id from products p where ${predicate}`,
      params,
    );
    return rows.map((row) => row.id);
  }

  /**
   * Feature 161 (G15, `specs/161-price-book-editor/research.md` R14) — a page
   * of the products the caller's membership seam names, by the stored admin
   * name key (`products_admin_order_<lang>`), then SKU, then id.
   *
   * - Without a search: **one** statement — the page walks the order index
   *   and probes the seam as a hashed sub-plan (`(p.id in (…)) is true`, which
   *   keeps the planner from turning it into a join that would sort), with the
   *   count beside it unless `withTotal` is `false`.
   * - With a search: a count of the matching members, then the page — from the
   *   trigram hits when at most `sparseSearchLimit` match (few rows, sorted),
   *   from the ordered walk otherwise (the first rows come quickly). The term
   *   is folded by the same `catalog_admin_fold` the stored key is, and matched
   *   literally (`%`, `_` and `\\` escaped); a variant's SKU finds its product.
   */
  async pageProductsByAdminName(query: CatalogAdminNamePageQuery): Promise<{ ids: string[]; total: number | null }> {
    const lang = adminNameLanguage(query.language);
    const key = `p."admin_name_key_${lang}"`;
    const searchKey = `p."admin_search_key_${lang}"`;
    const order = `${key}, p."sku", p."id"`;
    const member = `(p."id" in (${query.membership.sql})) is true`;
    const offset = Math.max(0, Math.floor(query.offset));
    const limit = Math.max(0, Math.floor(query.limit));
    const em = this.emFactory();
    const term = query.search?.trim() ?? '';

    if (term.length === 0) {
      const withTotal = query.withTotal !== false;
      const rows = await withSort(em, false, (tx) =>
        tx.execute<Array<{ total: number | null; ids: string[] | null }>>(
          `select ${withTotal ? `(select count(*)::int from "products" p where ${member})` : 'null::int'} as "total",
                  array(select p."id" from "products" p where ${member} order by ${order} offset ? limit ?) as "ids"`,
          [...(withTotal ? query.membership.params : []), ...query.membership.params, offset, limit],
        ),
      );
      const row = rows[0];
      return { ids: row?.ids ?? [], total: withTotal ? Number(row?.total ?? 0) : null };
    }

    const literal = term.replace(/[\\%_]/g, (c) => `\\${c}`);
    const matches = `(${searchKey} like '%' || catalog_admin_fold(?) || '%'
                      or (p."id" in (select v."parent_product_id" from "product_variants" v
                                      where lower(v."sku") like '%' || lower(?) || '%')) is true)`;
    const counted = await em.execute<Array<{ n: number }>>(
      `select count(*)::int as "n" from "products" p where ${member} and ${matches}`,
      [...query.membership.params, literal, literal],
    );
    const total = Number(counted[0]?.n ?? 0);
    if (total === 0 || offset >= total || limit === 0) return { ids: [], total };
    const page =
      total <= this.#sparseSearchLimit
        ? // Few matches: the trigram hits, materialised, then the members among them sorted.
          // The sort this needs stays on — set explicitly, so both strategies issue
          // the same statements whatever the count picked.
          await withSort(em, true, (tx) =>
            tx.execute<Array<{ id: string }>>(
              `with "hits" as materialized (
                 select p."id", ${key} as "k", p."sku" from "products" p where ${matches}
               )
               select h."id" from "hits" h
                where (h."id" in (${query.membership.sql})) is true
                order by h."k", h."sku", h."id" offset ? limit ?`,
              [literal, literal, ...query.membership.params, offset, limit],
            ),
          )
        : // Many: walk the order index, keeping the matching members.
          await withSort(em, false, (tx) =>
            tx.execute<Array<{ id: string }>>(
              `select p."id" from "products" p where ${member} and ${matches} order by ${order} offset ? limit ?`,
              [...query.membership.params, literal, literal, offset, limit],
            ),
          );
    return { ids: page.map((r) => r.id), total };
  }
}

/**
 * Run an ordered page statement with the sort `off` — as an **index walk** of
 * `products_admin_order_<lang>` — feature 161, G15 (Checkpoint 2b).
 *
 * The page orders by exactly that index, so walking it reads the members in
 * order and stops at `offset + limit`; a sort reads and sorts every member
 * instead. The planner cannot be trusted to see that: the hashed membership
 * filter is estimated at a fixed half of the table, and on a table not yet
 * analysed (right after a bulk import) it assumes a few thousand rows and an
 * empty visibility map, so it prices the walk above a seq scan plus a sort and
 * picks the sort — measured on 50 000 products: 84–92 ms with the sort, 32 ms
 * walking after `VACUUM ANALYZE`, 59 ms walking before it (50 003 heap
 * fetches, all buffer hits). No query shape tried (a fenced ordered subquery,
 * `limit all`, a keyset walk in 2 000-row index-range chunks) keeps the walk on
 * unanalysed data, so the statement runs in its own transaction with
 * `set local enable_sort = off`: the setting ends with that transaction, and
 * with the ordered index there the walk is the plan that remains.
 *
 * The sparse strategy (trigram hits, materialised) must sort — there is no
 * index on a materialised set, and with the sort off the planner abandons the
 * trigram index instead (measured: ≈ 400 ms) — so it runs with `on`, restated
 * so that both strategies issue the same statements.
 */
async function withSort<T>(em: EntityManager, sort: boolean, run: (tx: EntityManager) => Promise<T>): Promise<T> {
  return em.transactional(async (tx) => {
    await tx.execute(`set local enable_sort = ${sort ? 'on' : 'off'}`);
    return run(tx);
  });
}

/** Feature 161 (G15): the most matching members a searched page is cut from the trigram hits for. */
export const SPARSE_SEARCH_LIMIT = 2000;

/**
 * `{}` by default — the wider read. `liveOnly` drops soft-deleted rows,
 * `activeOnly` implies it and narrows to `status === 'active'`; a caller
 * asking for active rows never wants the deleted ones as well, and letting the
 * two be set independently would publish a combination nobody means.
 */
function productFilter(
  options?: CatalogProductLookupOptions,
): { deletedAt?: null; status?: 'active' } {
  if (options?.activeOnly) return { deletedAt: null, status: 'active' };
  if (options?.liveOnly) return { deletedAt: null };
  return {};
}

function toPricingRef(row: { id: string; attribute_values: Record<string, unknown> | null }): CatalogProductPricingRef {
  return { id: row.id, attributeValues: row.attribute_values ?? {} };
}

export function toCatalogProductRecord(product: Product): CatalogProductRecord {
  return {
    id: product.id,
    sku: product.sku,
    slug: product.slug,
    type: product.type,
    status: product.status,
    name: product.name,
    description: product.description,
    stockMode: product.stockMode ?? null,
    visibility: product.visibility,
    attributeValues: product.attributeValues ?? {},
    allowedOrganizationIds: product.allowedOrganizationIds ?? [],
    attributeSetId: product.attributeSetId,
    downloadAssetId: product.downloadAssetId ?? null,
    downloadUrl: product.downloadUrl ?? null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    archivedAt: product.archivedAt ?? null,
    deletedAt: product.deletedAt ?? null,
    manageStock: product.manageStock,
    backorderEnabled: product.backorderEnabled,
    lowStockThreshold: product.lowStockThreshold ?? null,
    lowStockThresholdMode: product.lowStockThresholdMode,
    fulfilmentStrategy: product.fulfilmentStrategy ?? null,
    fulfilmentStrategyWarehouseOrder: product.fulfilmentStrategyWarehouseOrder ?? null,
    minOrderQuantity: product.minOrderQuantity ?? null,
    returnable: product.returnable,
    publishFrom: product.publishFrom ?? null,
    publishUntil: product.publishUntil ?? null,
  };
}

export function toCatalogProductVariantRecord(
  variant: ProductVariant,
): CatalogProductVariantRecord {
  return {
    id: variant.id,
    parentProductId: variant.parentProductId,
    sku: variant.sku,
    variantAttributeValues: variant.variantAttributeValues ?? {},
    stockLevel: variant.stockLevel ?? null,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

export function toCatalogPackagingUnitRecord(
  unit: ProductPackagingUnit,
): CatalogPackagingUnitRecord {
  return {
    id: unit.id,
    productId: unit.productId,
    name: unit.name,
    baseQuantity: unit.baseQuantity,
    position: unit.position,
    isDefault: unit.isDefault,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
    minOrderUnits: unit.minOrderUnits ?? null,
  };
}

export function toCatalogProductLinkRow(link: ProductLink): CatalogProductLinkRow {
  return {
    id: link.id,
    sourceProductId: link.sourceProductId,
    targetProductId: link.targetProductId,
    kind: link.kind,
    position: link.position,
  };
}

export function toCatalogProductValueOverrideRecord(
  override: ProductValueOverride,
): CatalogProductValueOverrideRecord {
  return {
    id: override.id,
    productId: override.productId,
    attributeKey: override.attributeKey,
    channelId: override.channelId,
    languageCode: override.languageCode ?? null,
    value: override.value,
  };
}
