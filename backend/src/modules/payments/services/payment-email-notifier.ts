// Feature 047 — payment_status_changed transactional email. A net-new email
// (no legacy builder): subscribes to payment.received/failed and sends the
// admin-editable template to the order's customer. Best-effort; event-bus
// dispatch isolates handler errors.

import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountReadPort,
  OrderReadPort,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

/**
 * Why the payment-status e-mail did — or did not — go out (issue #78).
 *
 * `notify` answered `void`, and `void` covered seven situations: no sender
 * wired, no order behind the id, no address on the customer, the three outcomes
 * `send` reports since issue #67, and anything the bare `catch` absorbed. A
 * payment was recorded and nothing anywhere said whether the customer had been
 * told.
 */
export type PaymentEmailNotSentReason =
  /** No transactional sender is wired in this composition. */
  | 'no_sender'
  /** The event named an order this process cannot load. */
  | 'order_not_found'
  /** The customer account carries no address to send to. */
  | 'no_recipient'
  /** The operator switched the `payment_status_changed` e-mail off. */
  | 'deactivated'
  /** No mailer is wired behind the sender. */
  | 'no_transport'
  /** No `payment_status_changed` template exists yet. */
  | 'no_definition'
  /** The send raised, and the payment stays recorded. */
  | 'failed';

export type PaymentEmailResult = { sent: true } | { sent: false; reason: PaymentEmailNotSentReason };

/**
 * Where a send that did not happen is reported. Injectable so a test can read
 * it; defaults to `console.warn`, which is what the rest of this layer uses.
 */
export type PaymentEmailLog = (message: string, context: Record<string, unknown>) => void;

export interface PaymentEmailNotifierDeps {
  emFactory: () => EntityManager;
  /**
   * Feature 075 Phase C — the order and its buyer come from the ports their
   * owners publish, not from `Order` and `CustomerAccount`. Both fail closed
   * when their owner is off, and that is the right answer for a notification:
   * an e-mail addressed from data the platform will not read is worse than no
   * e-mail. `notify`'s `catch` re-throws `ModuleDisabledError` first, so the
   * refusal reaches the subscriber rather than being logged as `failed`.
   */
  orderRead: OrderReadPort;
  customerAccountRead: CustomerAccountReadPort;
  getTransactionalEmailSender: () => TransactionalEmailSender | undefined;
  log?: PaymentEmailLog;
}

export class PaymentEmailNotifier {
  private readonly log: PaymentEmailLog;

  constructor(private readonly deps: PaymentEmailNotifierDeps) {
    this.log = deps.log ?? ((message, context): void => console.warn(message, context));
  }

  /**
   * Public since feature 072 (T126), and `attach(eventBus)` is gone with it.
   * That method subscribed to the raw bus, which is how a payment-status
   * e-mail went out while this module was switched off; the module now
   * subscribes through `ctx.subscribe`, which stops with it.
   *
   * **Best-effort, and now audible.** The subscriber that calls this has no
   * result to inspect, so every non-sent path is written to the log as well as
   * named in the return value; a payment must not be un-recorded because the
   * notification failed.
   */
  async notify(
    orderId: string,
    status: 'paid' | 'failed',
    failureReason: string | null,
  ): Promise<PaymentEmailResult> {
    const sender = this.deps.getTransactionalEmailSender();
    if (!sender) return this.notSent(orderId, 'no_sender');
    try {
      const em = this.deps.emFactory();
      const order = await this.deps.orderRead.findById(orderId);
      if (!order) return this.notSent(orderId, 'order_not_found');
      const customer = await this.deps.customerAccountRead.findById(
        order.placedByCustomerAccountId,
      );
      if (!customer?.email) return this.notSent(orderId, 'no_recipient');
      const channel = await em.findOne(SalesChannel, { id: order.salesChannelId });
      const outcome = await sender.send({
        code: 'payment_status_changed',
        salesChannelId: order.salesChannelId,
        language: channel?.defaultLanguage ?? 'en-US',
        to: customer.email,
        messageId: `payment_status_changed:${order.id}:${status}`,
        variables: {
          order: { businessId: order.businessId },
          payment: { status, statusLabel: status === 'paid' ? 'Paid' : 'Failed', failureReason: failureReason ?? '' },
        },
        meta: { orderId: order.id, kind: 'payment_status_changed', status },
      });
      if (outcome.status !== 'sent') return this.notSent(orderId, outcome.status);
      return { sent: true };
    } catch (error) {
      // A switched-off module is a presence answer about the whole operation,
      // not a message that failed to render; absorbing it would report "sent
      // nothing" where the truthful answer is "this capability is off".
      rethrowIfModuleDisabled(error);
      // Everything else is contained: the payment is recorded and must not be
      // undone because the message did not go out. It is named, though.
      return this.notSent(orderId, 'failed', error);
    }
  }

  private notSent(
    orderId: string,
    reason: PaymentEmailNotSentReason,
    error?: unknown,
  ): PaymentEmailResult {
    this.log('[payments] the payment-status e-mail was not sent', {
      orderId,
      reason,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : error }),
    });
    return { sent: false, reason };
  }
}
