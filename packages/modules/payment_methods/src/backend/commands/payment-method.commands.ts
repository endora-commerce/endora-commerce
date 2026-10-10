import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  type PaymentMethodUpsert,
  type PaymentReadPort,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
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
          // Feature 085 (FR-003) — a declined payment holds the order, it does
          // not end it. `on_hold` is a system status: it is reachable from every
          // non-terminal status and reaches every status, and an operator can
          // neither delete it nor remove those edges. Still a default, not a
          // constraint (FR-004).
          statusOnFailure: body.statusOnFailure ?? 'on_hold',
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
 * Availability, as its own Command — feature 076, D-82.
 *
 * Whether a method is offered to buyers used to be writable from five places:
 * this module's upsert and the four gateway rule Commands, each under its own
 * action name, three of which named a gateway. One action name is what makes
 * "who turned this off, and when" one audit query.
 *
 * `before` / `after` are `{ status }` only, not the full
 * {@link paymentMethodAuditState}: the operation changed one field and an audit
 * diff that pretends otherwise is noise in the one report this Command exists
 * to make readable.
 *
 * **Not `reversible`**, for the reason its three siblings above give: that flag
 * marks the commands wired into feature 054's stored-revert undo, and this
 * module has no such surface. The inverse is the same PATCH carrying the other
 * value, which the audit row's `stateBefore` holds in full.
 */
export function makeSetPaymentMethodStatusCommand(
  id: string,
  status: 'active' | 'inactive',
): Command<PaymentMethod> {
  return {
    action: 'payment_method.set_status',
    objectType: 'payment_method',
    objectId: id,
    run: async ({ em }) => {
      const row = await em.findOne(PaymentMethod, { id });
      if (!row) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Payment method not found.');
      }
      // Setting the value it already holds is not a write, so it records no
      // audit row: "no write ⇒ no audit row" is what makes the query above
      // answer "who turned this off" rather than "who last opened the screen".
      if (row.status === status) {
        return { result: row, skipAudit: true };
      }
      const before = { status: row.status };
      row.status = status;
      await em.flush();
      return { result: row, before, after: { status: row.status } };
    },
  };
}

/**
 * What the delete-guard needs from `payments` (feature 034 FR-003, feature 075).
 *
 * Until the ledger drained, the guard was
 * `select count(*) from "payments" where "payment_method_id" = ?` written here
 * — another module's table read straight out of this module's Command, which
 * compiles and returns rows and so crossed a boundary nothing could see until
 * `check:module-boundary` learned to read SQL (D-87).
 */
export interface PaymentMethodDeleteGuard {
  /**
   * The payment read model, or `null` when `payments` is not effectively
   * present.
   *
   * An accessor rather than the port itself: `payments` is deactivatable, the
   * answer changes while the process runs, and a port captured once would keep
   * answering after an operator switched it off. The `null` is what the
   * deactivation-consequence ledger renders — see this module's manifest
   * `nonBindingDependencies`.
   */
  readonly paymentRead: () => PaymentReadPort | null;
}

export function makeDeletePaymentMethodCommand(
  id: string,
  guard: PaymentMethodDeleteGuard,
): Command<void> {
  return {
    action: 'payment_method.delete',
    objectType: 'payment_method',
    objectId: id,
    run: async ({ em }) => {
      const row = await em.findOne(PaymentMethod, { id });
      if (!row) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Payment method not found.');
      }
      const paymentRead = guard.paymentRead();
      // Decided before the read, not caught after it: with `payments` off there
      // is no way to tell whether an attempt still points at this method, and
      // deleting on an unanswered question is exactly the orphan FR-003 exists
      // to prevent. Refusing leaves the operator the reversible half — set the
      // method inactive — and leaves every other payment-method write working.
      if (paymentRead === null) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          'Cannot delete payment method: the payments module is switched off, so the payments ' +
            'that may reference it cannot be counted. Switch payments back on, or set this ' +
            'method\'s status to "inactive" instead.',
        );
      }
      const referencing = await paymentRead.countByPaymentMethod(row.id);
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

/**
 * Takes back a payment method **this request created**, when the step after the
 * creation failed — the channel assignment, which the sales-channel bridge
 * writes on a transaction of its own.
 *
 * Not {@link makeDeletePaymentMethodCommand}, and the difference is the point.
 * That Command asks `payments` whether anything references the method, and
 * refuses when `payments` is switched off because nobody can answer. For an
 * operator's delete that refusal is right. For a row created a moment ago, in
 * the same request, the question has an answer nobody needs to be asked: no
 * payment attempt can reference a method that did not exist before this request. Going
 * through the guard here would turn "`payments` is off" into "the take-back
 * is refused" — and leave a new method active and bound to no channel, which
 * for this entity type means offered on every one.
 *
 * It is still an audited delete, under the delete action, so the trail reads
 * create then delete and says who.
 */
export function makeWithdrawCreatedPaymentMethodCommand(id: string): Command<void> {
  return {
    action: 'payment_method.delete',
    objectType: 'payment_method',
    objectId: id,
    run: async ({ em }) => {
      const row = await em.findOne(PaymentMethod, { id });
      // Already gone: there is nothing left to take back, and nothing to audit.
      if (!row) return { result: undefined, skipAudit: true };
      const before = paymentMethodAuditState(row);
      await em.removeAndFlush(row);
      return { result: undefined, before, after: null };
    },
  };
}

/**
 * The fallback when even {@link makeWithdrawCreatedPaymentMethodCommand} fails:
 * the method this request created is set **inactive**.
 *
 * A row that could be neither assigned nor removed must not stay active with no
 * channel membership, because that is "offered on every channel". Inactive is
 * the one state reachable with a single column write in which the worst outcome
 * is "not offered" — and an operator who finds it sees a method to finish or
 * delete, not one already on sale where nobody put it.
 */
export function makeDeactivateCreatedPaymentMethodCommand(id: string): Command<void> {
  return {
    action: 'payment_method.update',
    objectType: 'payment_method',
    objectId: id,
    run: async ({ em }) => {
      const row = await em.findOne(PaymentMethod, { id });
      if (!row || row.status === 'inactive') return { result: undefined, skipAudit: true };
      const before = paymentMethodAuditState(row);
      row.status = 'inactive';
      await em.flush();
      return { result: undefined, before, after: paymentMethodAuditState(row) };
    },
  };
}
