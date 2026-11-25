import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/** The batch Command of this module's Organization merge step (`specs/192-organization-merge/` R-12). */
export const PROMOTION_MERGE_REASSIGN_ACTION = 'promotion.merge_reassign';

/** The `scope_key` suffix of an Organization's usage counters: `<promotionId>:<organizationId>`. */
export function organizationCounterSuffix(organizationId: string): string {
  return `%:${organizationId}`;
}

export interface PromotionMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

async function repoint(em: EntityManager, table: string, input: MergeStepInput, limit: number): Promise<string[]> {
  const rows = await em.execute<Array<{ id: string }>>(
    `update "${table}" set "organization_id" = ?
      where "id" in (select "id" from "${table}" where "organization_id" = ? order by "id" limit ? for update)
      returning "id"`,
    [input.survivorId, input.loserId, limit],
  );
  return rows.map((row) => row.id);
}

/**
 * The loser's per-Organization counters, added to the survivor's twin (created
 * when it has none) and deleted — one statement, so the sum and the consume
 * commit together and a re-run finds nothing to add twice (R-3).
 */
async function sumCounters(em: EntityManager, input: MergeStepInput, limit: number): Promise<string[]> {
  const rows = await em.execute<Array<{ id: string }>>(
    `with "picked" as (
       select "id", "scope_key", "count" from "promotion_usage_counters"
        where "scope_type" = 'organization' and "scope_key" like ?
        order by "id" limit ? for update),
     "added" as (
       insert into "promotion_usage_counters" ("id", "scope_type", "scope_key", "count")
       select gen_random_uuid(), 'organization', left("scope_key", length("scope_key") - length(?)) || ?, "count" from "picked"
       on conflict ("scope_type", "scope_key") do update set "count" = "promotion_usage_counters"."count" + excluded."count"
       returning 1)
     delete from "promotion_usage_counters" where "id" in (select "id" from "picked") returning "id"`,
    [organizationCounterSuffix(input.loserId), limit, input.loserId, input.survivorId],
  );
  return rows.map((row) => row.id);
}

/**
 * `promotion.merge_reassign` — one batch of the `promotions` participant
 * (`specs/192-organization-merge/` T049): at most `batchSize` rows of the
 * loser's Organization-specific promotions and its usages are re-pointed to
 * the survivor, and its per-Organization usage counters are summed into the
 * survivor's, so a merge cannot reset a per-Organization limit.
 *
 * Irreversible, no event; the audit names the merge and the ids only.
 */
export function makePromotionMergeReassignCommand(input: MergeStepInput): Command<PromotionMergeReassignResult> {
  return {
    action: PROMOTION_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const ids: string[] = [];
      const budget = (): number => Math.max(1, input.batchSize) - ids.length;
      for (const table of ['promotions', 'promotion_usages']) {
        if (budget() <= 0) break;
        ids.push(...(await repoint(em, table, input, budget())));
      }
      if (budget() > 0) ids.push(...(await sumCounters(em, input, budget())));
      if (ids.length === 0) return { result: { moved: 0, ids }, skipAudit: true };
      return {
        result: { moved: ids.length, ids },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
