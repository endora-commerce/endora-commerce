// Feature 047 — shipment_created transactional email. A net-new email: subscribes
// to shipment.created.v1 and sends the admin-editable template to the order's
// customer. Best-effort; event-bus dispatch isolates handler errors.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { TransactionalEmailSender } from '@b2b/contracts';
import type { EventBus } from '../../../events/bus.js';
import { Order } from '../../orders/entities/order.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

export interface ShipmentEmailNotifierDeps {
  emFactory: () => EntityManager;
  getTransactionalEmailSender: () => TransactionalEmailSender | undefined;
}

export class ShipmentEmailNotifier {
  constructor(private readonly deps: ShipmentEmailNotifierDeps) {}

  attach(eventBus: EventBus): void {
    eventBus.on('shipment.created.v1', (payload) => {
      const p = payload as unknown as { orderId: string; shipmentId: string };
      void this.notify(p.orderId, p.shipmentId);
    });
  }

  private async notify(orderId: string, shipmentId: string): Promise<void> {
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
        code: 'shipment_created',
        salesChannelId: order.salesChannelId,
        language: channel?.defaultLanguage ?? 'en-US',
        to: customer.email,
        messageId: `shipment_created:${shipmentId}`,
        variables: { order: { businessId: order.businessId } },
        meta: { orderId: order.id, shipmentId, kind: 'shipment_created' },
      });
    } catch {
      // best-effort
    }
  }
}
