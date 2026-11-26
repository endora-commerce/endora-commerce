import {
  type CatalogAttributeCommandPort,
  type CatalogCategoryWritePort,
  type CatalogProductCommandPort,
  type CatalogProductScopeWritePort,
  type CatalogProductWritePort,
  type CatalogPromoAttributePort,
} from '@endora-commerce/contracts';
import { assertIntegrationCall } from './scoped-values-import.js';
import type { CatalogAdminService } from './catalog-admin.service.js';
import type { CatalogQueryService } from './catalog-query.service.js';
import type { CategoryAdminService } from './category-admin.service.js';
import { toCatalogCategoryRecord } from './catalog-category-read.service.js';

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

/**
 * `catalogProductWritePort` — deprecated since 0.113.0 (`specs/186-aggregate-ports/`, issue
 * #1825). Every write delegates to its replacement on `catalogProductCommandPort` or
 * `catalogAttributeCommandPort`, so the entries, the refusals and the records are those of the
 * aggregate ports; `auditCtx` was never read (the actor is ambient) and is not passed on. A
 * `version` in `updateProduct`'s request travels as `options.expectedVersion`. The two reads
 * stay on the admin service until the port is removed: `listAttributesByFlag` takes two flags
 * the read port has not.
 */
export function createCatalogProductWritePort(deps: {
  products: () => Pick<CatalogProductCommandPort, 'create' | 'update' | 'createVariant' | 'updateVariant' | 'deleteVariant'>;
  attributes: () => Pick<CatalogAttributeCommandPort, 'create' | 'update' | 'addOption' | 'updateOption'>;
  attributeReads: () => Pick<CatalogAdminService, 'listAttributes' | 'listAttributesByFlag'>;
}): CatalogProductWritePort {
  return {
    createProduct: (req) => deps.products().create(req),
    updateProduct(id, req) {
      const { version, ...patch } = req;
      return deps.products().update(id, patch, version === undefined ? {} : { expectedVersion: Number(version) });
    },
    listAttributes: () => deps.attributeReads().listAttributes(),
    listAttributesByFlag: (flag) => deps.attributeReads().listAttributesByFlag(flag),
    createAttribute: (req) => deps.attributes().create(req),
    updateAttributeByIdOrKey: (idOrKey, req) => deps.attributes().update(idOrKey, req),
    addAttributeOption: (attributeIdOrKey, input) => deps.attributes().addOption(attributeIdOrKey, input),
    patchAttributeOption: (optionId, input) => deps.attributes().updateOption(optionId, input),
    createVariant: (parentProductId, req) => deps.products().createVariant(parentProductId, req),
    updateVariant: (parentProductId, variantId, req) => deps.products().updateVariant(parentProductId, variantId, req),
    deleteVariant: (parentProductId, variantId) => deps.products().deleteVariant(parentProductId, variantId),
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
 * Feature 174 (T083; `contracts/pim-locale-mapping.md` §4, R13a, R21) — the scoped write of a
 * connector, v2. Deprecated since 0.113.0 (`specs/186-aggregate-ports/`, issue #1825): its own
 * rule — `source` a module of the registry (R21) — then `catalogProductCommandPort.applyScopedValues`,
 * which runs the Command `product.scoped_values.import` with the call-level checks (the cell cap,
 * no duplicate cell), per-cell refusals, the integration allowlist and URL keys in `integration`
 * mode (FR-093).
 */
export function createCatalogProductScopeWritePort(deps: {
  products: () => Pick<CatalogProductCommandPort, 'applyScopedValues'>;
  /** Whether `moduleId` names a module of the registry (R21: `options.source`). */
  isRegisteredModule: (moduleId: string) => boolean;
}): CatalogProductScopeWritePort {
  return {
    async applyScopes(productId, input, options) {
      assertIntegrationCall(input.cells, options.source, deps.isRegisteredModule);
      return deps.products().applyScopedValues(productId, input, { source: options.source });
    },
  };
}
