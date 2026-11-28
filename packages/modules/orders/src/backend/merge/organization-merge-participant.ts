import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type MergeParticipant,
  type MergeParticipantPreview,
  type MergePreviewInput,
  type MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import {
  makeOrderMergeReassignCommand,
  ORDER_MERGE_PENDING_INTENTS,
  ORDER_MERGE_PENDING_PAYMENTS,
  orderMergeCounts,
} from '../commands/order-merge-reassign.command.js';

/**
 * The `orders` participant of an Organization merge (`specs/192-organization-merge/`
 * T058, `contracts/merge-participant.md`): the loser's orders (as buyer and as
 * payer), their external references and transition effects, and its settled
 * placement intents follow the survivor, in the `records` phase, through
 * `order.merge_reassign`.
 *
 * In-flight business refuses the start instead (R-20, `RECORD_MERGE_BUSY`,
 * retryable): a placement intent still being placed, or a gateway payment
 * still at the provider. Should one appear after the start anyway, the step
 * throws the same code once everything else has moved, so the merge waits in
 * *needs attention* rather than archive a loser that still holds it.
 *
 * Registered under the manifest key `organization-records`. No permission and
 * no presence check: the host's start was the gate, and the runner never calls
 * a participant whose module is off.
 */
export interface OrderMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export const ORDER_MERGE_PARTICIPATION_KEY = 'organization-records';

export class OrderMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: OrderMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const [counts, inFlight] = await Promise.all([orderMergeCounts(em, input.loserId), this.#inFlight(em, input.loserId)]);
    return { counts, conflicts: [], warnings: [], refusals: inFlight };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeOrderMergeReassignCommand(input));
    if (moved > 0) return { moved };
    const inFlight = await this.#inFlight(this.deps.emFactory().fork({ clear: true }), input.loserId);
    if (inFlight.some((refusal) => refusal.details['reason'] === 'placement_intent')) {
      throw new HttpError(409, ERROR_CODES.RECORD_MERGE_BUSY, 'An order placement for this organization is still in progress.', {
        module: 'orders',
        reason: 'placement_intent',
      });
    }
    return { moved: 0 };
  }

  async #inFlight(
    em: EntityManager,
    loserId: string,
  ): Promise<Array<{ code: string; retryable: boolean; details: Record<string, unknown> }>> {
    const [intents, payments] = await Promise.all([
      em.execute<Array<{ count: number }>>(ORDER_MERGE_PENDING_INTENTS, [loserId]),
      em.execute<Array<{ count: number }>>(ORDER_MERGE_PENDING_PAYMENTS, [loserId, loserId]),
    ]);
    const refusals: Array<{ code: string; retryable: boolean; details: Record<string, unknown> }> = [];
    const pendingIntents = Number(intents[0]?.count ?? 0);
    const pendingPayments = Number(payments[0]?.count ?? 0);
    if (pendingIntents > 0) {
      refusals.push({
        code: ERROR_CODES.RECORD_MERGE_BUSY,
        retryable: true,
        details: { reason: 'placement_intent', count: pendingIntents },
      });
    }
    if (pendingPayments > 0) {
      refusals.push({
        code: ERROR_CODES.RECORD_MERGE_BUSY,
        retryable: true,
        details: { reason: 'pending_payment', count: pendingPayments },
      });
    }
    return refusals;
  }
}
