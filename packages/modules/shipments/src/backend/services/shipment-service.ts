import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type {
  DeliveryMethodReadPort,
  OrderReadPort,
  ShippingAdapterRegistryPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { Shipment } from '../entities/shipment.entity.js';
import type { ShippingEventBus } from './events.js';

/**
 * What a `pending_manual` shipment says about itself, in one place so the row,
 * the audit entry and the tests cannot drift apart (issue #250).
 *
 * English and persisted, like the payment side's refund reasons: this is the
 * record of what happened, not a rendered string. The admin translates the
 * *state* and shows this sentence as the detail that names the module — which
 * is the one thing the operator needs and no translation can supply.
 */
export function carrierNotContactedReason(moduleId: string): string {
  return (
    `The "${moduleId}" module is not switched on here, so the carrier was never ` +
    `asked to create this shipment. Switch the module back on and generate the ` +
    `shipment again.`
  );
}

/**
 * ShipmentService (feature 035, FR-021/FR-024).
 *
 * `createShipment` raises `shipment_created`: it opens a pending Shipment
 * against the Order, invokes the method adapter's `onShipmentCreated`, and
 * emits `shipment.created.v1`. It is also the retry path (FR-024): called again
 * after a failure it appends attempt n+1 and leaves the prior rows intact,
 * refusing only once an attempt has succeeded. `listForOrder` powers the admin
 * view.
 *
 * Issue #257 — there used to be a second attempt-opening path, `openRetry`, and
 * it asked no adapter in any state, not only while a carrier module was off. It
 * is gone rather than repaired: no admin surface reached it, its own contract
 * described it as "equivalent to calling the generate route again", and the
 * equivalence was false in the one way that mattered — the row appeared, the
 * status read `pending`, and no carrier had heard of the parcel. Repairing it
 * would have left a second copy of `createShipment` to keep honest forever;
 * deleting it leaves one path, which is the one every caller already used.
 *
 * Feature 075 Phase C — the order and the delivery method are read over their
 * owners' ports. Only the `Shipment` rows are this module's to write, and only
 * those stay inside the transaction: the two reads are of rows nothing in this
 * operation modifies, so moving them onto the owner's `EntityManager` costs no
 * consistency. Both fail closed when their owner is off, which is right — a
 * shipment opened against an order the platform will not read is a parcel with
 * no addressee.
 *
 * Issue #250 — the adapter registry is a contribution point, so an adapter
 * whose owner is switched off is filtered out at enumeration rather than
 * throwing (D-39). That gate is right; what used to follow it was not. The
 * hook was skipped and the row was still written `pending`, so a shipment with
 * no label, no tracking number and no carrier that knew about it read exactly
 * like one the carrier had accepted. It now opens `pending_manual` — the state
 * the platform already uses on the payment side for "the money did not move,
 * a person has to finish this" — with the module named in `failureReason` and
 * an audit row recording the attempt.
 */
export class ShipmentService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly registry: ShippingAdapterRegistryPort,
    private readonly orderRead: OrderReadPort,
    private readonly deliveryMethodRead: DeliveryMethodReadPort,
    private readonly auditLog: AuditPort,
    private readonly events?: ShippingEventBus,
  ) {}

  async createShipment(orderId: string): Promise<Shipment> {
    // command-coverage-ignore: creates a pending shipment attempt + invokes the
    // delivery adapter; fulfilment mechanics — the order "shipped" transition is
    // audited in the orders flow.
    const run = async (): Promise<{ shipment: Shipment; adapterKey: string }> => {
      const em = this.emFactory();
      return em.transactional(async (tx) => {
        const order = await this.orderRead.findById(orderId);
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

        const method = await this.deliveryMethodRead.findById(order.deliveryMethodId);
        const adapterKey = method?.adapter ?? order.deliveryMethodId;

        const adapter = this.registry.get(adapterKey);
        // Told apart deliberately: an adapter nobody ever contributed is an
        // offline method that has always been finished by hand, and it keeps
        // opening `pending`. Only a contributed adapter whose module is absent
        // produces `pending_manual` — because only that one names a module an
        // operator can switch back on.
        const absentCarrierModule = adapter ? null : this.registry.absentOwnerFor(adapterKey);

        const shipment = tx.create(Shipment, {
          orderId,
          deliveryMethodId: order.deliveryMethodId,
          status: absentCarrierModule ? 'pending_manual' : 'pending',
          ...(absentCarrierModule
            ? { failureReason: carrierNotContactedReason(absentCarrierModule) }
            : {}),
          attemptNo: (latest?.attemptNo ?? 0) + 1,
        });
        await tx.persistAndFlush(shipment);

        // Invoke the adapter's shipment_created hook. The returned next-action
        // is informational; the Shipment stays pending until receive_shipment.
        if (adapter) {
          await adapter.onShipmentCreated({
            orderId,
            shipmentId: shipment.id,
            deliveryMethodId: order.deliveryMethodId,
            attemptNo: shipment.attemptNo,
          });
        } else if (absentCarrierModule) {
          // Co-transactional with the row it describes (Principle XIII): the
          // shipment and the record of why it is unfinished commit together or
          // not at all. `recordAuditFromContext` rather than the Command Bus
          // for the reason its own docblock gives — this write already owns a
          // transaction the bus would have to fork out of.
          recordAuditFromContext(this.auditLog, tx, {
            action: 'shipment.carrier_not_contacted',
            objectType: 'shipment',
            objectId: shipment.id,
            stateAfter: {
              orderId,
              adapter: adapterKey,
              absentModule: absentCarrierModule,
              attemptNo: shipment.attemptNo,
              status: shipment.status,
            },
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
            status: shipment.status,
          });
        }
        return { shipment, adapterKey };
      });
    };

    const result = this.events ? await this.events.run(run) : await run();
    return result.shipment;
  }

  /**
   * The order's shipment attempts — for the admin panel.
   *
   * The `orderRead` call is the tenant boundary, not a convenience: `Shipment`
   * is `@GlobalEntity`, so `em.find(Shipment, { orderId })` carries no filter
   * and answers for every order on the platform, while `Order` is `@OrgScoped`
   * and this port reads it through a filtered EntityManager. An
   * assignment-scoped administrator therefore gets `null` here and no tracking
   * number from an organization they are not assigned to.
   *
   * `createShipment` above has always made this read for its own reasons and so
   * was never exposed; this one had no reason to make it, which is exactly how
   * the gap arrived. 404 rather than 403 — an out-of-scope order must read the
   * same as one that is not there.
   */
  async listForOrder(orderId: string): Promise<Shipment[]> {
    const order = await this.orderRead.findById(orderId);
    if (!order) {
      throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
    }
    const em = this.emFactory();
    return em.find(Shipment, { orderId }, { orderBy: { attemptNo: 'asc' } });
  }
}
