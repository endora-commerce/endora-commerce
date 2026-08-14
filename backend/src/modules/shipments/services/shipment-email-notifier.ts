// Feature 047 — shipment_created transactional email. A net-new email: subscribes
// to shipment.created.v1 and sends the admin-editable template to the order's
// customer. Best-effort; event-bus dispatch isolates handler errors.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { TransactionalEmailSender } from '@b2b/contracts';
import { Order } from '../../orders/entities/order.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

export interface ShipmentEmailNotifierDeps {
  emFactory: () => EntityManager;
  getTransactionalEmailSender: () => TransactionalEmailSender | undefined;
}

export class ShipmentEmailNotifier {
  constructor(private readonly deps: ShipmentEmailNotifierDeps) {}

  /**
   * Public since feature 072 (T124), and `attach(eventBus)` is gone with it.
   * That method subscribed to the raw bus, which is how a shipment-created
   * e-mail went out while this module was switched off; the module now
   * subscribes through `ctx.subscribe`, which stops with it.
   */
  async notify(orderId: string, shipmentId: string): Promise<void> {
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
