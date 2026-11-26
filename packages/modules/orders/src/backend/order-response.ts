import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomFieldValuePort,
  Order as OrderResponse,
  OrderComment as OrderCommentView,
} from '@endora-commerce/contracts';
import type { OrderComment } from './entities/order-comment.entity.js';
import type { Order } from './entities/order.entity.js';
import { OrderStatus } from './entities/order-status.entity.js';
import { OrderAppliedPromotion } from './entities/order-applied-promotion.entity.js';
import { loadArrangedOrderLines } from './services/order-line-order.js';

/**
 * Which keys of an order's custom-field bag a non-administrator may read.
 * `custom_fields` publishes it (`CustomFieldValuePort.projectForCustomer`);
 * declared structurally so this file names the one method it needs.
 */
export type CustomerCustomFieldProjection = Pick<CustomFieldValuePort, 'projectForCustomer'>;

/**
 * An order as an ADMINISTRATOR reads it: every stored custom-field value, and
 * the identifier of the administrator who placed it on the customer's behalf.
 *
 * The return type is the published contract's own (`Order`, inferred from
 * `orderSchema` in `@endora-commerce/contracts`), so the compiler refuses a
 * field the contract does not declare, a field it requires that is no longer
 * emitted, and a value of a type it does not allow.
 *
 * Never answer this to a buyer or to an external caller — that is
 * {@link serializeOrderForCustomer}. There is deliberately no serialiser
 * without an audience in its name: a new route has to say who is reading.
 */
export async function serializeOrderForAdmin(em: EntityManager, order: Order): Promise<OrderResponse> {
  return {
    ...(await serializeShared(em, order)),
    placedOnBehalfByAdminUserId: order.placedOnBehalfByAdminUserId ?? null,
    customFieldValues: order.customFieldValues ?? {},
  };
}

/**
 * An order as a NON-administrator reads it — the buyer-facing surface and the
 * external (`/api/v1/external/orders`) surface. The one place both are
 * narrowed:
 *
 * - `customFieldValues` carries only the values whose definition has the
 *   `customer` audience. An `internal` field's value and a value whose
 *   definition is gone are left out. Without the projection (the
 *   `custom_fields` port is not wired) nothing is answered at all: failing
 *   closed is the only safe reading of "nobody can say what is internal".
 * - `placedOnBehalfByAdminUserId` is not emitted; `placedOnBehalf` says the
 *   one thing a customer may know about it.
 *
 * @param capabilities what *this reader* may do with the order — computed by
 *   the platform and carried to the surface (feature 085, FR-018). Buyer-facing
 *   reads pass it; the external reads do not, because that surface has no
 *   cancel route.
 */
export async function serializeOrderForCustomer(
  em: EntityManager,
  order: Order,
  customFields: CustomerCustomFieldProjection | undefined,
  capabilities?: { customerCancellable: boolean },
): Promise<OrderResponse> {
  return {
    ...(await serializeShared(em, order)),
    customFieldValues: customFields
      ? await customFields.projectForCustomer('order', order.customFieldValues ?? {})
      : {},
    ...(capabilities ? { customerCancellable: capabilities.customerCancellable } : {}),
  };
}

/** Everything of an order reply that does not depend on who is reading it. */
async function serializeShared(
  em: EntityManager,
  order: Order,
): Promise<Omit<OrderResponse, 'customFieldValues' | 'placedOnBehalfByAdminUserId'>> {
  // Feature 159 (FR-011, FR-087) — the lines in display order and the order's
  // groups; this read had no order before (research R-1).
  const { groups: itemGroups, lines: items } = await loadArrangedOrderLines(em, order.id);
  // Status label payload (feature 039 follow-up): the localized name map + the
  // language-independent default name, so any client resolves
  // name[language] → defaultName → code in the viewer's language.
  const statusDef = await em.findOne(OrderStatus, { code: order.status });
  // Feature 045 (US2) — per-promotion discount breakdown.
  const appliedPromotions = await em.find(OrderAppliedPromotion, { orderId: order.id });
  return {
    id: order.id,
    businessId: order.businessId,
    organizationId: order.organizationId,
    placedByCustomerAccountId: order.placedByCustomerAccountId,
    placedOnBehalf: order.placedOnBehalfByAdminUserId != null,
    salesChannelId: order.salesChannelId,
    status: order.status,
    statusName: statusDef?.name ?? {},
    statusDefaultName: statusDef?.defaultName ?? order.status,
    paymentStatus: order.paymentStatus,
    deliveryAddress: order.deliveryAddress,
    billingAddress: order.billingAddress,
    deliveryPoint: order.deliveryPointSnapshot ?? null,
    deliveryMethod: {
      id: order.deliveryMethodId,
      code: order.deliveryMethodSnapshot.code,
      name: order.deliveryMethodSnapshot.name,
      cost: order.deliveryMethodSnapshot.cost,
    },
    paymentMethod: {
      id: order.paymentMethodId,
      code: order.paymentMethodSnapshot.code,
      name: order.paymentMethodSnapshot.name,
      kind: order.paymentMethodSnapshot.kind,
    },
    sourceQuoteRequestId: order.sourceQuoteRequestId ?? null,
    itemGroups,
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId,
      productSnapshot: it.productSnapshot,
      variantId: it.variantId ?? null,
      variantSnapshot: it.variantSnapshot ?? null,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
      taxRate: Number(it.taxRate),
      lineTotal: Number(it.lineTotal),
      groupId: it.groupId ?? null,
      position: it.position,
    })),
    subtotal: Number(order.subtotal),
    taxTotal: Number(order.taxTotal),
    discountTotal: Number(order.discountTotal),
    appliedPromotions: appliedPromotions.map((ap) => ({
      promotionId: ap.promotionId,
      couponId: ap.couponId ?? null,
      amount: Number(ap.amount),
      currency: ap.currency,
    })),
    deliveryTotal: Number(order.deliveryTotal),
    total: Number(order.total),
    currency: order.currency,
    customerNote: order.customerNote ?? null,
    placedAt: order.placedAt.toISOString(),
    // Feature 036 — real payment next-action captured at placement (transfer
    // details / gateway redirect / none). Order reads (GET/list) load it as
    // undefined → null.
    nextAction: order.nextAction ?? null,
    // `specs/182-related-payers/` (FR-067, FR-073) — the payer, as order data.
    payer:
      order.payerOrganizationId && order.payerSnapshot
        ? {
            organizationId: order.payerOrganizationId,
            name: order.payerSnapshot.name,
            taxId: order.payerSnapshot.taxId,
            terms: order.payerTerms ?? 'buyer',
          }
        : null,
  };
}


/**
 * The published `orderCommentSchema` (issue #599) — the admin comment routes'
 * answer and `orderCommandPort.addComment`'s.
 */
export function serializeComment(c: OrderComment): OrderCommentView {
  return {
    id: c.id,
    orderId: c.orderId,
    authorAdminUserId: c.authorAdminUserId ?? null,
    authorCustomerAccountId: c.authorCustomerAccountId ?? null,
    body: c.body,
    isCustomerVisible: c.isCustomerVisible,
    notifyCustomer: c.notifyCustomer,
    systemNote: c.systemNote ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}
