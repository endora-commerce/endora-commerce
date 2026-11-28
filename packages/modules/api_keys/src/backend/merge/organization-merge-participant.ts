import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeApiKeyMergeReassignCommand } from '../commands/api-key-merge-reassign.command.js';
import { ApiKey } from '../entities/api-key.entity.js';

/**
 * `api_keys` in an Organization merge (`specs/192-organization-merge/` T055): the
 * loser's bound API keys are re-pointed to the survivor (OQ-9: the
 * integration keeps working, because its service account moves with the
 * members), and the preview lists them as a warning. Registered with
 * `ctx.merge.participate('organization', 'bound-keys', …)`; the runner calls it
 * inside the merge's own system scope and never while the module is off.
 * No cache or search index of this module is keyed by Organization, so a batch
 * has nothing to refresh (R-17).
 */
/** The preview warning that names the bound keys a merge re-points (OQ-9). */
export const API_KEY_MERGE_REPOINTED_WARNING = 'API_KEY_BOUND_KEYS_REPOINTED';

/** How many key ids the warning lists; `count` carries the total. */
const LISTED_KEYS = 50;

export interface ApiKeyMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class ApiKeyOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: ApiKeyMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const remaining = await em.count(ApiKey, { organizationId: input.loserId });
    // OQ-9: a bound key is re-pointed so its integration keeps working; the
    // preview lists the keys either way, so the operator knows which ones.
    const warnings =
      remaining === 0
        ? []
        : [
            {
              code: API_KEY_MERGE_REPOINTED_WARNING,
              details: {
                count: remaining,
                ids: (
                  await em.find(ApiKey, { organizationId: input.loserId }, { orderBy: { id: 'asc' }, limit: LISTED_KEYS })
                ).map((key) => key.id),
              },
            },
          ];
    return { counts: { 'ApiKey.organizationId': remaining }, conflicts: [], warnings, refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeApiKeyMergeReassignCommand(input));
    return { moved };
  }
}
