import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type ReceiveShipment } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Shipment } from '../entities/shipment.entity.js';
import { Order } from '../../orders/entities/order.entity.js';
import { DeliveryMethod } from '../../delivery_methods/entities/delivery-method.entity.js';
import type { OrderStatusRegistry } from '../../delivery_methods/services/order-status-registry.port.js';
import { emitOrderStatusAfter } from '../../orders/events/order-status-events.js';
import type { EventBus } from '../../../events/bus.js';
import type { ShippingEventBus } from './events.js';

export interface ReceiveShipmentResult {
  shipmentId: string;
  status: Shipment['status'];
  orderStatus: string | null;
  idempotent: boolean;
}

/**
 * ReceiveShipmentHandler (feature 035, FR-022/FR-023/FR-025).
 *
 * Resolves a Shipment from the ingress payload, applies the outcome, and maps
 * the order status through the method's statusOnSuccess / statusOnFailure via
 * the OrderStatusRegistry. Idempotent: a success after a terminal `success` is
 * a no-op; a failure after `success` is rejected (no downgrade). Resolves a
 * late event even when the adapter has since been de-registered (it keys on the
 * persisted Shipment, not the live registry).
 */
export class ReceiveShipmentHandler {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly orderStatusRegistry?: OrderStatusRegistry,
    private readonly events?: ShippingEventBus,
  ) {}

  async receive(input: ReceiveShipment): Promise<ReceiveShipmentResult> {
    // command-coverage-ignore: provider shipment-event ingestion — stamps the
    // attempt result and drives the order transition (audited in the orders flow).
    const em = this.emFactory();
    const result = await em.transactional(async (tx) => {
      const shipment = await this.resolveShipment(tx, input);
      if (!shipment) {
        throw new HttpError(
          404,
          ERROR_CODES.NOT_FOUND,
          'Shipment not found for the given reference.',
        );
      }

      // Idempotency / terminal-state guards (FR-025).
      if (shipment.status === 'success') {
        if (input.outcome === 'failure') {
          throw new HttpError(
            409,
            ERROR_CODES.VALIDATION_FAILED,
            'Shipment is already generated; it cannot be marked failed.',
          );
        }
        return { shipment, orderStatus: null as string | null, idempotent: true, emit: false };
      }

      const order = await tx.findOne(Order, { id: shipment.orderId });
      const method = await tx.findOne(DeliveryMethod, { id: shipment.deliveryMethodId });
      const orderStatusBefore = order?.status ?? null;

      if (input.outcome === 'success') {
        shipment.status = 'success';
        if (input.externalReference !== undefined) {
          shipment.externalReference = input.externalReference ?? null;
        }
        if (input.providerDetails) shipment.providerDetails = input.providerDetails;
        if (order) this.applyOrderStatus(order, method?.statusOnSuccess);
      } else {
        shipment.status = 'failure';
        shipment.failureReason = input.failureReason ?? null;
        if (input.providerDetails) shipment.providerDetails = input.providerDetails;
        if (order) this.applyOrderStatus(order, method?.statusOnFailure);
      }

      await tx.flush();
      return {
        shipment,
        orderStatus: order?.status ?? null,
        idempotent: false,
        emit: true,
        adapter: method?.adapter ?? shipment.deliveryMethodId,
        orderStatusBefore,
        orderStatusAfter: order?.status ?? null,
        organizationId: order?.organizationId ?? null,
        salesChannelId: order?.salesChannelId ?? null,
      };
    });

    if (result.emit && this.events) {
      const base = { eventId: randomUUID(), occurredAt: new Date().toISOString() };
      if (result.shipment.status === 'success') {
        this.events.emit('shipment.received.v1', {
          ...base,
          orderId: result.shipment.orderId,
          shipmentId: result.shipment.id,
          adapter: (result as { adapter?: string }).adapter ?? '',
          externalReference: result.shipment.externalReference ?? null,
          attemptNo: result.shipment.attemptNo,
        });
      } else {
        this.events.emit('shipment.failed.v1', {
          ...base,
          orderId: result.shipment.orderId,
          shipmentId: result.shipment.id,
          adapter: (result as { adapter?: string }).adapter ?? '',
          failureReason: result.shipment.failureReason ?? null,
          attemptNo: result.shipment.attemptNo,
        });
      }

      // Feature 038 (T026) — emit the templated order status `.after` events for
      // the system-driven (shipment) transition. Authoritative (no graph/veto).
      const r = result as {
        orderStatusBefore: string | null;
        orderStatusAfter: string | null;
        organizationId: string | null;
        salesChannelId: string | null;
      };
      if (r.orderStatusBefore && r.orderStatusAfter && r.organizationId && r.salesChannelId) {
        emitOrderStatusAfter(this.events as unknown as EventBus, {
          orderId: result.shipment.orderId,
          organizationId: r.organizationId,
          salesChannelId: r.salesChannelId,
          from: r.orderStatusBefore,
          to: r.orderStatusAfter,
          actor: { kind: 'system', source: 'shipment' },
        });
      }
    }

    return {
      shipmentId: result.shipment.id,
      status: result.shipment.status,
      orderStatus: result.orderStatus,
      idempotent: result.idempotent,
    };
  }

  private async resolveShipment(
    tx: EntityManager,
    input: ReceiveShipment,
  ): Promise<Shipment | null> {
    if (input.shipmentId) {
      return tx.findOne(Shipment, { id: input.shipmentId });
    }
    if (input.orderId && input.externalReference) {
      const byRef = await tx.findOne(Shipment, {
        orderId: input.orderId,
        externalReference: input.externalReference,
      });
      if (byRef) return byRef;
      // Fall back to the most recent open attempt for the order.
      return tx.findOne(Shipment, { orderId: input.orderId }, { orderBy: { attemptNo: 'desc' } });
    }
    return null;
  }

  private applyOrderStatus(order: Order, ref: string | undefined): void {
    if (!ref) return;
    if (this.orderStatusRegistry && !this.orderStatusRegistry.has(ref)) return;
    order.status = ref as Order['status'];
  }
}
