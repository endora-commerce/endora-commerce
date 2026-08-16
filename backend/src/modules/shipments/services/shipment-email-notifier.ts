// Feature 047 — shipment_created transactional email. A net-new email: subscribes
// to shipment.created.v1 and sends the admin-editable template to the order's
// customer. Best-effort; event-bus dispatch isolates handler errors.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { TransactionalEmailSender } from '@b2b/contracts';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import { Order } from '../../orders/entities/order.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

/**
 * Why the shipment-created e-mail did — or did not — go out (issue #78).
 *
 * `notify` answered `void`, so a parcel whose customer was never told read
 * exactly like one whose customer was: no sender wired, no order behind the id,
 * no address on the customer, the three outcomes `send` reports since issue
 * #67, and anything the bare `catch` absorbed all produced that same `void`.
 */
export type ShipmentEmailNotSentReason =
  /** No transactional sender is wired in this composition. */
  | 'no_sender'
  /** The event named an order this process cannot load. */
  | 'order_not_found'
  /** The customer account carries no address to send to. */
  | 'no_recipient'
  /** The operator switched the `shipment_created` e-mail off. */
  | 'deactivated'
  /** No mailer is wired behind the sender. */
  | 'no_transport'
  /** No `shipment_created` template exists yet. */
  | 'no_definition'
  /** The send raised, and the shipment stays created. */
  | 'failed';

export type ShipmentEmailResult =
  | { sent: true }
  | { sent: false; reason: ShipmentEmailNotSentReason };

/**
 * Where a send that did not happen is reported. Injectable so a test can read
 * it; defaults to `console.warn`, which is what the rest of this layer uses.
 */
export type ShipmentEmailLog = (message: string, context: Record<string, unknown>) => void;

export interface ShipmentEmailNotifierDeps {
  emFactory: () => EntityManager;
  getTransactionalEmailSender: () => TransactionalEmailSender | undefined;
  log?: ShipmentEmailLog;
}

export class ShipmentEmailNotifier {
  private readonly log: ShipmentEmailLog;

  constructor(private readonly deps: ShipmentEmailNotifierDeps) {
    this.log = deps.log ?? ((message, context): void => console.warn(message, context));
  }

  /**
   * Public since feature 072 (T124), and `attach(eventBus)` is gone with it.
   * That method subscribed to the raw bus, which is how a shipment-created
   * e-mail went out while this module was switched off; the module now
   * subscribes through `ctx.subscribe`, which stops with it.
   *
   * **Best-effort, and now audible.** The subscriber that calls this has no
   * result to inspect, so every non-sent path is written to the log as well as
   * named in the return value; a shipment must not be un-created because the
   * notification failed.
   */
  async notify(orderId: string, shipmentId: string): Promise<ShipmentEmailResult> {
    const sender = this.deps.getTransactionalEmailSender();
    if (!sender) return this.notSent(orderId, shipmentId, 'no_sender');
    try {
      const em = this.deps.emFactory();
      const order = await em.findOne(Order, { id: orderId });
      if (!order) return this.notSent(orderId, shipmentId, 'order_not_found');
      const customer = await em.findOne(CustomerAccount, { id: order.placedByCustomerAccountId });
      if (!customer?.email) return this.notSent(orderId, shipmentId, 'no_recipient');
      const channel = await em.findOne(SalesChannel, { id: order.salesChannelId });
      const outcome = await sender.send({
        code: 'shipment_created',
        salesChannelId: order.salesChannelId,
        language: channel?.defaultLanguage ?? 'en-US',
        to: customer.email,
        messageId: `shipment_created:${shipmentId}`,
        variables: { order: { businessId: order.businessId } },
        meta: { orderId: order.id, shipmentId, kind: 'shipment_created' },
      });
      if (outcome.status !== 'sent') return this.notSent(orderId, shipmentId, outcome.status);
      return { sent: true };
    } catch (error) {
      // A switched-off module is a presence answer about the whole operation,
      // not a message that failed to render; absorbing it would report "sent
      // nothing" where the truthful answer is "this capability is off".
      rethrowIfModuleDisabled(error);
      // Everything else is contained: the shipment exists and must not be
      // undone because the message did not go out. It is named, though.
      return this.notSent(orderId, shipmentId, 'failed', error);
    }
  }

  private notSent(
    orderId: string,
    shipmentId: string,
    reason: ShipmentEmailNotSentReason,
    error?: unknown,
  ): ShipmentEmailResult {
    this.log('[shipments] the shipment-created e-mail was not sent', {
      orderId,
      shipmentId,
      reason,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : error }),
    });
    return { sent: false, reason };
  }
}
