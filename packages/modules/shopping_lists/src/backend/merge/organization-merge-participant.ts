import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeShoppingListMergeReassignCommand } from '../commands/shopping-list-merge-reassign.command.js';
import { ShoppingList } from '../entities/shopping-list.entity.js';

/**
 * `shopping_lists` in an Organization merge (`specs/192-organization-merge/`
 * T051): the loser's lists are re-pointed to the survivor. Registered with
 * `ctx.merge.participate('organization', 'shopping-lists', …)`; the runner calls
 * it inside the merge's own system scope and never while the module is off.
 * No cache or search index of this module is keyed by Organization, so a batch
 * has nothing to refresh (R-17).
 */
export interface ShoppingListMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class ShoppingListOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: ShoppingListMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const remaining = await em.count(ShoppingList, { organizationId: input.loserId });
    return { counts: { 'ShoppingList.organizationId': remaining }, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeShoppingListMergeReassignCommand(input));
    return { moved };
  }
}
