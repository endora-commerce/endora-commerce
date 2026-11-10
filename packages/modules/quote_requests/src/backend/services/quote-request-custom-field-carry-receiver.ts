import {
  customFieldCarrySkipRecord,
  type CustomFieldCarryPort,
  type CustomFieldCarryReceipt,
  type CustomFieldCarryReceiverPort,
} from '@endora-commerce/contracts';
import { LockMode } from '@mikro-orm/core';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { QuoteRequestEvent } from '../entities/quote-request-event.entity.js';

type ReceiveInput = Parameters<CustomFieldCarryReceiverPort['receiveCarriedValues']>[0];

const NOT_FOUND: CustomFieldCarryReceipt = Object.freeze({ outcome: 'not-found', carried: [], skipped: [] });

/**
 * `quoteRequestCustomFieldCarryPort` (`specs/162-custom-fields-value-carry/`,
 * contract `carry-api.md` §4.2, research R-10): a Sales Opportunity's values
 * received into a Quote Request created from it, once CRM has linked the two.
 *
 * One Command, `quote_request.custom_fields.carry`, in the caller's (system)
 * scope: `custom_fields` plans the carry over the request's current bag —
 * empty fields only — and this module writes it. A value that cannot be
 * carried is named in one admin-only `custom-field-carry-skipped` event. A
 * missing request and one of another Organization are one answer, `not-found`,
 * and nothing is written; nothing carried and nothing skipped writes no entry.
 *
 * **The row is held from the read to the write.** Every other writer of a
 * request takes it `for update` (`underRowLock`); this Command does the same
 * — the Command Bus's transaction is the lock's — and plans over the bag it
 * re-reads under the lock, so an administrator's concurrent edit is either
 * committed before the plan reads it or refused afterwards on the version this
 * carry bumped. Never `underRowLock` itself: there is no version the system
 * caller read, and a 409 here would be a carry lost with nobody to retry it.
 */
export class QuoteRequestCustomFieldCarryReceiver implements CustomFieldCarryReceiverPort {
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
    action: 'quote_request.custom_fields.carry',
    objectType: 'quote_request',
    objectId: input.recordId,
    run: async ({ em }) => {
      // The Command's EntityManager is a fresh fork, so this is a read of the
      // stored row, taken `for update`: the plan below is made under the lock.
      const quote = await em.findOne(QuoteRequest, { id: input.recordId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!quote || quote.organizationId !== input.organizationId) {
        return { result: NOT_FOUND, skipAudit: true };
      }
      const current = { ...(quote.customFieldValues ?? {}) };
      const plan = await carryPort.plan({
        sourceType: 'opportunity',
        targetType: 'quote_request',
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
      if (receipt.carried.length > 0) {
        quote.customFieldValues = { ...plan.values };
        quote.version += 1;
      }
      if (receipt.skipped.length > 0) {
        em.persist(
          em.create(QuoteRequestEvent, {
            quoteRequestId: quote.id,
            eventType: 'custom-field-carry-skipped',
            actorAdminUserId: null,
            actorCustomerAccountId: null,
            actorRoleLabel: 'System',
            payload: { type: 'custom-field-carry-skipped', source, skipped: receipt.skipped },
          }),
        );
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
