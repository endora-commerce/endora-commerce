import { z } from 'zod';
import { ORDER_MINIMUM_MAX } from './order-minimums.js';

/**
 * Issue #351 — the bounds every request that carries order lines shares.
 *
 * Imports nothing but zod and the order-minimum ceiling, so every
 * request-schema file (`carts`, `orders`, `quote-requests`, `quick-order`,
 * `shopping-lists`, `returns`, `catalog`, `promotions`) can import it without a
 * load-order cycle.
 */

/**
 * The most pieces one line may carry. The order-minimum ceiling on purpose: the
 * largest minimum a product can carry is still orderable, and a quantity this
 * size is far below the integer column it is stored in and stays exact in any
 * arithmetic done on it before it is stored (totals, per-product sums).
 */
export const LINE_QUANTITY_MAX = ORDER_MINIMUM_MAX;

/**
 * The refusal of a line quantity past {@link LINE_QUANTITY_MAX} (architect
 * ruling R1 on PR #1009). Built like `AMOUNT_PRECISION_EXCEEDED`: a request
 * schema tags the Zod issue with it, and the error envelope
 * (`@endora-commerce/platform/http`) answers a request whose only failures are
 * this one with `400 LINE_QUANTITY_EXCEEDED`, a code it translates —
 * `VALIDATION_FAILED` it never does. A request valid on its own whose line would
 * end past the bound (an add onto an existing basket line, a packaging unit's
 * pieces) is refused by the service with `422 LINE_QUANTITY_EXCEEDED`,
 * `details: { quantity, maximum }`.
 */
export const LINE_QUANTITY_EXCEEDED = 'LINE_QUANTITY_EXCEEDED' as const;

/** A fresh object each time: Zod normalises a refinement's params in place. */
function lineQuantityIssue() {
  return { message: LINE_QUANTITY_EXCEEDED, params: { code: LINE_QUANTITY_EXCEEDED } };
}

/**
 * A whole-number schema refusing a value past {@link LINE_QUANTITY_MAX} with the
 * tagged issue. Its own floor (`positive()`, `min(0)`) stays a plain issue.
 */
export function boundedLineQuantity<T extends z.ZodNumber>(schema: T): T {
  return schema.refine((value) => value <= LINE_QUANTITY_MAX, lineQuantityIssue()) as T;
}

/** A request line's quantity: a whole number in 1…{@link LINE_QUANTITY_MAX}. */
export const lineQuantitySchema = boundedLineQuantity(z.number().int().positive());

/** Whether a Zod issue (or a Fastify-wrapped one, whose `params` carry the issue's) is the line-quantity issue. */
export function isLineQuantityExceededIssue(issue: unknown): boolean {
  if (!issue || typeof issue !== 'object') return false;
  const params = (issue as { params?: { code?: unknown; params?: { code?: unknown } } }).params;
  return params?.code === LINE_QUANTITY_EXCEEDED || params?.params?.code === LINE_QUANTITY_EXCEEDED;
}

/**
 * The most lines one request may carry — the basket, quick order, the admin and
 * API order intake, quote requests and returns. **The value is shared; the
 * refusal is not** (architect ruling R2 on PR #1009): the quote request and
 * return schemas bound their arrays with it, so one line more is
 * `400 VALIDATION_FAILED`; the order intakes (admin create and preview,
 * external API) and the quick-order build judge it in their services as their
 * first step, `422 VALIDATION_FAILED` with
 * `details: { code: 'too_many_items', maximum }` — a released contract that
 * their request schemas must not turn into a 400 by adding a `.max()`. The
 * basket's own cap (`CART_MAX_LINES` in `carts`) answers
 * `422 CART_LINE_CAP_EXCEEDED`. `ADMIN_ORDER_MAX_ITEMS` and
 * `QUICK_ORDER_BUILD_MAX_ITEMS` are this constant under their own names.
 */
export const REQUEST_LINE_ITEMS_MAX = 200;
