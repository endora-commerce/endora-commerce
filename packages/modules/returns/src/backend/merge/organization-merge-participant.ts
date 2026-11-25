import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  makeReturnCaseMergeReassignCommand,
  RETURNS_MERGE_TABLES,
} from '../commands/return-case-merge-reassign.command.js';

/** The manifest key of this module's Organization participation. */
export const RETURNS_MERGE_PARTICIPATION_KEY = 'returns';

export interface ReturnsMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
}

/**
 * The `returns` participant of the Organization merge
 * (`specs/192-organization-merge/` T050): cases, attachments and withdrawal
 * statements re-pointed in the `records` phase. It checks no permission and no
 * presence (`contracts/merge-participant.md` §2).
 */
export class ReturnsOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: ReturnsMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory();
    const counts: Record<string, number> = {};
    for (const { table, reference } of RETURNS_MERGE_TABLES) {
      const [row] = await em.execute<Array<{ moved: number }>>(
        `select count(*)::int as "moved" from "${table}" where "organization_id" = ?`,
        [input.loserId],
      );
      counts[reference] = row?.moved ?? 0;
    }
    return { counts, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus().run(makeReturnCaseMergeReassignCommand(input));
    return { moved };
  }
}
