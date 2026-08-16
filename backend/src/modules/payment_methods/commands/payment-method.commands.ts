import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type PaymentMethodUpsert } from '@b2b/contracts';
import type { Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { PaymentMethod } from '../entities/payment-method.entity.js';

/**
 * Payment-method configuration as Commands — issue #125, Principle XIII.
 *
 * Issue #122 gave these three writes an audit row through
 * `recordAuditFromContext`, which is the lighter of the two sanctioned forms:
 * the row lands, but the write never enters `CommandBus.run`, so it carries no
 * command envelope and there is nowhere for an undo to attach. Which methods a
 * shop offers, what each of them costs a buyer, and which order status a payment
 * result moves an order to is exactly the configuration an operator wants back
 * after a mis-edit, so the write belongs on the bus.
 *
 * **None of the three is `reversible`.** That flag marks the commands wired into
 * feature 054's stored-revert undo (a `RevertRecord` set on a bulk-operation
 * row), and these have no such surface — as `sales_channel.set_default` says for
 * the same reason. The inverse of an edit is the same PUT carrying the previous
 * values, which the audit row's `stateBefore` holds in full; the inverse of a
 * delete is a create, and a delete is refused outright while any payment still
 * references the method.
 */

/** The audit projection of a payment method — configuration only, no secrets. */
export function paymentMethodAuditState(row: PaymentMethod): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    adapter: row.adapter,
    status: row.status,
    additionalPrice: row.additionalPrice,
    statusOnPending: row.statusOnPending,
    statusOnSuccess: row.statusOnSuccess,
    statusOnFailure: row.statusOnFailure,
  };
}

export interface UpsertPaymentMethodInput {
  readonly code: string;
  readonly body: PaymentMethodUpsert;
  /** Resolved by the caller from `body.adapter ?? body.kind`, and validated there. */
  readonly adapter: string;
  /**
   * The id of the row carrying this code when the caller looked, or `null` for a
   * creation. It decides the action name and the audited object id, both of
   * which a Command fixes before it runs — so the transaction below refuses the
   * one case that would make them wrong: a row that appeared in between.
   */
  readonly existingId: string | null;
}

export interface UpsertPaymentMethodResult {
  readonly method: PaymentMethod;
  /** True when the transaction created the row — the caller binds a new method to a channel. */
  readonly created: boolean;
}

export function makeUpsertPaymentMethodCommand(
  input: UpsertPaymentMethodInput,
): Command<UpsertPaymentMethodResult> {
  const { body } = input;
  const id = input.existingId ?? randomUUID();
  return {
    action: input.existingId === null ? 'payment_method.create' : 'payment_method.update',
    objectType: 'payment_method',
    objectId: id,
    run: async ({ em }) => {
      let row = await em.findOne(PaymentMethod, { code: input.code });
      if (row !== null && input.existingId === null) {
        throw new HttpError(
          409,
          ERROR_CODES.VERSION_CONFLICT,
          `Payment method "${input.code}" was created by someone else. Reload and try again.`,
        );
      }
      const before = row === null ? null : paymentMethodAuditState(row);

      if (row) {
        row.name = body.name;
        row.kind = body.kind;
        row.adapter = input.adapter;
        if (body.status !== undefined) row.status = body.status;
        if (body.additionalPrice !== undefined) row.additionalPrice = body.additionalPrice.toFixed(2);
        if (body.statusOnPending !== undefined) row.statusOnPending = body.statusOnPending;
        if (body.statusOnSuccess !== undefined) row.statusOnSuccess = body.statusOnSuccess;
        if (body.statusOnFailure !== undefined) row.statusOnFailure = body.statusOnFailure;
      } else {
        row = em.create(PaymentMethod, {
          id,
          code: input.code,
          name: body.name,
          kind: body.kind,
          adapter: input.adapter,
          status: body.status ?? 'active',
          additionalPrice: (body.additionalPrice ?? 0).toFixed(2),
          statusOnPending: body.statusOnPending ?? 'new',
          statusOnSuccess: body.statusOnSuccess ?? 'paid',
          statusOnFailure: body.statusOnFailure ?? 'cancelled',
        });
        em.persist(row);
      }
      await em.flush();

      return {
        result: { method: row, created: before === null },
        before,
        after: paymentMethodAuditState(row),
      };
    },
  };
}

/**
 * Delete-guard (feature 034, FR-003): never orphan a Payment's method reference.
 * Counted on the Command's own transaction, so the guard and the delete answer
 * the same moment.
 */
async function countPaymentsForMethod(em: EntityManager, methodId: string): Promise<number> {
  const rows = await em
    .getConnection()
    .execute<Array<{ count: string }>>(
      `select count(*)::text as count from "payments" where "payment_method_id" = ?`,
      [methodId],
      'all',
      em.getTransactionContext(),
    );
  return Number(rows[0]?.count ?? '0');
}

export function makeDeletePaymentMethodCommand(id: string): Command<void> {
  return {
    action: 'payment_method.delete',
    objectType: 'payment_method',
    objectId: id,
    run: async ({ em }) => {
      const row = await em.findOne(PaymentMethod, { id });
      if (!row) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Payment method not found.');
      }
      const referencing = await countPaymentsForMethod(em, row.id);
      if (referencing > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `Cannot delete payment method: ${referencing} payment(s) reference it. Set status to "inactive" instead.`,
        );
      }
      const before = paymentMethodAuditState(row);
      await em.removeAndFlush(row);
      return { result: undefined, before, after: null };
    },
  };
}
