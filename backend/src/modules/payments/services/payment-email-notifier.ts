// Feature 047 — payment_status_changed transactional email. A net-new email
// (no legacy builder): subscribes to payment.received/failed and sends the
// admin-editable template to the order's customer. Best-effort; event-bus
// dispatch isolates handler errors.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { TransactionalEmailSender } from '@b2b/contracts';
import type { EventBus } from '../../../events/bus.js';
import { Order } from '../../orders/entities/order.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';

export interface PaymentEmailNotifierDeps {
  emFactory: () => EntityManager;
  getTransactionalEmailSender: () => TransactionalEmailSender | undefined;
}

export class PaymentEmailNotifier {
  constructor(private readonly deps: PaymentEmailNotifierDeps) {}

  attach(eventBus: EventBus): void {
    eventBus.on('payment.received.v1', (payload) => {
      const p = payload as unknown as { orderId: string };
      void this.notify(p.orderId, 'paid', null);
    });
    eventBus.on('payment.failed.v1', (payload) => {
      const p = payload as unknown as { orderId: string; failureReason: string | null };
      void this.notify(p.orderId, 'failed', p.failureReason ?? null);
    });
  }

  private async notify(orderId: string, status: 'paid' | 'failed', failureReason: string | null): Promise<void> {
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
