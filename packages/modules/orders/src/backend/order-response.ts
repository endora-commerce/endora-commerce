import type { EntityManager } from '@mikro-orm/postgresql';
import type { Order as OrderResponse } from '@endora-commerce/contracts';
import type { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { OrderStatus } from './entities/order-status.entity.js';
import { OrderAppliedPromotion } from './entities/order-applied-promotion.entity.js';

/**
 * The serialized order every order route answers — the buyer-facing surface,
 * the admin surface and the external (`/api/v1/external/orders`) surface.
 *
 * Its return type is the published contract's own (`Order`, inferred from
 * `orderSchema` in `@endora-commerce/contracts`), so the compiler refuses a
 * field the contract does not declare, a field it requires that is no longer
 * emitted, and a value of a type it does not allow. Until issue #128 this
 * returned `Record<string, unknown>` and existed twice — once here for
 * `routes.ts` and once, line for line, in `routes.external.ts` — with nothing
 * but a comment holding the two to each other or either to the contract.
 *
 * @param capabilities what *this reader* may do with the order — computed by
 *   the platform and carried to the surface (feature 085, FR-018). Buyer-facing
 *   reads pass it; the admin and external reads do not, because an
 *   administrator's power to cancel has no per-order condition to report and
 *   the external surface has no cancel route.
 */
export async function serializeOrder(
  em: EntityManager,
  order: Order,
  capabilities?: { customerCancellable: boolean },
): Promise<OrderResponse> {
  const items = await em.find(OrderItem, { orderId: order.id });
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
    placedOnBehalfByAdminUserId: order.placedOnBehalfByAdminUserId ?? null,
    salesChannelId: order.salesChannelId,
    status: order.status,
    customFieldValues: order.customFieldValues ?? {},
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
    ...(capabilities ? { customerCancellable: capabilities.customerCancellable } : {}),
  };
}

