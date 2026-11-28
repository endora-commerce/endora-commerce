import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { makeProductMergeReassignCommand, productMergeCounts } from '../commands/product-merge-reassign.command.js';

/**
 * The `catalog` participant of an Organization merge (`specs/192-organization-merge/`
 * T064, `contracts/merge-participant.md`): in every product audience
 * allow-list — global and per channel — the loser is replaced by the survivor
 * (union), in the `configuration` phase, through `catalog.product.merge_reassign`.
 *
 * After each committed batch it refreshes what it owns (FR-055, R-17): the
 * changed products' storefront pages, and their search documents, which carry
 * the allow-list as a facet. Both refreshes are best-effort and after commit:
 * the batch is the truth, and a refresh that fails is caught up by the next
 * write of that product or a reindex. No event is published (R-13).
 *
 * No permission and no presence check of its own: the runner never calls it
 * while `catalog` is off.
 */
export interface CatalogMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
  /** The changed products' search documents, re-read; absent or a no-op while `search` is off. */
  readonly reindexProducts?: (productIds: readonly string[]) => Promise<void>;
  /** The changed products' storefront pages. */
  readonly revalidateProducts?: (productIds: readonly string[]) => void;
  readonly warn?: (message: string, error: unknown) => void;
}

export const CATALOG_MERGE_PARTICIPATION_KEY = 'organization-audiences';

export class CatalogMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: CatalogMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const counts = await productMergeCounts(this.deps.emFactory().fork({ clear: true }), input.loserId);
    return { counts, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved, productIds } = await this.deps.commandBus.run(makeProductMergeReassignCommand(input));
    if (productIds.length > 0) {
      try {
        this.deps.revalidateProducts?.(productIds);
        await this.deps.reindexProducts?.(productIds);
      } catch (error) {
        // `search` switched off between the probe and the call: say so, do not swallow it.
        rethrowIfModuleDisabled(error);
        this.deps.warn?.('catalog: products not refreshed after an organization merge batch', error);
      }
    }
    return { moved };
  }
}
