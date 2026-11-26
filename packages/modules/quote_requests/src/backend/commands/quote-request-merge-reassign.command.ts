import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/**
 * `quote_request.merge_reassign` (`specs/192-organization-merge/` T060,
 * `contracts/participant-dispositions.md` §A) — one batch of the
 * `quote_requests` participant of an Organization merge, as one Command.
 *
 * Two parts, one per declared participation:
 *
 *  - `policy` (`configuration` phase): the loser's negotiation policy is
 *    *survivor wins, fill gaps* — it becomes the survivor's only when the
 *    survivor has none; otherwise it stays on the archived loser and is not
 *    counted (R-3), so a re-run is a no-op;
 *  - `records` (`records` phase): quote requests and their notification rows
 *    are re-pointed; the update is the loser-side consume.
 *
 * Irreversible, no event (R-13). Audit: `objectType` = `organization`,
 * `objectId` = the survivor, `stateAfter = { mergeId, loserId, moved, ids }`.
 */
export type QuoteRequestMergePart = 'policy' | 'records';

const RECORD_TARGETS = [
  { reference: 'QuoteRequest.organizationId', table: 'quote_requests' },
  { reference: 'QuoteRequestNotification.organizationId', table: 'quote_request_notifications' },
] as const;

/** Remaining references of the loser this part will move, per `Entity.property`. */
export async function quoteRequestMergeCounts(
  em: EntityManager,
  part: QuoteRequestMergePart,
  survivorId: string,
  loserId: string,
): Promise<Record<string, number>> {
  if (part === 'policy') {
    const rows = await em.execute<Array<{ count: number }>>(
      `select count(*)::int as "count" from "quote_request_org_policies" l where l."organization_id" = ? ` +
        `and not exists (select 1 from "quote_request_org_policies" s where s."organization_id" = ?)`,
      [loserId, survivorId],
    );
    return { 'QuoteRequestOrgPolicy.organizationId': Number(rows[0]?.count ?? 0) };
  }
  const counts: Record<string, number> = {};
  for (const target of RECORD_TARGETS) {
    const rows = await em.execute<Array<{ count: number }>>(
      `select count(*)::int as "count" from "${target.table}" where "organization_id" = ?`,
      [loserId],
    );
    counts[target.reference] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

export interface QuoteRequestMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

export function makeQuoteRequestMergeReassignCommand(
  part: QuoteRequestMergePart,
  input: MergeStepInput,
): Command<QuoteRequestMergeReassignResult> {
  return {
    action: 'quote_request.merge_reassign',
    objectType: 'organization',
    objectId: input.survivorId,
    run: async ({ em }) => {
      const ids: string[] = [];
      if (part === 'policy') {
        const rows = await em.execute<Array<{ organization_id: string }>>(
          `update "quote_request_org_policies" set "organization_id" = ?, "updated_at" = now() ` +
            `where "organization_id" = ? and not exists (select 1 from "quote_request_org_policies" s where s."organization_id" = ?) ` +
            `returning "organization_id"`,
          [input.survivorId, input.loserId, input.survivorId],
        );
        for (const row of rows) ids.push(row.organization_id);
      } else {
        let budget = Math.max(1, input.batchSize);
        for (const target of RECORD_TARGETS) {
          if (budget <= 0) break;
          const rows = await em.execute<Array<{ id: string }>>(
            `update "${target.table}" set "organization_id" = ? where "id" = any(array(` +
              `select "id" from "${target.table}" where "organization_id" = ? order by "id" limit ? for update)) returning "id"`,
            [input.survivorId, input.loserId, budget],
          );
          for (const row of rows) ids.push(row.id);
          budget -= rows.length;
        }
      }
      const result = { moved: ids.length, ids };
      if (ids.length === 0) return { result, skipAudit: true };
      return {
        result,
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
