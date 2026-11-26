import { ERROR_CODES, type CatalogProductRecord } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { isNotArchived } from './rfq-service.js';

/**
 * The products an operator's quote lines name, by id — or the refusal
 * (feature 163, owner decisions P-3 = A and P-3b = A). An id that does not
 * exist answers `404 PRODUCT_NOT_FOUND`, as before. An archived product answers
 * `409 PRODUCT_ARCHIVED`, catalog's code and sentence: the operator is told why
 * the line is refused, where a buyer's path gives the absent id's byte-equal
 * 404 so nothing is disclosed. 409 because the product exists and the request
 * conflicts with its state — the status this module answers for a state
 * conflict, and the one convert gives a product archived since approval.
 * `details.productIds` names the archived products (checkpoint F, B-3).
 */
export function operatorLineProducts<P extends Pick<CatalogProductRecord, 'id' | 'archivedAt'>>(
  records: readonly P[],
  productIds: readonly string[],
): Map<string, P> {
  const found = new Map(records.map((p) => [p.id, p]));
  if (found.size !== new Set(productIds).size) {
    throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'One or more products do not exist.');
  }
  // Checkpoint F (B-3): an edit sends every line, so the refusal names which products
  // are archived — in `details`, the sentence stays catalog's.
  const archivedIds = records.filter((p) => !isNotArchived(p)).map((p) => p.id);
  if (archivedIds.length > 0) {
    throw new HttpError(409, ERROR_CODES.PRODUCT_ARCHIVED, 'Product is archived.', {
      productIds: [...new Set(archivedIds)],
    });
  }
  return found;
}
