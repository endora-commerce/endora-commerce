import type { CustomFieldValuePort } from '@endora-commerce/contracts';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { layoutShape, type OrderLineLayout } from '../domain/quote-line-groups.js';
import { Order } from '../entities/order.entity.js';

/**
 * The audit state of the Order Commands and audited writes that record one.
 */

/** Every top-level key an Order audit state may hold. */
export const ORDER_AUDIT_KEYS: ReadonlySet<string> = new Set([
  'status',
  'paymentStatus',
  'businessId',
  'apiKeyId',
  'groups',
  'carriedCustomFieldKeys',
  'changedCustomFields',
  'customFieldCarry',
]);

/** `order.place_on_behalf` — an order an administrator placed for a customer. */
export function placeOnBehalfAuditState(input: {
  order: Pick<Order, 'status'>;
  total: string;
  currency: string;
  layout: OrderLineLayout;
  carriedCustomFieldKeys: readonly string[];
}): Record<string, unknown> {
  return {
    total: input.total,
    currency: input.currency,
    status: input.order.status,
    // Feature 159 (FR-081, research R-22) — the grouping's shape, when the order has one.
    ...(input.layout.groups.length > 0 ? { groups: layoutShape(input.layout) } : {}),
    // Feature 162 (US1-5) — the custom-field values carried from the request.
    ...(input.carriedCustomFieldKeys.length > 0 ? { carriedCustomFieldKeys: [...input.carriedCustomFieldKeys] } : {}),
  };
}

/** `order.place_via_api_key` — the API key an order was placed with. */
export function apiKeyPlacementAuditState(
  binding: { apiKeyId: string; organizationId: string; customerAccountId: string },
  order: Pick<Order, 'businessId'>,
): Record<string, unknown> {
  return {
    apiKeyId: binding.apiKeyId,
    organizationId: binding.organizationId,
    customerAccountId: binding.customerAccountId,
    businessId: order.businessId,
  };
}

/**
 * `order.custom_fields.update` — the narrow admin write of an Order's
 * custom-field values (`PATCH /api/v1/admin/orders/:id/custom-fields`). Runs
 * through the Command Bus (Principle XIII); validation may reject with a
 * per-field failure the route maps to a 422.
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
    capture: async ({ em }) => {
      const o = await em.findOne(Order, { id: orderId });
      return o ? { customFieldValues: o.customFieldValues ?? {} } : null;
    },
    run: async ({ em }) => {
      if (!isUuidShape(orderId)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
      const order = await em.findOne(Order, { id: orderId });
      if (!order) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
      order.customFieldValues = await customFieldValues.validateAndMerge('order', order.customFieldValues ?? {}, patch);
      return { result: order, after: { customFieldValues: order.customFieldValues } };
    },
  };
}
