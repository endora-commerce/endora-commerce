import {
  customFieldCarrySkipRecord,
  type CustomFieldCarryPort,
  type CustomFieldCarryReceipt,
  type CustomFieldCarryReceiverPort,
} from '@endora-commerce/contracts';
import { LockMode } from '@mikro-orm/core';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { Order } from '../entities/order.entity.js';
import { buildCarrySkipNote } from '../order-carry-note.js';

type ReceiveInput = Parameters<CustomFieldCarryReceiverPort['receiveCarriedValues']>[0];

const NOT_FOUND: CustomFieldCarryReceipt = Object.freeze({ outcome: 'not-found', carried: [], skipped: [] });

/**
 * `orderCustomFieldCarryPort` (`specs/162-custom-fields-value-carry/`, contract
 * `carry-api.md` §4.2, research R-10): a Sales Opportunity's values received
 * into an Order created from it, once CRM has linked the two.
 *
 * One Command, `order.custom_fields.carry`, in the caller's (system) scope:
 * `custom_fields` plans the carry over the Order's current bag — empty fields
 * only — and this module writes it. A value that cannot be carried is named in
 * one internal, author-less, non-notifying system note. A missing Order and one
 * of another Organization are one answer, `not-found`, and nothing is written;
 * nothing carried and nothing skipped writes no entry.
 *
 * **The row is held from the read to the write**, as the Quote Request
 * receiver holds its own: the Order is read `for update` inside the Command's
 * transaction and the plan is made over the bag re-read under the lock, so a
 * concurrent writer that holds the row is waited for and its value kept rather
 * than overwritten by a plan made over the bag it replaced.
 */
export class OrderCustomFieldCarryReceiver implements CustomFieldCarryReceiverPort {
  constructor(
    private readonly deps: { commandBus: CommandBus; customFieldCarry: CustomFieldCarryPort },
  ) {}

  async receiveCarriedValues(input: ReceiveInput): Promise<CustomFieldCarryReceipt> {
    return this.deps.commandBus.run(receiveCarriedValuesCommand(input, this.deps.customFieldCarry));
  }
}

function receiveCarriedValuesCommand(
  input: ReceiveInput,
  carryPort: CustomFieldCarryPort,
): Command<CustomFieldCarryReceipt> {
  return {
    action: 'order.custom_fields.carry',
    objectType: 'order',
    objectId: input.recordId,
    run: async ({ em }) => {
      // The Command's EntityManager is a fresh fork, so this is a read of the
      // stored row, taken `for update`: the plan below is made under the lock.
      const order = await em.findOne(Order, { id: input.recordId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!order || order.organizationId !== input.organizationId) {
        return { result: NOT_FOUND, skipAudit: true };
      }
      const current = { ...(order.customFieldValues ?? {}) };
      const plan = await carryPort.plan({
        sourceType: 'opportunity',
        targetType: 'order',
        sourceValues: input.source.values,
        targetValues: current,
      });
      const receipt: CustomFieldCarryReceipt = {
        outcome: 'applied',
        carried: [...plan.carried],
        skipped: plan.skipped.map(customFieldCarrySkipRecord),
      };
      if (receipt.carried.length === 0 && receipt.skipped.length === 0) {
        return { result: receipt, skipAudit: true };
      }
      const source = {
        entityType: input.source.entityType,
        recordId: input.source.recordId,
        reference: input.source.reference,
      };
      if (receipt.carried.length > 0) order.customFieldValues = { ...plan.values };
      if (receipt.skipped.length > 0) {
        buildCarrySkipNote(em, { orderId: order.id, source, skipped: receipt.skipped });
      }
      await em.flush();
      // The entry names the carried keys, never their values (D-288, #470).
      return {
        result: receipt,
        before: null,
        after: {
          ...(receipt.carried.length > 0 ? { changedCustomFields: [...receipt.carried].sort() } : {}),
          customFieldCarry: { source, carried: receipt.carried, skipped: receipt.skipped },
        },
      };
    },
  };
}
