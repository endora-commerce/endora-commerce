import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  makeQuoteRequestMergeReassignCommand,
  quoteRequestMergeCounts,
  type QuoteRequestMergePart,
} from '../commands/quote-request-merge-reassign.command.js';

/**
 * The `quote_requests` participants of an Organization merge
 * (`specs/192-organization-merge/` T060, `contracts/merge-participant.md`):
 * the negotiation policy in the `configuration` phase (survivor wins, fill
 * gaps) and the quote requests with their notification rows in the `records`
 * phase (re-point), both through `quote_request.merge_reassign`.
 *
 * No permission and no presence check: the host's start was the gate, and the
 * runner never calls a participant whose module is off.
 */
export interface QuoteRequestMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

/** Manifest keys, one per participation. */
export const QUOTE_REQUEST_MERGE_PARTICIPATION_KEYS: Readonly<Record<QuoteRequestMergePart, string>> = {
  policy: 'organization-policy',
  records: 'organization-records',
};

export class QuoteRequestMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(
    private readonly part: QuoteRequestMergePart,
    private readonly deps: QuoteRequestMergeParticipantDeps,
  ) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const counts = await quoteRequestMergeCounts(em, this.part, input.survivorId, input.loserId);
    return { counts, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeQuoteRequestMergeReassignCommand(this.part, input));
    return { moved };
  }
}
