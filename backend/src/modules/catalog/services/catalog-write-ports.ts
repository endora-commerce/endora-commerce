import type {
  CatalogCategoryWritePort,
  CatalogProductWritePort,
  CatalogPromoAttributePort,
} from '@endora-commerce/contracts';
import type { CatalogAdminService } from './catalog-admin.service.js';
import type { CatalogQueryService } from './catalog-query.service.js';
import type { CategoryAdminService } from './category-admin.service.js';
import { toCatalogCategoryRecord } from './catalog-category-read.service.js';
import {
  toCatalogProductRecord,
  toCatalogProductVariantRecord,
} from './catalog-product-read.service.js';

/**
 * The published write surface of `catalog` (feature 075, Phase P).
 *
 * Each adapter here does exactly two things: it narrows a large admin service
 * to the methods a consumer measurably calls, and it maps the entities those
 * methods return into records. `CatalogAdminService` is 1900 lines and
 * `pim_ergonode` calls ten of its methods; publishing the class would publish
 * the other hundred and freeze them.
 *
 * The services arrive as getters rather than values so the adapter resolves
 * them from the container per call — they are this module's own gated ports,
 * and a singleton may not hold a gate.
 */

export function createCatalogProductWritePort(
  getService: () => CatalogAdminService,
): CatalogProductWritePort {
  return {
    async createProduct(req, auditCtx) {
      return toCatalogProductRecord(await getService().createProduct(req, auditCtx));
    },
    async updateProduct(id, req) {
      return toCatalogProductRecord(await getService().updateProductAudited(id, req));
    },
    listAttributes: () => getService().listAttributes(),
    listAttributesByFlag: (flag) => getService().listAttributesByFlag(flag),
    createAttribute: (req) => getService().createAttribute(req),
    updateAttributeByIdOrKey: (idOrKey, req, auditCtx) =>
      getService().updateAttributeByIdOrKey(idOrKey, req, auditCtx),
    addAttributeOption: (attributeIdOrKey, input) =>
      getService().addAttributeOption(attributeIdOrKey, input),
    async createVariant(parentProductId, req) {
      return toCatalogProductVariantRecord(await getService().createVariant(parentProductId, req));
    },
    async updateVariant(parentProductId, variantId, req) {
      return toCatalogProductVariantRecord(
        await getService().updateVariant(parentProductId, variantId, req),
      );
    },
    deleteVariant: (parentProductId, variantId) =>
      getService().deleteVariant(parentProductId, variantId),
  };
}

export function createCatalogCategoryWritePort(
  getService: () => CategoryAdminService,
): CatalogCategoryWritePort {
  return {
    async listAll() {
      return (await getService().listAll()).map(toCatalogCategoryRecord);
    },
    async create(input) {
      return toCatalogCategoryRecord(await getService().create(input));
    },
    async update(id, input) {
      return toCatalogCategoryRecord(await getService().update(id, input));
    },
    setInventoryThresholds: (id, patch) => getService().setInventoryThresholds(id, patch),
  };
}

/**
 * `promotions` builds its rule editor from two questions and reaches
 * `CatalogQueryService` — the 1400-line storefront query service — for them.
 */
export function createCatalogPromoAttributePort(
  getService: () => CatalogQueryService,
): CatalogPromoAttributePort {
  return {
    promoRuleAttributeKeys: () => getService().promoRuleAttributeKeys(),
    getAttributeWithOptions: (key) => getService().getAttributeWithOptions(key),
  };
}
