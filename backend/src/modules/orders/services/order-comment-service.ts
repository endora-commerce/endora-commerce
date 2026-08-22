import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { OrderComment } from '../entities/order-comment.entity.js';
import { Order } from '../entities/order.entity.js';
import type {
  CustomerAccountReadPort,
  EmailMailerPort,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import type { OrderStatusGraphService } from './order-status-graph-service.js';
import { buildOrderCommentNotificationEmail } from '../email-templates/order-comment-notification.js';
import {
  orderEmailNotSent,
  sendOrderTransactionalEmail,
  type OrderEmailResult,
} from './transactional-email-helper.js';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';

/**
 * OrderCommentService — feature 038 (US5).
 *
 * Threaded comments on an order. Comments are allowed only while the order is
 * non-terminal (FR-032). Admin/sales-rep authors may set customer-visibility
 * and notify flags; customer-authored comments are always customer-visible and
 * never notify (FR-033). A customer-visible admin comment with notify on sends
 * the customer an email (best-effort).
 */
export class OrderCommentService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly graphService: OrderStatusGraphService,
    private readonly customerAccountRead: CustomerAccountReadPort,
    private readonly mailer?: EmailMailerPort,
    private readonly getTransactionalEmailSender?: () => TransactionalEmailSender | undefined,
  ) {}

  async addByAdmin(
    orderId: string,
    adminUserId: string | null,
    input: { body: string; isCustomerVisible: boolean; notifyCustomer: boolean },
  ): Promise<OrderComment> {
    // command-coverage-ignore: order comments are an append-only communication
    // thread, not audited domain-state — no before-state, no undo value.
    const em = this.emFactory();
    const order = await this.loadNonTerminalOrder(em, orderId);
    const comment = em.create(OrderComment, {
      orderId,
      authorAdminUserId: adminUserId,
      authorCustomerAccountId: null,
      body: input.body,
      isCustomerVisible: input.isCustomerVisible,
      notifyCustomer: input.notifyCustomer,
    });
    await em.persistAndFlush(comment);

    if (input.isCustomerVisible && input.notifyCustomer) {
      await this.notifyCustomer(em, order, input.body);
    }
    return comment;
  }

  async addByCustomer(
    orderId: string,
    customerAccountId: string,
    input: { body: string },
  ): Promise<OrderComment> {
    // command-coverage-ignore: order comments are an append-only communication
    // thread, not audited domain-state — no before-state, no undo value.
    const em = this.emFactory();
    await this.loadNonTerminalOrder(em, orderId);
    // Customers cannot set internal-visibility or notify flags (FR-033).
    const comment = em.create(OrderComment, {
      orderId,
      authorAdminUserId: null,
      authorCustomerAccountId: customerAccountId,
      body: input.body,
      isCustomerVisible: true,
      notifyCustomer: false,
    });
    await em.persistAndFlush(comment);
    return comment;
  }

  /** All comments (internal + customer-visible) for the Admin UI. */
  async listForAdmin(orderId: string): Promise<OrderComment[]> {
    const em = this.emFactory();
    return em.find(OrderComment, { orderId }, { orderBy: { createdAt: 'asc' } });
  }

  /** Only customer-visible comments (FR-031). */
  async listForCustomer(orderId: string): Promise<OrderComment[]> {
    const em = this.emFactory();
    return em.find(OrderComment, { orderId, isCustomerVisible: true }, { orderBy: { createdAt: 'asc' } });
  }

  private async loadNonTerminalOrder(em: EntityManager, orderId: string): Promise<Order> {
    const order = await em.findOne(Order, { id: orderId });
    if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
    const graph = await this.graphService.loadGraph();
    if (graph.isTerminal(order.status)) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'Commenting is closed for completed or cancelled orders.',
      );
    }
    return order;
  }

  /**
   * Tells the customer about a comment, and reports whether it went out.
   *
   * It answered `void` before (issue #78): no address on the customer, no
   * mailer in the composition, an operator-deactivated template and a send that
   * raised all produced the same nothing as a delivered message.
   */
  private async notifyCustomer(
    em: EntityManager,
    order: Order,
    body: string,
  ): Promise<OrderEmailResult> {
    const context = { orderId: order.id, code: 'order_comment' };
    const customer = await this.customerAccountRead.findById(order.placedByCustomerAccountId);
    if (!customer?.email) return orderEmailNotSent(undefined, context, 'no_recipient');
    const message = buildOrderCommentNotificationEmail({
      to: customer.email,
      orderId: order.id,
      businessId: order.businessId,
      body,
    });
    const sender = this.getTransactionalEmailSender?.();
    if (sender) {
      return sendOrderTransactionalEmail(em, sender, order, {
        orderId: order.id,
        code: 'order_comment',
        to: customer.email,
        messageId: message.messageId,
        variables: { order: { businessId: order.businessId }, comment: { body } },
        meta: { orderId: order.id, kind: 'order_comment' },
      });
    }
    if (!this.mailer) return orderEmailNotSent(undefined, context, 'no_transport');
    try {
      const outcome = await this.mailer.send(message);
      return outcome.status === 'sent'
        ? { sent: true }
        : orderEmailNotSent(undefined, context, 'suppressed');
    } catch (error) {
      // Notification delivery is best-effort; never block the comment. A
      // switched-off module is not a delivery failure, so it travels on.
      rethrowIfModuleDisabled(error);
      return orderEmailNotSent(undefined, context, 'failed', error);
    }
  }
}
