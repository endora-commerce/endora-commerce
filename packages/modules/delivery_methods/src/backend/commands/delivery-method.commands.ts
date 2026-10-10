import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type DeliveryMethodUpsert } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { DeliveryMethod } from '../entities/delivery-method.entity.js';

/**
 * Delivery-method configuration as Commands — issue #125, Principle XIII.
 *
 * The mirror image of `payment_methods/commands/payment-method.commands.ts`,
 * and deliberately so: the two surfaces are the same shape, an operator edits
 * them from the same screen family, and a reviewer who has read one should not
 * have to re-derive the other. What a shop charges for shipping, and which order
 * status a delivery result moves an order to, is operator configuration with
 * money behind it — so it runs on the bus rather than auditing by hand.
 *
 * **Not `reversible`**, for the reason the payment twin gives: `reversible`
 * marks the commands wired into feature 054's stored-revert undo, and a single
 * configuration row has no such surface. The audit row's `stateBefore` is what
 * an operator restores from, by re-sending it.
 */

/** The audit projection of a delivery method — configuration only. */
export function deliveryMethodAuditState(row: DeliveryMethod): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    cost: row.cost,
    currency: row.currency,
    adapter: row.adapter,
    status: row.status,
    statusOnSuccess: row.statusOnSuccess,
    statusOnFailure: row.statusOnFailure,
  };
}

export interface UpsertDeliveryMethodInput {
  readonly code: string;
  readonly body: DeliveryMethodUpsert;
  /**
   * The id of the row carrying this code when the caller looked, or `null` for a
   * creation — see the payment twin: it fixes the action name and the audited
   * object id, so the transaction refuses a row that appeared in between.
   */
  readonly existingId: string | null;
}

export interface UpsertDeliveryMethodResult {
  readonly method: DeliveryMethod;
  /** True when the transaction created the row — the caller binds a new method to a channel. */
  readonly created: boolean;
}

export function makeUpsertDeliveryMethodCommand(
  input: UpsertDeliveryMethodInput,
  countShipmentsForMethod: ShipmentUsageCounter,
): Command<UpsertDeliveryMethodResult> {
  const { body } = input;
  const id = input.existingId ?? randomUUID();
  return {
    action: input.existingId === null ? 'delivery_method.create' : 'delivery_method.update',
    objectType: 'delivery_method',
    objectId: id,
    run: async ({ em }) => {
      let row = await em.findOne(DeliveryMethod, { code: input.code });
      if (row !== null && input.existingId === null) {
        throw new HttpError(
          409,
          ERROR_CODES.VERSION_CONFLICT,
          `Delivery method "${input.code}" was created by someone else. Reload and try again.`,
        );
      }
      const before = row === null ? null : deliveryMethodAuditState(row);

      // The adapter is set at registration time and rarely changed; preserve an
      // existing row's adapter unless the body explicitly overrides it. A new
      // row defaults its adapter to the code. Resolved here rather than in the
      // caller so it reads the row the transaction sees.
      const adapter = body.adapter ?? row?.adapter ?? input.code;

      // Rebinding a method that shipments already reference is refused. A
      // `Shipment` records its delivery method and not the adapter that opened
      // it, so every later read of "which carrier is this parcel with" goes
      // through this column: the `providerDetails` envelope is opaque to
      // everyone but the adapter that wrote it, a retry of a failed attempt
      // fires `onShipmentCreated` on whatever the method names *now*, and the
      // `shipment.received.v1` / `shipment.failed.v1` events report it too. A
      // rebind would hand one carrier's parcels to another. The operator's way
      // out loses nothing: set this method inactive and create one for the
      // other adapter. An unchanged adapter asks `shipments` nothing, so an
      // ordinary edit costs no cross-module read.
      if (row !== null && adapter !== row.adapter) {
        const referencing = await countShipmentsForMethod(row.id, 'change-adapter');
        if (referencing > 0) {
          throw new HttpError(
            409,
            ERROR_CODES.VALIDATION_FAILED,
            `Cannot change the adapter of delivery method "${row.code}": ${referencing} ` +
              `shipment(s) were created against it through "${row.adapter}". Set its status to ` +
              '"inactive" and create a new method for the other adapter instead.',
          );
        }
      }

      if (row) {
        row.name = body.name;
        row.cost = body.cost.toFixed(2);
        row.currency = body.currency;
        row.adapter = adapter;
        if (body.status !== undefined) row.status = body.status;
        if (body.statusOnSuccess !== undefined) row.statusOnSuccess = body.statusOnSuccess;
        if (body.statusOnFailure !== undefined) row.statusOnFailure = body.statusOnFailure;
      } else {
        row = em.create(DeliveryMethod, {
          id,
          code: input.code,
          name: body.name,
          cost: body.cost.toFixed(2),
          currency: body.currency,
          adapter,
          status: body.status ?? 'active',
          statusOnSuccess: body.statusOnSuccess ?? 'shipment_sent',
          statusOnFailure: body.statusOnFailure ?? 'processing',
        });
        em.persist(row);
      }
      await em.flush();

      return {
        result: { method: row, created: before === null },
        before,
        after: deliveryMethodAuditState(row),
      };
    },
  };
}

/**
 * How many shipments reference a delivery method — supplied by the caller
 * because the rows belong to `shipments` (feature 075, the `delivery_methods`
 * shard).
 *
 * This used to be a `select count(*) from "shipments"` written here, on the
 * Command's own transaction. The comment above it said that made the guard and
 * the delete "the same moment", and the claim did not survive being looked at:
 * neither statement takes a lock, so a shipment created between the count and
 * the commit was always possible. What the statement really was is a read of
 * another module's table that named no import specifier, and so crossed the
 * boundary invisibly until D-87 gave `check:module-boundary` a second
 * predicate.
 *
 * The owner answers on its own `EntityManager`, outside this transaction. That
 * costs nothing here: `shipments` is a table this transaction never writes, so
 * there is no write of its own for the read to be blind to.
 *
 * @see `services/shipment-usage-guard.ts` for what happens when `shipments` is
 *      switched off — the answer is a refusal, and it is the caller's to make
 *      before it resolves anything.
 */
export type ShipmentUsageCounter = (
  deliveryMethodId: string,
  /** Which write is asking — it only selects the refusal's wording. Defaults to `'delete'`. */
  intent?: ShipmentUsageIntent,
) => Promise<number>;

/** The two writes the count guards: removing a method, and rebinding its adapter. */
export type ShipmentUsageIntent = 'delete' | 'change-adapter';

export function makeDeleteDeliveryMethodCommand(
  id: string,
  countShipmentsForMethod: ShipmentUsageCounter,
): Command<void> {
  return {
    action: 'delivery_method.delete',
    objectType: 'delivery_method',
    objectId: id,
    run: async ({ em }) => {
      const row = await em.findOne(DeliveryMethod, { id });
      if (!row) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Delivery method not found.');
      }
      const referencing = await countShipmentsForMethod(row.id);
      if (referencing > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `Cannot delete delivery method: ${referencing} shipment(s) reference it. Set status to "inactive" instead.`,
        );
      }
      const before = deliveryMethodAuditState(row);
      await em.removeAndFlush(row);
      return { result: undefined, before, after: null };
    },
  };
}

/**
 * Takes back a delivery method **this request created**, when the step after the
 * creation failed — the channel assignment, which the sales-channel bridge
 * writes on a transaction of its own.
 *
 * Not {@link makeDeleteDeliveryMethodCommand}, and the difference is the point.
 * That Command asks `shipments` whether anything references the method, and
 * refuses when `shipments` is switched off because nobody can answer. For an
 * operator's delete that refusal is right. For a row created a moment ago, in
 * the same request, the question has an answer nobody needs to be asked: no
 * shipment can reference a method that did not exist before this request. Going
 * through the guard here would turn "`shipments` is off" into "the take-back
 * is refused" — and leave a new method active and bound to no channel, which
 * for this entity type means offered on every one.
 *
 * It is still an audited delete, under the delete action, so the trail reads
 * create then delete and says who.
 */
export function makeWithdrawCreatedDeliveryMethodCommand(id: string): Command<void> {
  return {
    action: 'delivery_method.delete',
    objectType: 'delivery_method',
    objectId: id,
    run: async ({ em }) => {
      const row = await em.findOne(DeliveryMethod, { id });
      // Already gone: there is nothing left to take back, and nothing to audit.
      if (!row) return { result: undefined, skipAudit: true };
      const before = deliveryMethodAuditState(row);
      await em.removeAndFlush(row);
      return { result: undefined, before, after: null };
    },
  };
}

/**
 * The fallback when even {@link makeWithdrawCreatedDeliveryMethodCommand} fails:
 * the method this request created is set **inactive**.
 *
 * A row that could be neither assigned nor removed must not stay active with no
 * channel membership, because that is "offered on every channel". Inactive is
 * the one state reachable with a single column write in which the worst outcome
 * is "not offered" — and an operator who finds it sees a method to finish or
 * delete, not one already on sale where nobody put it.
 */
export function makeDeactivateCreatedDeliveryMethodCommand(id: string): Command<void> {
  return {
    action: 'delivery_method.update',
    objectType: 'delivery_method',
    objectId: id,
    run: async ({ em }) => {
      const row = await em.findOne(DeliveryMethod, { id });
      if (!row || row.status === 'inactive') return { result: undefined, skipAudit: true };
      const before = deliveryMethodAuditState(row);
      row.status = 'inactive';
      await em.flush();
      return { result: undefined, before, after: deliveryMethodAuditState(row) };
    },
  };
}
