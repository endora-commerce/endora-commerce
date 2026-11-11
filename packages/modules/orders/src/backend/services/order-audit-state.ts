import { isDeepStrictEqual } from 'node:util';
import type { CustomFieldValuePort } from '@endora-commerce/contracts';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { LockMode } from '@mikro-orm/core';
import { layoutShape, type OrderLineLayout } from '../domain/quote-line-groups.js';
import { Order } from '../entities/order.entity.js';

/**
 * What an Order audit entry may say (issue #470, D-288;
 * `specs/conventions/audit-state.md`).
 *
 * The platform audit log is one global table read under `audit_log:read`
 * without Organization reach, so an Order's entry carries **names and
 * structure**: its number, status codes, ids of global records, line counts and
 * the names of what changed. Its amounts, currency, custom-field values, line
 * group names and the Organization and customer it belongs to (the tenant
 * anchor) stay out.
 *
 * No Order history reads values back out of the audit log — the one reader,
 * the buyer-cancellation predicate (`order-cancellation-service.ts`), reads
 * `stateAfter.status`, a code — so the values are kept nowhere else: the Order
 * row holds the current ones, and that is all anything shows.
 */

/**
 * Every top-level key an Order audit state may hold. Anything else is a value
 * until somebody classifies it on purpose — `order-audit-sentinels.test.ts`
 * holds every audited write's recorded state to this list.
 */
export const ORDER_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // Codes.
  'status',
  'paymentStatus',
  // The document number and the global API key it was placed with.
  'businessId',
  'apiKeyId',
  // Feature 159 — the grouping's shape: one line count per group, in order.
  'groups',
  // What changed among the custom fields, by key; what a carry did, by key and reason code.
  'carriedCustomFieldKeys',
  'changedCustomFields',
  'customFieldCarry',
]);

/** The sorted keys whose value differs between two custom-field bags. */
export function changedCustomFieldKeys(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !isDeepStrictEqual(before[key], after[key])).sort();
}

/** `order.place_on_behalf` — an order an administrator placed for a customer. */
export function placeOnBehalfAuditState(input: {
  order: Pick<Order, 'status'>;
  layout: OrderLineLayout;
  carriedCustomFieldKeys: readonly string[];
  /**
   * Feature 175 (FR-021) — the values the administrator set on the admin
   * create. Only their keys are recorded, sorted, as `changedCustomFields`.
   */
  adminCustomFieldValues?: Readonly<Record<string, unknown>> | undefined;
}): Record<string, unknown> {
  const adminKeys = Object.keys(input.adminCustomFieldValues ?? {}).sort();
  return {
    status: input.order.status,
    // Feature 159 (FR-081, research R-22) — the grouping's shape, when the order has one.
    ...(input.layout.groups.length > 0 ? { groups: layoutShape(input.layout) } : {}),
    // Feature 162 (US1-5) — the custom-field values carried from the request.
    ...(input.carriedCustomFieldKeys.length > 0 ? { carriedCustomFieldKeys: [...input.carriedCustomFieldKeys] } : {}),
    ...(adminKeys.length > 0 ? { changedCustomFields: adminKeys } : {}),
  };
}

/** `order.place_via_api_key` — the API key an order was placed with. */
export function apiKeyPlacementAuditState(
  binding: { apiKeyId: string },
  order: Pick<Order, 'businessId'>,
): Record<string, unknown> {
  // The key's Organization and customer are the Order's tenant anchor: the
  // entry's objectId leads to them for a reader who may see the Order.
  return { apiKeyId: binding.apiKeyId, businessId: order.businessId };
}

/**
 * `order.custom_fields.update` — the narrow admin write of an Order's
 * custom-field values (`PATCH /api/v1/admin/orders/:id/custom-fields`). Runs
 * through the Command Bus (Principle XIII); validation may reject with a
 * per-field failure the route maps to a 422.
 *
 * The entry names the keys whose value changed (`changedCustomFields`); the
 * values stay on the Order.
 */
export function orderCustomFieldsUpdateCommand(
  orderId: string,
  patch: Record<string, unknown>,
  customFieldValues: Pick<CustomFieldValuePort, 'validateAndMerge'>,
): Command<Order> {
  return {
    action: 'order.custom_fields.update',
    objectType: 'order',
    objectId: orderId,
    run: async ({ em }) => {
      if (!isUuidShape(orderId)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
      // The one read of the row, `for update` (#399): the change set and the
      // merge are both made over the bag this transaction holds.
      const order = await em.findOne(
        Order,
        { id: orderId },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      );
      if (!order) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
      const current = { ...(order.customFieldValues ?? {}) };
      order.customFieldValues = await customFieldValues.validateAndMerge('order', current, patch);
      return {
        result: order,
        before: null,
        after: { changedCustomFields: changedCustomFieldKeys(current, order.customFieldValues ?? {}) },
      };
    },
  };
}
