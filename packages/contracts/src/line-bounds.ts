import { z } from 'zod';
import { ORDER_MINIMUM_MAX } from './order-minimums.js';

/**
 * Issue #351 — the bounds every request that carries order lines shares.
 *
 * Imports nothing but the order-minimum ceiling, so every request-schema file
 * (`carts`, `orders`, `quote-requests`, `quick-order`, `shopping-lists`,
 * `returns`, `catalog`, `promotions`) can import it without a load-order cycle.
 */

/**
 * The most pieces one request line may carry. The order-minimum ceiling on
 * purpose: the largest minimum a product can carry is still orderable, and a
 * quantity this size is far below the integer column it is stored in and stays
 * exact in any arithmetic done on it before it is stored (totals, per-product
 * sums). Above it a request is a validation failure, never a database error.
 */
export const LINE_QUANTITY_MAX = ORDER_MINIMUM_MAX;

/** A request line's quantity: a whole number in 1…{@link LINE_QUANTITY_MAX}. */
export const lineQuantitySchema = z.number().int().positive().max(LINE_QUANTITY_MAX);

/**
 * The most lines one request may carry — the basket, quick order, the admin and
 * API order intake, quote requests and returns. One value: the intakes that
 * judge it in their service (`ADMIN_ORDER_MAX_ITEMS`,
 * `QUICK_ORDER_BUILD_MAX_ITEMS`) are this constant under their own names.
 */
export const REQUEST_LINE_ITEMS_MAX = 200;
