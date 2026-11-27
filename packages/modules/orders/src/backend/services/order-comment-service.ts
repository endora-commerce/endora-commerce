import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { makeOrderCommentAddCommand } from '../commands/order-comment-add.command.js';
import { OrderComment } from '../entities/order-comment.entity.js';
import type { Order } from '../entities/order.entity.js';
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
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';

/**
 * OrderCommentService — feature 038 (US5).
 *
 * Threaded comments on an order. Comments are allowed only while the order is
 * non-terminal (FR-032). Admin/sales-rep authors may set customer-visibility
 * and notify flags; customer-authored comments are always customer-visible and
 * never notify (FR-033). A customer-visible admin comment with notify on sends
 * the customer an email (best-effort).
 *
 * Every comment is the audited `order.comment.add` Command since 0.113.0
 * (`specs/186-aggregate-ports/` US4, research R-18.4); it was a plain flush
 * under a `command-coverage-ignore` before.
 */
export class OrderCommentService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly graphService: OrderStatusGraphService,
    private readonly customerAccountRead: CustomerAccountReadPort,
    /**
     * `specs/186-aggregate-ports/` US4 (T059) — a comment is the
     * `order.comment.add` Command, for the operator, the buyer and
     * `orderCommandPort.addComment` alike.
     */
    private readonly commandBus: Pick<CommandBus, 'run'>,
    private readonly mailer?: EmailMailerPort,
    private readonly getTransactionalEmailSender?: () => TransactionalEmailSender | undefined,
  ) {}

  /**
   * An operator's comment. The notice to the buyer — a customer-visible
   * comment with `notifyCustomer` — is sent after the Command has committed,
   * best effort, and never fails the call.
   */
  async addByAdmin(
    orderId: string,
    adminUserId: string | null,
    input: { body: string; isCustomerVisible: boolean; notifyCustomer: boolean },
    caller: CallerOptions = {},
  ): Promise<OrderComment> {
    const { comment, order } = await this.commandBus.run(
      withCallerOptions(
        makeOrderCommentAddCommand(
          { graph: this.graphService },
          {
            orderId,
            authorAdminUserId: adminUserId,
            authorCustomerAccountId: null,
            body: input.body,
            isCustomerVisible: input.isCustomerVisible,
            notifyCustomer: input.notifyCustomer,
          },
        ),
        caller,
      ),
    );

    if (input.isCustomerVisible && input.notifyCustomer) {
      await this.notifyCustomer(this.emFactory(), order, input.body);
    }
    return comment;
  }

  async addByCustomer(
    orderId: string,
    customerAccountId: string,
    input: { body: string },
  ): Promise<OrderComment> {
    // Customers cannot set internal-visibility or notify flags (FR-033).
    const { comment } = await this.commandBus.run(
      makeOrderCommentAddCommand(
        { graph: this.graphService },
        {
          orderId,
          authorAdminUserId: null,
          authorCustomerAccountId: customerAccountId,
          body: input.body,
          isCustomerVisible: true,
          notifyCustomer: false,
        },
      ),
    );
    return comment;
  }

  /** All comments (internal + customer-visible) for the Admin UI. */
  async listForAdmin(orderId: string): Promise<OrderComment[]> {
    const em = this.emFactory();
    return em.find(OrderComment, { orderId }, { orderBy: { createdAt: 'asc' } });
  }

  /**
   * Only customer-visible comments (FR-031) — and never a system note
   * (feature 162), whatever its visibility flag says: two filters, so one
   * mistaken flag cannot show the buyer an internal note.
   */
  async listForCustomer(orderId: string): Promise<OrderComment[]> {
    const em = this.emFactory();
    return em.find(
      OrderComment,
      { orderId, isCustomerVisible: true, systemNote: null },
      { orderBy: { createdAt: 'asc' } },
    );
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
        : orderEmailNotSent(undefined, context, outcome.status);
    } catch (error) {
      // Notification delivery is best-effort; never block the comment. A
      // switched-off module is not a delivery failure, so it travels on.
      rethrowIfModuleDisabled(error);
      return orderEmailNotSent(undefined, context, 'failed', error);
    }
  }
}
