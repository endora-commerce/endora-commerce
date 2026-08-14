import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Shipment } from '../entities/shipment.entity.js';
import { Order } from '../../orders/entities/order.entity.js';
import { DeliveryMethod } from '../../delivery_methods/entities/delivery-method.entity.js';
import type { ShippingAdapterRegistry } from '../../delivery_methods/services/shipping-adapter-registry.js';
import type { ShippingEventBus } from './events.js';

/**
 * ShipmentService (feature 035, FR-021/FR-024).
 *
 * `createShipment` raises `shipment_created`: it opens a pending Shipment
 * against the Order, invokes the method adapter's `onShipmentCreated`, and
 * emits `shipment.created.v1`. `openRetry` opens an additional attempt after a
 * failure (leaving prior rows intact). `listForOrder` powers the admin view.
 */
export class ShipmentService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly registry: ShippingAdapterRegistry,
    private readonly events?: ShippingEventBus,
  ) {}

  async createShipment(orderId: string): Promise<Shipment> {
    // command-coverage-ignore: creates a pending shipment attempt + invokes the
    // delivery adapter; fulfilment mechanics — the order "shipped" transition is
    // audited in the orders flow.
    const run = async (): Promise<{ shipment: Shipment; adapterKey: string }> => {
      const em = this.emFactory();
      return em.transactional(async (tx) => {
        const order = await tx.findOne(Order, { id: orderId });
        if (!order) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
        }
        const latest = await tx.findOne(
          Shipment,
          { orderId },
          { orderBy: { attemptNo: 'desc' } },
        );
        if (latest && latest.status === 'success') {
          throw new HttpError(
            409,
            ERROR_CODES.VALIDATION_FAILED,
            'Order already has a successful shipment; nothing to generate.',
          );
        }

        const method = await tx.findOne(DeliveryMethod, { id: order.deliveryMethodId });
        const adapterKey = method?.adapter ?? order.deliveryMethodId;

        const shipment = tx.create(Shipment, {
          orderId,
          deliveryMethodId: order.deliveryMethodId,
          status: 'pending',
          attemptNo: (latest?.attemptNo ?? 0) + 1,
        });
        await tx.persistAndFlush(shipment);

        // Invoke the adapter's shipment_created hook. The returned next-action
        // is informational; the Shipment stays pending until receive_shipment.
        const adapter = this.registry.get(adapterKey);
        if (adapter) {
          await adapter.onShipmentCreated({
            orderId,
            shipmentId: shipment.id,
            deliveryMethodId: order.deliveryMethodId,
            attemptNo: shipment.attemptNo,
          });
        }

        if (this.events) {
          this.events.emit('shipment.created.v1', {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            orderId,
            shipmentId: shipment.id,
            deliveryMethodId: order.deliveryMethodId,
            adapter: adapterKey,
            attemptNo: shipment.attemptNo,
          });
        }
        return { shipment, adapterKey };
      });
    };

    const result = this.events ? await this.events.run(run) : await run();
    return result.shipment;
  }

  async openRetry(orderId: string): Promise<Shipment> {
    // command-coverage-ignore: opens a new shipment attempt after a failure —
    // fulfilment retry mechanics; the order transition is audited in the orders flow.
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const latest = await tx.findOne(Shipment, { orderId }, { orderBy: { attemptNo: 'desc' } });
      if (!latest) {
        throw new HttpError(
          404,
          ERROR_CODES.NOT_FOUND,
          'No shipment exists for this order to retry.',
        );
      }
      if (latest.status === 'success') {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          'Order already has a successful shipment; nothing to retry.',
        );
      }
      const next = tx.create(Shipment, {
        orderId,
        deliveryMethodId: latest.deliveryMethodId,
        status: 'pending',
        attemptNo: latest.attemptNo + 1,
      });
      await tx.persistAndFlush(next);
      return next;
    });
  }

  async listForOrder(orderId: string): Promise<Shipment[]> {
    const em = this.emFactory();
    return em.find(Shipment, { orderId }, { orderBy: { attemptNo: 'asc' } });
  }
}
