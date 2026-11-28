import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeMfaMergeReassignCommand, mfaMergePlan } from '../commands/mfa-merge-reassign.command.js';

/**
 * `mfa` in an Organization merge (`specs/192-organization-merge/` T054): the
 * customer MFA policy takes the stricter of the two. The remaining count is 1
 * while the stricter rule still has something to write — a loser's policy the
 * survivor lacks, or one stricter than the survivor's — and 0 once it has, or
 * when the survivor's already wins (research R-3). Registered with
 * `ctx.merge.participate('organization', 'organization-policy', …)`. The policy
 * is read per sign-in and cached nowhere, so a batch has nothing to refresh.
 */
export interface MfaMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class MfaOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: MfaMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const plan = await mfaMergePlan(em, input.survivorId, input.loserId);
    return {
      counts: { 'MfaOrganizationPolicy.organizationId': plan === null ? 0 : 1 },
      conflicts: [],
      warnings: [],
      refusals: [],
    };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeMfaMergeReassignCommand(input));
    return { moved };
  }
}
