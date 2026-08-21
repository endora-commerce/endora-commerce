import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/order-item.entity.js';
import type {
  CartWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  EmailMailerPort,
  TransactionalEmailSender,
} from '@b2b/contracts';
import { buildReorderCreatedEmail } from '../email-templates/reorder-created.js';
import {
  orderEmailNotSent,
  sendOrderTransactionalEmail,
  type OrderEmailResult,
} from './transactional-email-helper.js';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';

export interface ReorderUnavailableItem {
  productId: string;
  variantId?: string | null;
  reason: 'discontinued' | 'out_of_catalog_scope' | 'out_of_stock' | 'no_price';
}

export interface ReorderResult {
  cartId: string;
  checkoutUrl: string;
  unavailableItems: ReorderUnavailableItem[];
}

interface ReorderContext {
  customerAccountId: string;
  organizationId: string;
}

/**
 * OrderReorderService — feature 038 (US6).
 *
 * Rebuilds the customer's active cart from a past order's line items and routes
 * the actor through Checkout. Gated by the `orders.reorder_enabled` setting
 * (resolved per Sales Channel). Line items whose product is no longer available
 * are reported, not silently dropped (FR-026). Mirrors the established
 * cart-repopulate pattern from RfqService.convertToOrder.
 */
export class OrderReorderService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cartWrite: CartWritePort,
    private readonly catalogProductRead: CatalogProductReadPort,
    private readonly customerAccountRead: CustomerAccountReadPort,
    private readonly resolveReorderEnabled?: (salesChannelId: string) => Promise<boolean>,
    private readonly mailer?: EmailMailerPort,
    private readonly getTransactionalEmailSender?: () => TransactionalEmailSender | undefined,
  ) {}

  async reorder(
    orderId: string,
    ctx: ReorderContext,
    opts: { notifyCustomer?: boolean } = {},
  ): Promise<ReorderResult> {
    // The marker that used to sit here is gone with the write it exempted
    // (feature 075): this method no longer touches `carts`' tables at all — it
    // hands the lines to `cartWritePort.replaceItemsForCustomer`, and cart
    // auditing is the `carts` module's, where it always belonged. Reading an
    // order and sending a message is all that is left on this side.
    const em = this.emFactory();
    const order = await em.findOne(Order, { id: orderId, organizationId: ctx.organizationId });
    if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');

    const enabled = this.resolveReorderEnabled ? await this.resolveReorderEnabled(order.salesChannelId) : true;
    if (!enabled) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Reordering is disabled for this sales channel.', {
        code: 'reorder_disabled',
      });
    }

    const items = await em.find(OrderItem, { orderId });
    const productIds = [...new Set(items.map((it) => it.productId))];
    // `liveOnly` is the soft-delete half of the old predicate; the status half
    // stays here because it is `!== 'inactive'` rather than `=== 'active'`, and
    // `activeOnly` would quietly drop a draft product a past order contains.
    const products = await this.catalogProductRead.findByIds(productIds, { liveOnly: true });
    const available = new Map(
      products.filter((p) => p.status !== 'inactive').map((p) => [p.id, p]),
    );

    /**
     * **No sales-channel filter here, by an owner ruling of 2026-08-21**
     * (issue #259). It is a decision, not an omission — every acquisition seam
     * around this one grew one in that issue, so the absence would otherwise
     * read as the seam that was missed.
     *
     * Two reasons, and the second is the one that is invisible from this call
     * site:
     *
     *  1. A reorder names **no product the caller supplied**. It re-acquires
     *     the lines of an order this buyer already placed — a commitment the
     *     platform accepted, priced and fulfilled. That is a different question
     *     from "may this buyer put this id in a cart", which is what the seams
     *     that *do* filter are answering. `orders.reorder_enabled` is already
     *     resolved against `order.salesChannelId` above, so the channel that
     *     governs this operation is the order's own, not the request's.
     *  2. Repairing it would need a **new `ReorderUnavailableItem.reason`
     *     value**, which is a contract change. Reusing `'discontinued'` is not
     *     available: a product sold on another storefront has not been
     *     discontinued, and telling a buyer it has is a lie the storefront
     *     would render verbatim. That is what makes the obvious one-line fix
     *     wrong, and it is why this paragraph is longer than the fix would
     *     have been.
     *
     * The sibling ruling covers `quote_requests`' `convertToOrder`, which
     * re-acquires an approved quote's lines through the same
     * `replaceItemsForCustomer` port and for the same reason.
     */
    const unavailableItems: ReorderUnavailableItem[] = [];
    const reorderable = items.filter((it) => {
      if (!available.has(it.productId)) {
        unavailableItems.push({ productId: it.productId, variantId: it.variantId ?? null, reason: 'discontinued' });
        return false;
      }
      return true;
    });

    // Clear the customer's active cart and reseed it from the order's items
    // (snapshot prices; the cart re-prices on read where wired). This module
    // used to `em.create(Cart, …)` and hand-build `CartItem` rows, which is two
    // of another module's tables written from here, with the clear-then-seed
    // rule spelled out a second time and the `lastActivityAt` bookkeeping in
    // neither. `replaceItemsForCustomer` is `carts`' published answer to
    // exactly that, and its doc comment names this path.
    const cart = await this.cartWrite.replaceItemsForCustomer(
      { customerAccountId: ctx.customerAccountId, organizationId: ctx.organizationId },
      reorderable.map((it) => ({
        productId: it.productId,
        ...(it.variantId ? { variantId: it.variantId } : {}),
        quantity: it.quantity,
        unitPrice: String(it.unitPrice),
        currency: order.currency,
      })),
    );

    if (opts.notifyCustomer) await this.notify(em, order);

    return {
      cartId: cart.cart.id,
      checkoutUrl: `/checkout?cartId=${cart.cart.id}&reorderOf=${order.id}`,
      unavailableItems,
    };
  }

  /**
   * Tells the customer their cart was rebuilt, and reports whether it went out.
   *
   * It answered `void` before (issue #78): no address on the customer, no
   * mailer in the composition, an operator-deactivated template and a send that
   * raised all produced the same nothing as a delivered message.
   */
  private async notify(em: EntityManager, order: Order): Promise<OrderEmailResult> {
    const context = { orderId: order.id, code: 'reorder_created' };
    const customer = await this.customerAccountRead.findById(order.placedByCustomerAccountId);
    if (!customer?.email) return orderEmailNotSent(undefined, context, 'no_recipient');
    const sender = this.getTransactionalEmailSender?.();
    if (sender) {
      return sendOrderTransactionalEmail(em, sender, order, {
        orderId: order.id,
        code: 'reorder_created',
        to: customer.email,
        messageId: `order_reorder:${order.id}`,
        variables: { order: { sourceBusinessId: order.businessId, id: order.id } },
        meta: { sourceOrderId: order.id, kind: 'order_reorder' },
      });
    }
    if (!this.mailer) return orderEmailNotSent(undefined, context, 'no_transport');
    try {
      const outcome = await this.mailer.send(
        buildReorderCreatedEmail({ to: customer.email, sourceBusinessId: order.businessId, orderId: order.id }),
      );
      return outcome.status === 'sent'
        ? { sent: true }
        : orderEmailNotSent(undefined, context, 'suppressed');
    } catch (error) {
      // Best-effort: the cart is rebuilt either way. A switched-off module is
      // not a delivery failure, so it travels on.
      rethrowIfModuleDisabled(error);
      return orderEmailNotSent(undefined, context, 'failed', error);
    }
  }
}
