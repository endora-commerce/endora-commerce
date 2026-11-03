import {
  type CatalogCategoryWritePort,
  type CatalogProductScopeWritePort,
  type CatalogProductWritePort,
  type CatalogPromoAttributePort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { assertIntegrationCall, runScopedImport, type ScopedImportDeps } from './scoped-values-import.js';
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
    patchAttributeOption: (optionId, input) => getService().patchAttributeOption(optionId, input),
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

/**
 * Feature 170 (T083; `contracts/pim-locale-mapping.md` §4, R13a, R21) — the scoped write of a
 * connector, v2: the call-level checks (a registered `source`, the cell cap, no duplicate cell),
 * then one Command `product.scoped_values.import` on the save's planner and writers
 * (`scoped-values-import.ts`): per-cell refusals, the integration allowlist, every subject bound to
 * the product, no completeness gate (A-6), URL keys in `integration` mode (FR-093).
 */
export function createCatalogProductScopeWritePort(deps: {
  commandBus: () => CommandBus;
  importDeps: () => ScopedImportDeps;
  /** Whether `moduleId` names a module of the registry (R21: `options.source`). */
  isRegisteredModule: (moduleId: string) => boolean;
}): CatalogProductScopeWritePort {
  return {
    async applyScopes(productId, input, options) {
      assertIntegrationCall(input.cells, options.source, deps.isRegisteredModule);
      const { changedFields: _changed, ...result } = await runScopedImport(
        deps.commandBus(),
        deps.importDeps(),
        productId,
        input.cells,
        { source: options.source },
      );
      return result;
    },
  };
}
