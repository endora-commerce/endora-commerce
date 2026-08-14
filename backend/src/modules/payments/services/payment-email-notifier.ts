// Feature 047 — payment_status_changed transactional email. A net-new email
// (no legacy builder): subscribes to payment.received/failed and sends the
// admin-editable template to the order's customer. Best-effort; event-bus
// dispatch isolates handler errors.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { TransactionalEmailSender } from '@b2b/contracts';
import { Order } from '../../orders/entities/order.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

export interface PaymentEmailNotifierDeps {
  emFactory: () => EntityManager;
  getTransactionalEmailSender: () => TransactionalEmailSender | undefined;
}

export class PaymentEmailNotifier {
  constructor(private readonly deps: PaymentEmailNotifierDeps) {}

  /**
   * Public since feature 072 (T126), and `attach(eventBus)` is gone with it.
   * That method subscribed to the raw bus, which is how a payment-status
   * e-mail went out while this module was switched off; the module now
   * subscribes through `ctx.subscribe`, which stops with it.
   */
  async notify(orderId: string, status: 'paid' | 'failed', failureReason: string | null): Promise<void> {
    const sender = this.deps.getTransactionalEmailSender();
    if (!sender) return;
    try {
      const em = this.deps.emFactory();
      const order = await em.findOne(Order, { id: orderId });
      if (!order) return;
      const customer = await em.findOne(CustomerAccount, { id: order.placedByCustomerAccountId });
      if (!customer?.email) return;
      const channel = await em.findOne(SalesChannel, { id: order.salesChannelId });
      await sender.send({
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
    } catch {
      // best-effort
    }
  }
}
