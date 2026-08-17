import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/order-item.entity.js';
import { Cart } from '../../carts/entities/cart.entity.js';
import { CartItem } from '../../carts/entities/cart-item.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import type { EmailMailerPort, TransactionalEmailSender } from '@b2b/contracts';
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
    private readonly resolveReorderEnabled?: (salesChannelId: string) => Promise<boolean>,
    private readonly mailer?: EmailMailerPort,
    private readonly getTransactionalEmailSender?: () => TransactionalEmailSender | undefined,
  ) {}

  async reorder(
    orderId: string,
    ctx: ReorderContext,
    opts: { notifyCustomer?: boolean } = {},
  ): Promise<ReorderResult> {
    // command-coverage-ignore: reorder rebuilds the customer's active cart from a
    // prior order — a cart mutation (the carts module owns cart auditing), not an
    // order-domain write; fully reconstructable, no undo value.
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
    const products = await em.find(Product, { id: { $in: productIds } });
    const available = new Map(products.filter((p) => p.status !== 'inactive' && !p.deletedAt).map((p) => [p.id, p]));

    const unavailableItems: ReorderUnavailableItem[] = [];
    const reorderable = items.filter((it) => {
      if (!available.has(it.productId)) {
        unavailableItems.push({ productId: it.productId, variantId: it.variantId ?? null, reason: 'discontinued' });
        return false;
      }
      return true;
    });

    // Get-or-create the customer's active cart, clear it, and reseed from the
    // order's items (snapshot prices; the cart re-prices on read where wired).
    let cart = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      organizationId: ctx.organizationId,
      status: 'active',
    });
    if (!cart) {
      cart = em.create(Cart, { customerAccountId: ctx.customerAccountId, organizationId: ctx.organizationId });
      await em.persistAndFlush(cart);
    } else {
      const existing = await em.find(CartItem, { cartId: cart.id });
      if (existing.length > 0) await em.removeAndFlush(existing);
    }

    const newItems = reorderable.map((it) =>
      em.create(CartItem, {
        cartId: cart!.id,
        productId: it.productId,
        ...(it.variantId ? { variantId: it.variantId } : {}),
        quantity: it.quantity,
        unitPrice: String(it.unitPrice),
        currency: order.currency,
      }),
    );
    if (newItems.length > 0) await em.persistAndFlush(newItems);

    if (opts.notifyCustomer) await this.notify(em, order);

    return {
      cartId: cart.id,
      checkoutUrl: `/checkout?cartId=${cart.id}&reorderOf=${order.id}`,
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
    const customer = await em.findOne(CustomerAccount, { id: order.placedByCustomerAccountId });
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
