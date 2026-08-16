import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type DeliveryMethodUpsert } from '@b2b/contracts';
import type { Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
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
 * Delete-guard (FR-003): never orphan a Shipment's method reference. Counted on
 * the Command's own transaction, so the guard and the delete answer the same
 * moment.
 */
async function countShipmentsForMethod(em: EntityManager, methodId: string): Promise<number> {
  const rows = await em
    .getConnection()
    .execute<Array<{ count: string }>>(
      `select count(*)::text as count from "shipments" where "delivery_method_id" = ?`,
      [methodId],
      'all',
      em.getTransactionContext(),
    );
  return Number(rows[0]?.count ?? '0');
}

export function makeDeleteDeliveryMethodCommand(id: string): Command<void> {
  return {
    action: 'delivery_method.delete',
    objectType: 'delivery_method',
    objectId: id,
    run: async ({ em }) => {
      const row = await em.findOne(DeliveryMethod, { id });
      if (!row) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Delivery method not found.');
      }
      const referencing = await countShipmentsForMethod(em, row.id);
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
