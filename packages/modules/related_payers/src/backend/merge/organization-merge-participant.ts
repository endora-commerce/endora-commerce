import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  LOSER_LINKS,
  loserLinkParams,
  makeRelatedPayerMergeReassignCommand,
} from '../commands/related-payer-merge-reassign.command.js';

/** The manifest key of this module's Organization participation. */
export const RELATED_PAYERS_MERGE_PARTICIPATION_KEY = 'payer-links';

/** A link between the two Organizations: it would join the survivor to itself. */
export const RELATED_PAYER_MERGE_SELF_LINK = 'RELATED_PAYER_MERGE_SELF_LINK';
/** A live link of the loser to a payer the survivor already has a live link to. */
export const RELATED_PAYER_MERGE_DUPLICATE_LINK = 'RELATED_PAYER_MERGE_DUPLICATE_LINK';
/** A pending request between the two Organizations. */
export const RELATED_PAYER_MERGE_SELF_REQUEST = 'RELATED_PAYER_MERGE_SELF_REQUEST';

export interface RelatedPayerMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
  /** Drop a buyer's cached links here and in every process (research R-9 of 182). */
  readonly onLinksChanged: (buyerOrganizationId: string) => Promise<void>;
}

/**
 * The `related_payers` participant of the Organization merge
 * (`specs/192-organization-merge/` T047): links and requests re-pointed in the
 * `records` phase, self-links and duplicates revoked, self-requests closed. It
 * checks no permission and no presence (`contracts/merge-participant.md` §2).
 */
export class RelatedPayerOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: RelatedPayerMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const { survivorId, loserId } = input;
    const em = this.deps.emFactory();
    const links = await em.execute<Array<{ id: string; organization_id: string; payer_organization_id: string; state: string; duplicate: boolean }>>(
      `select "l"."id", "l"."organization_id", "l"."payer_organization_id", "l"."state",
              exists (select 1 from "related_payer_links" as "s"
                       where "s"."organization_id" = case when "l"."organization_id" = ? then ?::uuid else "l"."organization_id" end
                         and "s"."payer_organization_id" = case when "l"."payer_organization_id" = ? then ?::uuid else "l"."payer_organization_id" end
                         and "s"."state" <> 'revoked' and "s"."id" <> "l"."id") as "duplicate"
         from "related_payer_links" as "l" where ${LOSER_LINKS}`,
      [loserId, survivorId, loserId, survivorId, ...loserLinkParams(survivorId, loserId)],
    );
    const requests = await em.execute<Array<{ id: string; organization_id: string; counterparty_organization_id: string | null; state: string }>>(
      `select "id", "organization_id", "counterparty_organization_id", "state" from "related_payer_requests"
        where "organization_id" = ? or "counterparty_organization_id" = ?`,
      [loserId, loserId],
    );
    const pair = new Set([survivorId, loserId]);
    const conflicts: MergeParticipantPreview['conflicts'][number][] = [];
    for (const link of links) {
      if (pair.has(link.organization_id) && pair.has(link.payer_organization_id)) {
        conflicts.push({ code: RELATED_PAYER_MERGE_SELF_LINK, resolution: 'revoked', details: { linkId: link.id } });
      } else if (link.state !== 'revoked' && link.duplicate) {
        conflicts.push({ code: RELATED_PAYER_MERGE_DUPLICATE_LINK, resolution: 'revoked', details: { linkId: link.id } });
      }
    }
    for (const request of requests) {
      if (request.state === 'pending' && pair.has(request.organization_id) && pair.has(request.counterparty_organization_id ?? '')) {
        conflicts.push({ code: RELATED_PAYER_MERGE_SELF_REQUEST, resolution: 'closed', details: { requestId: request.id } });
      }
    }
    return {
      counts: {
        'RelatedPayerLink.organizationId': links.filter((link) => link.organization_id === loserId).length,
        'RelatedPayerLink.payerOrganizationId': links.filter((link) => link.organization_id !== loserId).length,
        'RelatedPayerRequest.organizationId': requests.filter((request) => request.organization_id === loserId).length,
        'RelatedPayerRequest.counterpartyOrganizationId': requests.filter((request) => request.organization_id !== loserId).length,
      },
      conflicts,
      warnings: [],
      refusals: [],
    };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved, buyerOrganizationIds } = await this.deps.commandBus().run(makeRelatedPayerMergeReassignCommand(input));
    // After the commit: every buyer whose links changed reloads them.
    for (const buyer of buyerOrganizationIds) await this.deps.onLinksChanged(buyer);
    return { moved };
  }
}
