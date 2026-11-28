import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/** The batch Command of this module's Organization merge step (`specs/192-organization-merge/` R-12). */
export const RELATED_PAYER_MERGE_REASSIGN_ACTION = 'related_payer.merge_reassign';

/** Who closed a request a merge made pointless (`decided_by_kind`). */
export const RELATED_PAYER_MERGE_DECIDED_BY = 'merge';

export interface RelatedPayerMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
  /** Buyer Organizations whose cached links are stale after the commit. */
  readonly buyerOrganizationIds: readonly string[];
}

/**
 * The loser's links still to handle. A revoked link that would join the
 * survivor to itself has been handled — it stays on the archived loser, as
 * `related_payer_links_distinct_pair` requires — so it is not counted again (R-3).
 */
export const LOSER_LINKS = `("organization_id" = ? or "payer_organization_id" = ?)
  and not ("state" = 'revoked' and (("organization_id" = ? and "payer_organization_id" = ?) or ("organization_id" = ? and "payer_organization_id" = ?)))`;

export function loserLinkParams(survivorId: string, loserId: string): unknown[] {
  return [loserId, loserId, loserId, survivorId, survivorId, loserId];
}

interface LinkRow {
  id: string;
  organization_id: string;
  payer_organization_id: string;
  state: string;
}

interface RequestRow {
  id: string;
  organization_id: string;
  counterparty_organization_id: string | null;
  state: string;
}

async function moveLinks(em: EntityManager, input: MergeStepInput, limit: number, buyers: Set<string>): Promise<string[]> {
  const { survivorId, loserId } = input;
  const map = (id: string): string => (id === loserId ? survivorId : id);
  const rows = await em.execute<LinkRow[]>(
    `select "id", "organization_id", "payer_organization_id", "state" from "related_payer_links"
      where ${LOSER_LINKS} order by "id" limit ? for update`,
    [...loserLinkParams(survivorId, loserId), limit],
  );
  const revoke = `"state" = 'revoked', "revoked_at" = now(), "revoked_by_kind" = 'automation', "revoked_by_id" = null`;
  for (const row of rows) {
    const organizationId = map(row.organization_id);
    const payerOrganizationId = map(row.payer_organization_id);
    buyers.add(row.organization_id);
    buyers.add(organizationId);
    if (organizationId === payerOrganizationId) {
      // A link between the two becomes a link to itself: revoked, and left where it is.
      await em.execute(`update "related_payer_links" set ${revoke}, "version" = "version" + 1, "updated_at" = now() where "id" = ?`, [row.id]);
      continue;
    }
    const [duplicate] =
      row.state === 'revoked'
        ? []
        : await em.execute<Array<{ id: string }>>(
            `select "id" from "related_payer_links"
              where "organization_id" = ? and "payer_organization_id" = ? and "state" <> 'revoked' and "id" <> ? limit 1`,
            [organizationId, payerOrganizationId, row.id],
          );
    await em.execute(
      `update "related_payer_links" set "organization_id" = ?, "payer_organization_id" = ?,
              ${duplicate ? `${revoke},` : ''} "version" = "version" + 1, "updated_at" = now()
        where "id" = ?`,
      [organizationId, payerOrganizationId, row.id],
    );
  }
  return rows.map((row) => row.id);
}

async function moveRequests(em: EntityManager, input: MergeStepInput, limit: number): Promise<string[]> {
  const { survivorId, loserId } = input;
  const rows = await em.execute<RequestRow[]>(
    `select "id", "organization_id", "counterparty_organization_id", "state" from "related_payer_requests"
      where "organization_id" = ? or "counterparty_organization_id" = ? order by "id" limit ? for update`,
    [loserId, loserId, limit],
  );
  for (const row of rows) {
    const organizationId = row.organization_id === loserId ? survivorId : row.organization_id;
    const counterparty = row.counterparty_organization_id === loserId ? survivorId : row.counterparty_organization_id;
    const close = row.state === 'pending' && organizationId === counterparty;
    await em.execute(
      `update "related_payer_requests" set "organization_id" = ?, "counterparty_organization_id" = ?,
              ${close ? `"state" = 'withdrawn', "decided_at" = now(), "decided_by_kind" = ?, "decided_by_id" = null,` : ''}
              "version" = "version" + 1, "updated_at" = now()
        where "id" = ?`,
      close ? [organizationId, counterparty, RELATED_PAYER_MERGE_DECIDED_BY, row.id] : [organizationId, counterparty, row.id],
    );
  }
  return rows.map((row) => row.id);
}

/**
 * `related_payer.merge_reassign` — one batch of the `related_payers`
 * participant (`specs/192-organization-merge/` T047, spec § Edge cases):
 * at most `batchSize` of the links and requests naming the loser on either
 * side are re-pointed to the survivor, links first.
 *
 *  - A link between the two would join the survivor to itself: it is revoked
 *    (`automation`) and stays on the archived loser.
 *  - A live link duplicating one of the survivor's live links is revoked as it
 *    moves; the survivor's is kept.
 *  - A pending request between the two is closed — `withdrawn`, decided by
 *    `merge` — as it moves.
 *
 * Each row is consumed as it is handled (R-3). Irreversible, no event, no
 * notification; the audit names the merge and the ids only.
 */
export function makeRelatedPayerMergeReassignCommand(input: MergeStepInput): Command<RelatedPayerMergeReassignResult> {
  return {
    action: RELATED_PAYER_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const limit = Math.max(1, input.batchSize);
      const buyers = new Set<string>();
      const ids = await moveLinks(em, input, limit, buyers);
      if (ids.length < limit) ids.push(...(await moveRequests(em, input, limit - ids.length)));
      const buyerOrganizationIds = [...buyers];
      if (ids.length === 0) return { result: { moved: 0, ids, buyerOrganizationIds }, skipAudit: true };
      return {
        result: { moved: ids.length, ids, buyerOrganizationIds },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
