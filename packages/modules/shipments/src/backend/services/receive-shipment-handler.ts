import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type ReceiveShipment } from '@endora-commerce/contracts';
import type {
  DeliveryMethodReadPort,
  OrderTransitionOutcome,
  OrderTransitionPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Shipment } from '../entities/shipment.entity.js';
import type { ShippingEventBus } from './events.js';

export interface ReceiveShipmentResult {
  shipmentId: string;
  status: Shipment['status'];
  /**
   * Where the order stands once the ingress is done with it, which since
   * feature 085 Phase D is the lifecycle's answer rather than this handler's:
   * the target the method configured when the graph permitted it, the order's
   * unchanged status when it did not, and `null` when the ingress asked for no
   * move at all (a repeated callback, or a method with no status configured).
   */
  orderStatus: string | null;
  idempotent: boolean;
}

/**
 * The one message this handler logs, as little of a logger as it needs.
 *
 * `ctx.log` satisfies it structurally, so `shipments/backend.ts` passes the
 * module's own logger and a test passes a recorder. `payments` declares the
 * same shape at its twin seam; neither module imports the other's.
 */
export interface CarrierCallbackLogger {
  warn(details: object, message: string): void;
}

/** Which configured setting asked for a transition, for the refusal log. */
type StatusSetting = 'status_on_success' | 'status_on_failure';

/**
 * ReceiveShipmentHandler (feature 035, FR-022/FR-023/FR-025).
 *
 * Resolves a Shipment from the ingress payload, applies the outcome, and asks
 * the order lifecycle for the move the method's `statusOnSuccess` /
 * `statusOnFailure` names. Idempotent: a success after a terminal `success` is
 * a no-op; a failure after `success` is rejected (no downgrade). Resolves a
 * late event even when the adapter has since been de-registered (it keys on the
 * persisted Shipment, not the live registry).
 *
 * **The lifecycle answers; this handler does not decide** (feature 085 Phase
 * D). It used to assign `order.status` after asking an `OrderStatusRegistry`
 * whether the code existed, which is a different question from whether the
 * order may go there — so a carrier callback wrote transitions the configured
 * graph forbids while an operator making the same move by hand was refused, and
 * the change was audited nowhere. The order row is no longer read here at all:
 * the port carries the move, the audit entry, the side-effects and the
 * templated `order.status.*.after` announcement.
 */
export class ReceiveShipmentHandler {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly deliveryMethodRead: DeliveryMethodReadPort,
    /**
     * The lifecycle write (feature 085 Phase D), **called after this handler's
     * transaction has committed** and never inside it: the port takes its own
     * `EntityManager`, so a call from inside would write the order on a
     * different pooled connection whose commit the enclosing rollback cannot
     * reach (issue #200). A crash in between leaves the shipment recorded and
     * the order unmoved, which an operator can see and repeat.
     */
    private readonly orderTransition: OrderTransitionPort,
    /** Where a refused transition is recorded; see {@link CarrierCallbackLogger}. */
    private readonly log: CarrierCallbackLogger,
    private readonly events?: ShippingEventBus,
  ) {}

  async receive(input: ReceiveShipment): Promise<ReceiveShipmentResult> {
    // command-coverage-ignore: provider shipment-event ingestion — stamps the
    // attempt result on the Shipment row, then asks `orderTransitionPort` for
    // the lifecycle move, which records the `order.status_transition` audit
    // entry co-transactionally with the status write it performs. The reason on
    // this marker used to claim that audit while the handler assigned
    // `order.status` itself and reached the orders flow at no point (feature
    // 085, R3); Phase D made the claim true.
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
        return {
          shipment,
          idempotent: true,
          emit: false,
          transition: null as { to: string; setting: StatusSetting } | null,
        };
      }

      const method = await this.deliveryMethodRead.findById(shipment.deliveryMethodId);
      let transition: { to: string; setting: StatusSetting } | null = null;

      if (input.outcome === 'success') {
        shipment.status = 'success';
        if (input.externalReference !== undefined) {
          shipment.externalReference = input.externalReference ?? null;
        }
        if (input.providerDetails) shipment.providerDetails = input.providerDetails;
        if (method?.statusOnSuccess) {
          transition = { to: method.statusOnSuccess, setting: 'status_on_success' };
        }
      } else {
        shipment.status = 'failure';
        shipment.failureReason = input.failureReason ?? null;
        if (input.providerDetails) shipment.providerDetails = input.providerDetails;
        if (method?.statusOnFailure) {
          transition = { to: method.statusOnFailure, setting: 'status_on_failure' };
        }
      }

      await tx.flush();
      return {
        shipment,
        idempotent: false,
        emit: true,
        adapter: method?.adapter ?? shipment.deliveryMethodId,
        transition,
      };
    });

    /**
     * After the commit, never inside the transaction above (feature 085 R4).
     *
     * The transaction holds the shipment row alone now. It used to hold the
     * order's status with it, which was the ground D-90 gave for importing the
     * `Order` entity here; the lifecycle move is a graph decision with guards
     * and side-effects rather than a column, so it goes through the port and
     * the entity import goes with it.
     */
    const orderStatus = result.transition
      ? await this.moveOrder(
          result.shipment.orderId,
          result.transition.to,
          result.transition.setting,
          input.outcome === 'failure' ? (input.failureReason ?? null) : null,
        )
      : null;

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

      // The templated `order.status.*.after` events (feature 038, T026) are no
      // longer emitted from here: `OrderTransitionService` emits them itself,
      // for the transition it applied, with the same actor. Announcing again
      // would double every subscriber's reaction to one carrier callback.
    }

    return {
      shipmentId: result.shipment.id,
      status: result.shipment.status,
      orderStatus,
      idempotent: result.idempotent,
    };
  }

  /**
   * Ask the lifecycle for the move the configured setting names, and answer
   * where the order ended up.
   *
   * Every refusal is a 200 for the carrier (contract §"What the caller does
   * with each outcome"): a provider retries a non-2xx callback, and an order
   * further along than the configured target must not be dragged backwards
   * because a delivery attempt failed. So the refusal is recorded here and the
   * shipment row stands.
   *
   * There is deliberately no `catch`. A `ModuleDisabledError` out of the port's
   * gate is not a refusal — it is the owner being absent — and swallowing it
   * would turn fail-closed into fail-open.
   */
  private async moveOrder(
    orderId: string,
    to: string,
    setting: StatusSetting,
    reason: string | null,
  ): Promise<string | null> {
    const outcome: OrderTransitionOutcome = await this.orderTransition.applyStatus({
      orderId,
      to,
      actor: { kind: 'system', source: 'shipment' },
      reason,
    });

    if (outcome.applied) return outcome.to;
    if (outcome.reason === 'already_there') return outcome.from;

    this.log.warn(
      {
        orderId,
        from: outcome.from,
        to,
        setting,
        refusal: outcome.reason,
        detail: outcome.detail,
      },
      'shipments: the requested order status was not applied; the order keeps the one it has',
    );
    return outcome.from;
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
}
