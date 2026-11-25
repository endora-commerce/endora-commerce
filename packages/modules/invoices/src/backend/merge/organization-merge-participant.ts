import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeInvoiceMergeReassignCommand } from '../commands/invoice-merge-reassign.command.js';

/** The manifest key of this module's Organization participation. */
export const INVOICES_MERGE_PARTICIPATION_KEY = 'invoices';

export interface InvoiceMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
}

/**
 * The `invoices` participant of the Organization merge
 * (`specs/192-organization-merge/` T044): the loser's invoices are re-pointed
 * in the `records` phase; the documents are not reissued (FR-043). It checks no
 * permission and no presence (`contracts/merge-participant.md` §2).
 */
export class InvoiceOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: InvoiceMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const [row] = await this.deps.emFactory().execute<Array<{ moved: number }>>(
      `select count(*)::int as "moved" from "invoices" where "organization_id" = ?`,
      [input.loserId],
    );
    return { counts: { 'Invoice.organizationId': row?.moved ?? 0 }, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus().run(makeInvoiceMergeReassignCommand(input));
    return { moved };
  }
}
