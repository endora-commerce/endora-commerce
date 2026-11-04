import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type CatalogAttributeView, type ScopedValueInvalidDetails } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

import { findLinkableAsset, type LinkableAssetReader } from './linkable-asset.js';
import {
  attributeSetExists,
  findSkuHolder,
  missingCategoryIds,
  missingRequiredAttributeKeys,
  PRODUCT_SKU_MAX,
} from './product-global-field-rules.js';
import { assertVirtualDownloadFields, ProductTypeValidationError } from './product-type-validations.js';
import { attributeSetDefinitionIds } from './scope-completeness.js';
import type { PlannedCell, ScopedSavePlan } from './scoped-values-save.service.js';
import type { ScopedProductState } from './scoped-values-state.js';

/**
 * Feature 172 (C2/C3 code review 1, security review warn 1; `contracts/scoped-values-api.md` §3
 * step 3a) — the save's Global-only `product.*` family holds the rules `PATCH /products/:id`
 * holds (`product-global-field-rules.ts`), checked before anything is written:
 *
 * - the SKU, trimmed, 1–255 characters and free in the product and variant namespaces
 *   (`409 SKU_ALREADY_EXISTS`, `details.field = 'product.sku'`);
 * - the attribute set exists; when the save changes it, every attribute cell is planned against
 *   the **new** set ({@link useTargetAttributeSet}), and the set's required attributes need a
 *   Global value on the row the save leaves;
 * - every category exists and is not deleted;
 * - the virtual-product download rules on the row the save leaves, and a download file the
 *   library shows the caller (a missing and a hidden file answer alike).
 *
 * The other refusals are `422 SCOPED_VALUE_INVALID`: `subject_not_found` for an id that names
 * nothing, `required_empty` for a required attribute, `invalid` for a rule.
 */

export interface GlobalOnlyDeps {
  listAttributes: () => Promise<CatalogAttributeView[]>;
  /** The library, for a download file. Absent = a download file cannot be linked (fails closed). */
  assets?: LinkableAssetReader | undefined;
}

type Fields = ScopedValueInvalidDetails['fields'];

const invalid = (fields: Fields): HttpError =>
  new HttpError(422, ERROR_CODES.SCOPED_VALUE_INVALID, 'Some values cannot be saved at this scope.', { fields });

const GLOBAL = { level: 'global' } as const;

/**
 * When the save names an attribute set other than the product's, the attributes the plan checks
 * are the new set's (allowed keys, value types, required values). Runs before the plan; an unknown
 * set is `subject_not_found`.
 */
export async function useTargetAttributeSet(
  em: EntityManager,
  deps: Pick<GlobalOnlyDeps, 'listAttributes'>,
  state: ScopedProductState,
  attributeSetId: string | undefined,
): Promise<void> {
  if (attributeSetId === undefined || attributeSetId === state.product.attributeSetId) return;
  if (!(await attributeSetExists(em, attributeSetId))) {
    throw invalid([{ field: 'product.attributeSetId', scope: GLOBAL, reason: 'subject_not_found' }]);
  }
  const [views, definitions] = await Promise.all([deps.listAttributes(), attributeSetDefinitionIds(em, attributeSetId)]);
  state.attributes = new Map(views.filter((view) => definitions.has(view.customFieldDefinitionId)).map((view) => [view.key, view]));
}

/** Step 3a for the `product.*` family; a no-op for a save at Channel or Channel × language. */
export async function assertGlobalOnlyFields(
  em: EntityManager,
  deps: GlobalOnlyDeps,
  state: ScopedProductState,
  plan: ScopedSavePlan,
): Promise<void> {
  if (plan.scope.level !== 'global') return;
  const product = state.product;
  const cell = (field: string): PlannedCell | undefined => plan.cells.find((c) => c.family === 'product' && c.field === field);
  const setValue = (c: PlannedCell | undefined): unknown => (c && c.op.op === 'set' ? c.op.value : null);

  const sku = cell('sku');
  if (sku) {
    const trimmed = String(setValue(sku) ?? '').trim();
    if (trimmed.length === 0 || trimmed.length > PRODUCT_SKU_MAX) {
      throw invalid([{ field: 'product.sku', scope: GLOBAL, reason: 'invalid' }]);
    }
    sku.op = { op: 'set', value: trimmed };
    if (trimmed !== product.sku) {
      const holder = await findSkuHolder(em, product.id, trimmed);
      if (holder) {
        throw new HttpError(409, ERROR_CODES.SKU_ALREADY_EXISTS, `SKU "${trimmed}" already exists.`, {
          field: 'product.sku',
          ...('productId' in holder ? { conflictingProductId: holder.productId } : { conflictingVariantId: holder.variantId }),
        });
      }
    }
  }

  const categories = cell('categoryIds');
  if (categories && (await missingCategoryIds(em, (setValue(categories) as string[] | null) ?? [])).length > 0) {
    throw invalid([{ field: 'product.categoryIds', scope: GLOBAL, reason: 'subject_not_found' }]);
  }

  // Required attributes of the set the save leaves (feature 012, FR-013), on the Global values it leaves.
  const attributeCells = plan.cells.filter((c) => c.family === 'value' && c.path.startsWith('attribute:'));
  if (cell('attributeSetId') || attributeCells.length > 0) {
    const values: Record<string, unknown> = { ...(product.attributeValues ?? {}) };
    for (const c of attributeCells) {
      if (c.op.op === 'set') values[c.field] = c.op.value;
      else delete values[c.field];
    }
    const missing = missingRequiredAttributeKeys(state.attributes.values(), values);
    if (missing.length > 0) {
      throw invalid(missing.map((key) => ({ field: `attribute:${key}`, scope: GLOBAL, reason: 'required_empty' as const })));
    }
  }

  // The virtual-product download rules (feature 002, T047) on the row the save leaves.
  const assetCell = cell('downloadAssetId');
  const urlCell = cell('downloadUrl');
  if (assetCell || urlCell) {
    const named: Fields = [assetCell, urlCell]
      .filter((c): c is PlannedCell => c !== undefined)
      .map((c) => ({ field: c.path, scope: GLOBAL, reason: 'invalid' as const }));
    const downloadAssetId = assetCell ? (setValue(assetCell) as string | null) : (product.downloadAssetId ?? null);
    const downloadUrl = urlCell ? (setValue(urlCell) as string | null) : (product.downloadUrl ?? null);
    try {
      assertVirtualDownloadFields({ type: product.type, downloadAssetId, downloadUrl });
    } catch (error) {
      if (error instanceof ProductTypeValidationError) throw invalid(named);
      throw error;
    }
    // Feature 166 (FR-006) — a file the caller may not see answers as a missing one.
    if (assetCell && downloadAssetId !== null && downloadAssetId !== (product.downloadAssetId ?? null)) {
      const asset = deps.assets ? await findLinkableAsset(deps.assets, downloadAssetId) : null;
      if (!asset) throw invalid([{ field: 'product.downloadAssetId', scope: GLOBAL, reason: 'subject_not_found' }]);
    }
  }
}
