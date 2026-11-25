import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makePriceListMergeReassignCommand } from '../commands/price-list-merge-reassign.command.js';
import { isLiveStatus, type SurfaceChange } from '../services/surface-change.js';

/** The manifest key of this module's Organization participation. */
export const PRICE_LISTS_MERGE_PARTICIPATION_KEY = 'price-audiences';

/** Both Organizations have a display-mode override: the survivor's is kept. */
export const PRICE_DISPLAY_MODE_MERGE_SURVIVOR_KEPT = 'PRICE_DISPLAY_MODE_MERGE_SURVIVOR_KEPT';

export interface PriceListMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
  /** `PricingGeneration.bump` — clears every process's cached prices and marks the surface. */
  readonly bumpPricing: (change: SurfaceChange) => Promise<void>;
}

/**
 * The `price_lists` participant of the Organization merge
 * (`specs/192-organization-merge/` T048): audiences unioned, the display-mode
 * override filling the survivor's gap, in the `configuration` phase — before
 * `records`, so carts are repriced against the survivor's audiences (R-11).
 * After each batch the pricing generation is bumped with the books whose
 * audience changed: every cached price, keyed by either Organization's profile,
 * is dropped (R-17). It checks no permission and no presence
 * (`contracts/merge-participant.md` §2).
 */
export class PriceListOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: PriceListMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const [row] = await this.deps.emFactory().execute<Array<{ members: number; fills: number; kept: number }>>(
      `select (select count(*) from "price_list_audience_members" where "organization_id" = ?)::int as "members",
              (select count(*) from "price_display_mode_overrides" as "l"
                where "l"."scope" = 'organization' and "l"."target_id" = ?
                  and not exists (select 1 from "price_display_mode_overrides" where "scope" = 'organization' and "target_id" = ?))::int as "fills",
              (select count(*) from "price_display_mode_overrides" as "l"
                where "l"."scope" = 'organization' and "l"."target_id" = ?
                  and exists (select 1 from "price_display_mode_overrides" where "scope" = 'organization' and "target_id" = ?))::int as "kept"`,
      [input.loserId, input.loserId, input.survivorId, input.loserId, input.survivorId],
    );
    return {
      counts: {
        'PriceListAudienceMember.organizationId': row?.members ?? 0,
        'PriceDisplayModeOverride.targetId': row?.fills ?? 0,
      },
      conflicts: (row?.kept ?? 0) > 0 ? [{ code: PRICE_DISPLAY_MODE_MERGE_SURVIVOR_KEPT, resolution: 'survivor' }] : [],
      warnings: [],
      refusals: [],
    };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const result = await this.deps.commandBus().run(makePriceListMergeReassignCommand(input));
    if (result.moved > 0) await this.deps.bumpPricing(await this.#surfaceChange(result.bookIds));
    return { moved: result.moved };
  }

  /** The books whose audience changed, as the price surface reads them; a display mode alone moves no stored price. */
  async #surfaceChange(bookIds: readonly string[]): Promise<SurfaceChange> {
    if (bookIds.length === 0) return { kind: 'none' };
    const books = await this.deps.emFactory().execute<
      Array<{ id: string; currency_code: string; audience_kind: 'everyone' | 'organizations' | 'customer_groups'; is_system: boolean; status: string }>
    >(`select "id", "currency_code", "audience_kind", "is_system", "status" from "price_lists" where "id" = any(?::uuid[])`, [
      `{${bookIds.join(',')}}`,
    ]);
    return {
      kind: 'books',
      books: books.map((book) => ({
        facts: [
          {
            bookId: book.id,
            currencyCode: book.currency_code.trim(),
            audienceKind: book.audience_kind,
            isSystem: book.is_system,
            live: isLiveStatus(book.status),
          },
        ],
        selections: 'stored' as const,
      })),
    };
  }
}
