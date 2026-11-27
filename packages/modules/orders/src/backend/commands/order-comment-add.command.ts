import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { OrderComment } from '../entities/order-comment.entity.js';
import { Order } from '../entities/order.entity.js';
import type { OrderStatusGraphService } from '../services/order-status-graph-service.js';

/** The audit action a comment on an order is recorded under (new in 0.113.0). */
export const ORDER_COMMENT_ADD_ACTION = 'order.comment.add';

export interface OrderCommentAddCommandDeps {
  readonly graph: Pick<OrderStatusGraphService, 'loadGraph'>;
}

/** One comment, as its author writes it. */
export interface OrderCommentAddInput {
  readonly orderId: string;
  /** The administrator who wrote it, or `null` (a system writer, or the buyer). */
  readonly authorAdminUserId: string | null;
  /** The buyer who wrote it, or `null`. */
  readonly authorCustomerAccountId: string | null;
  readonly body: string;
  readonly isCustomerVisible: boolean;
  readonly notifyCustomer: boolean;
}

/** What the Command answers: the comment, and the order its notice is about. */
export interface OrderCommentAdded {
  readonly comment: OrderComment;
  readonly order: Order;
}

/**
 * `order.comment.add` (`specs/186-aggregate-ports/` US4, T059) — a comment on
 * an order, by an operator (`POST /api/v1/admin/orders/:id/comments`,
 * `orderCommandPort.addComment`) or by the buyer
 * (`POST /api/v1/orders/:id/comments`). Until 0.113.0 it was a plain flush
 * with a `command-coverage-ignore`; a write a server-side caller can make
 * through a published port is a Command, so hooks and the audit trail see it
 * (FR-003, research R-18.4).
 *
 * Refused `404 ORDER_NOT_FOUND` for an order the caller cannot see, and
 * `409 ORDER_COMMENTS_CLOSED` on a terminal one (FR-032) — both before
 * anything is written. The entry names the comment and its two flags; the
 * body is free text and never recorded (audit-state.md list 1).
 *
 * The buyer's notice is the caller's, after the commit: an e-mail is not
 * something a rolled-back transaction can take back.
 */
export function makeOrderCommentAddCommand(
  deps: OrderCommentAddCommandDeps,
  input: OrderCommentAddInput,
): Command<OrderCommentAdded> {
  return {
    action: ORDER_COMMENT_ADD_ACTION,
    objectType: 'order',
    objectId: input.orderId,
    run: async ({ em }) => {
      const order = await loadNonTerminalOrder(em, deps.graph, input.orderId);
      const comment = em.create(OrderComment, {
        orderId: input.orderId,
        authorAdminUserId: input.authorAdminUserId,
        authorCustomerAccountId: input.authorCustomerAccountId,
        body: input.body,
        isCustomerVisible: input.isCustomerVisible,
        notifyCustomer: input.notifyCustomer,
      });
      await em.persist(comment).flush();
      return {
        result: { comment, order },
        before: null,
        after: {
          commentId: comment.id,
          isCustomerVisible: comment.isCustomerVisible,
          notifyCustomer: comment.notifyCustomer,
        },
      };
    },
  };
}

/** The order, through the caller's tenant filter, if it is still open for comments. */
export async function loadNonTerminalOrder(
  em: EntityManager,
  graph: Pick<OrderStatusGraphService, 'loadGraph'>,
  orderId: string,
): Promise<Order> {
  if (!isUuidShape(orderId)) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
  const order = await em.findOne(Order, { id: orderId });
  if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
  if ((await graph.loadGraph()).isTerminal(order.status)) {
    throw new HttpError(
      409,
      // Issue #86 — its own code: under `VALIDATION_FAILED` this sentence
      // was answered in English whatever the reader asked for.
      ERROR_CODES.ORDER_COMMENTS_CLOSED,
      'Commenting is closed for completed or cancelled orders.',
      { orderId },
    );
  }
  return order;
}
