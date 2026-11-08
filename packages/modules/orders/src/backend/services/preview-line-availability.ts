import {
  ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE,
  evaluateOrderMinimums,
  isProductVisibleTo,
  type AdminOrderPreviewMessageCode,
  type CatalogProductRecord,
  type ProductAudience,
} from '@endora-commerce/contracts';

const [PRODUCT_NOT_FOUND, PRODUCT_ARCHIVED, PRODUCT_NOT_VISIBLE_TO_CUSTOMER, PRODUCT_NOT_IN_SALES_CHANNEL] =
  ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE;

export type PreviewLineAvailability =
  | { available: true }
  | { available: false; code: AdminOrderPreviewMessageCode };

/**
 * Steps 1–3 of the admin order preview's per-line decision (feature 145,
 * FR-027), first match wins: the catalogue holds no live product (absent or
 * soft-deleted), the product is archived (issue #829 — the `409
 * PRODUCT_ARCHIVED` admin order create answers; archiving is product-wide, so
 * it outranks visibility and channel), the customer's Organization may not see
 * it, or it is outside the order's sales channel.
 * Step 4 (`QUOTE_ONLY`) needs the resolved price and stays in the route.
 *
 * `inChannel` is ignored for a product that fails visibility: one message per
 * line, and visibility outranks assortment.
 */
export function previewLineAvailability(input: {
  product: Pick<CatalogProductRecord, 'visibility' | 'allowedOrganizationIds' | 'archivedAt'> | null;
  organizationId: string;
  inChannel: boolean;
}): PreviewLineAvailability {
  if (!input.product) return { available: false, code: PRODUCT_NOT_FOUND };
  if (input.product.archivedAt) return { available: false, code: PRODUCT_ARCHIVED };
  if (!isProductVisibleTo(input.product, customerAudience(input.organizationId))) {
    return { available: false, code: PRODUCT_NOT_VISIBLE_TO_CUSTOMER };
  }
  if (!input.inChannel) return { available: false, code: PRODUCT_NOT_IN_SALES_CHANNEL };
  return { available: true };
}

/**
 * Step 5 of the admin order preview's per-line decision (feature 155, FR-009,
 * FR-035): `BELOW_MINIMUM_QUANTITY`, judged only over the lines that passed
 * steps 1–4 — `null` marks a line that did not, and it counts toward no
 * product's total. A product's total runs across all its lines (D1). Preview
 * items carry no packaging unit, so only the pieces minimum is reachable.
 *
 * Answers the missed minimum by line index; an absent index has none.
 */
export function previewBelowMinimums(
  lines: ReadonlyArray<{
    product: Pick<CatalogProductRecord, 'id' | 'type' | 'minOrderQuantity'>;
    quantity: number;
  } | null>,
): Map<number, number> {
  const products = new Map<string, Pick<CatalogProductRecord, 'id' | 'type' | 'minOrderQuantity'>>();
  const orderable = lines.flatMap((line, index) => {
    if (line === null) return [];
    products.set(line.product.id, line.product);
    return [
      {
        key: String(index),
        productId: line.product.id,
        quantity: line.quantity,
        packagingUnitId: null,
        packagingUnitBaseQuantity: null,
        exempt: false,
      },
    ];
  });
  const below = new Map<number, number>();
  for (const violation of evaluateOrderMinimums(orderable, {
    products: [...products.values()],
    packagingUnits: [],
  })) {
    if (violation.kind === 'product_unavailable') continue;
    const index = Number(violation.key);
    if (!below.has(index)) below.set(index, violation.minimum);
  }
  return below;
}

/**
 * The {@link ProductAudience} of the customer the operator is previewing for.
 *
 * Not `productAudienceOf(request)`: the request's actor is the operator, and the
 * question this preview answers is what the **chosen customer** may order. The
 * customer is a signed-in buyer of that Organization — the same audience
 * `cartAudience` yields when the order is placed through the cart.
 */
export function customerAudience(organizationId: string): ProductAudience {
  return { organizationId, authenticated: true };
}
