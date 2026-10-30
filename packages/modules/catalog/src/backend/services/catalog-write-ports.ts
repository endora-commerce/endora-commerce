import {
  patchProductScopesRequestSchema,
  type CatalogCategoryWritePort,
  type CatalogProductScopeWritePort,
  type CatalogProductWritePort,
  type CatalogPromoAttributePort,
  fromScopedWriteOp,
  type PatchProductScopesRequest,
  type ProductScopedWriteInput,
  type ProductScopedWriteResult,
} from '@endora-commerce/contracts';
import type { ProductScopesService } from './product-scopes.service.js';
import type { ProductUrlKeyWrite, UrlKeyService } from './url-key.service.js';
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
 * Feature 163 (R17, `contracts/url-keys-and-redirects.md` §5) — the scoped write
 * of a connector or an importer.
 *
 * It writes only the scopes the input names, so a connector writing global values
 * removes no operator override (FR-091). Status, window, audience and order rules
 * go through `ProductScopesService` — the operator's Command, its validation
 * (FR-014: a value for a channel the product is not in is refused) and its event;
 * URL keys through `UrlKeyService` in import mode, where a key another product
 * holds is not written and is reported, and a redirect is never taken over
 * (FR-093). No completeness gate runs on this path (A-6).
 */
export function createCatalogProductScopeWritePort(
  getScopes: () => ProductScopesService,
  getUrlKeys: () => UrlKeyService,
): CatalogProductScopeWritePort {
  return {
    async applyScopes(productId, input, options) {
      // 168-shim: port v2 (`contracts/pim-locale-mapping.md` §4) on the 163 writers — `status` and
      // `window` through the scopes PATCH, `urlKey` at C×L through the URL-key import mode; every
      // other cell is refused `not_supported` until T083 lands the allowlist on the save service.
      const { request, urlKeys, refused } = toScopesPatch(input);
      if (request.channels.length > 0 || request.global !== undefined) {
        // The write alone (checkpoint C code review, N2): an integration reads nothing
        // back, and passes no completeness mode — it is never gated (A-6).
        await getScopes().writeStatus(productId, request);
      }
      const outcomes = urlKeys.length ? await getUrlKeys().importKeys(productId, urlKeys, options.source) : [];
      const result: ProductScopedWriteResult = {
        applied: input.cells.length - refused.length,
        refused,
        urlKeys: outcomes,
      };
      return result;
    },
  };
}

/** 168-shim — the v2 cells the 163 writers can take, and the refused rest. */
export function toScopesPatch(input: ProductScopedWriteInput): {
  request: PatchProductScopesRequest;
  urlKeys: ProductUrlKeyWrite[];
  refused: ProductScopedWriteResult['refused'];
} {
  const channels = new Map<string, PatchProductScopesRequest['channels'][number]>();
  const entry = (channelId: string): PatchProductScopesRequest['channels'][number] => {
    let found = channels.get(channelId);
    if (!found) {
      found = { channelId };
      channels.set(channelId, found);
    }
    return found;
  };
  let global: PatchProductScopesRequest['global'];
  const urlKeys: ProductUrlKeyWrite[] = [];
  const refused: ProductScopedWriteResult['refused'] = [];
  for (const cell of input.cells) {
    const { scope, op } = cell;
    if (cell.field === 'status' && scope.level !== 'global') {
      const target = entry(scope.channelId);
      if (scope.level === 'channel') target.status = fromScopedWriteOp(op) as never;
      else {
        target.languageStatuses = [
          ...(target.languageStatuses ?? []),
          { languageCode: scope.languageCode, status: fromScopedWriteOp(op) as never },
        ];
      }
    } else if (cell.field === 'window' && scope.level === 'global' && op.op !== 'inherit') {
      const value = op.op === 'set' ? (op.value as { from: string | null; until: string | null }) : { from: null, until: null };
      global = { publishFrom: value.from, publishUntil: value.until };
    } else if (cell.field === 'window' && scope.level === 'channel') {
      entry(scope.channelId).window = fromScopedWriteOp(op) as never;
    } else if (cell.field === 'urlKey' && scope.level === 'channel_language' && op.op !== 'empty') {
      urlKeys.push({
        channelId: scope.channelId,
        languageCode: scope.languageCode,
        key: op.op === 'set' ? String(op.value) : null,
      });
    } else {
      refused.push({ scope, field: cell.field, code: 'not_supported' });
    }
  }
  return {
    request: patchProductScopesRequestSchema.parse({
      channels: [...channels.values()],
      ...(global !== undefined ? { global } : {}),
    }),
    urlKeys,
    refused,
  };
}
