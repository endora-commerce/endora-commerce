import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import type {
  CatalogAttributeValueQuery,
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
import { Product } from '../entities/product.entity.js';
import { ProductLink } from '../entities/product-link.entity.js';
import { ProductPackagingUnit } from '../entities/product-packaging-unit.entity.js';
import { ProductValueOverride } from '../entities/product-value-override.entity.js';
import { ProductVariant } from '../entities/product-variant.entity.js';

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
  constructor(private readonly emFactory: () => EntityManager) {}

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
}

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
