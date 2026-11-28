import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/**
 * `catalog.product.merge_reassign` (`specs/192-organization-merge/` T064,
 * `contracts/participant-dispositions.md` §A) — one batch of the `catalog`
 * participant of an Organization merge, as one Command: in at most
 * `batchSize` audience allow-lists (a product's global one and its
 * per-channel overrides) the loser is replaced by the survivor, a union — the
 * survivor is not listed twice, and the list's order is otherwise kept.
 *
 * Replacing the loser's id is the loser-side consume (R-3): a list no longer
 * naming it is not selected again, so a re-run moves nothing.
 *
 * Irreversible, no event (R-13). Audit: `objectType` = `organization`,
 * `objectId` = the survivor, `stateAfter = { mergeId, loserId, moved, ids }`,
 * where a channel override's id is `<productId>:<salesChannelId>`.
 */
const NAMES = (loserId: string): string => JSON.stringify([loserId]);

/** Allow-lists still naming the loser, per `Entity.property` — the preview's counts. */
export async function productMergeCounts(em: EntityManager, loserId: string): Promise<Record<string, number>> {
  const [products, scopes] = await Promise.all([
    em.execute<Array<{ count: number }>>(
      `select count(*)::int as "count" from "products" where "allowed_organization_ids" @> ?::jsonb`,
      [NAMES(loserId)],
    ),
    em.execute<Array<{ count: number }>>(
      `select count(*)::int as "count" from "product_channel_scopes" where "allowed_organization_ids" @> ?::jsonb`,
      [NAMES(loserId)],
    ),
  ]);
  return {
    'Product.allowedOrganizationIds': Number(products[0]?.count ?? 0),
    'ProductChannelScope.allowedOrganizationIds': Number(scopes[0]?.count ?? 0),
  };
}

/** The loser replaced by the survivor, each id once, first occurrence kept. */
export function replaceAllowedOrganization(list: readonly string[], loserId: string, survivorId: string): string[] {
  const out: string[] = [];
  for (const id of list) {
    const next = id === loserId ? survivorId : id;
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

export interface ProductMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
  /** Products whose audience changed, for the caller's refresh after commit. */
  readonly productIds: readonly string[];
}

export function makeProductMergeReassignCommand(input: MergeStepInput): Command<ProductMergeReassignResult> {
  return {
    action: 'catalog.product.merge_reassign',
    objectType: 'organization',
    objectId: input.survivorId,
    run: async ({ em }) => {
      let budget = Math.max(1, input.batchSize);
      const ids: string[] = [];
      const productIds = new Set<string>();

      const products = await em.execute<Array<{ id: string; allowed_organization_ids: string[] }>>(
        `select "id", "allowed_organization_ids" from "products" where "allowed_organization_ids" @> ?::jsonb ` +
          `order by "id" limit ? for update`,
        [NAMES(input.loserId), budget],
      );
      for (const row of products) {
        const next = replaceAllowedOrganization(row.allowed_organization_ids, input.loserId, input.survivorId);
        await em.execute(`update "products" set "allowed_organization_ids" = ?::jsonb, "updated_at" = now() where "id" = ?`, [
          JSON.stringify(next),
          row.id,
        ]);
        ids.push(row.id);
        productIds.add(row.id);
      }
      budget -= products.length;

      if (budget > 0) {
        const scopes = await em.execute<Array<{ product_id: string; sales_channel_id: string; allowed_organization_ids: string[] }>>(
          `select "product_id", "sales_channel_id", "allowed_organization_ids" from "product_channel_scopes" ` +
            `where "allowed_organization_ids" @> ?::jsonb order by "product_id", "sales_channel_id" limit ? for update`,
          [NAMES(input.loserId), budget],
        );
        for (const row of scopes) {
          const next = replaceAllowedOrganization(row.allowed_organization_ids, input.loserId, input.survivorId);
          await em.execute(
            `update "product_channel_scopes" set "allowed_organization_ids" = ?::jsonb, "updated_at" = now() ` +
              `where "product_id" = ? and "sales_channel_id" = ?`,
            [JSON.stringify(next), row.product_id, row.sales_channel_id],
          );
          ids.push(`${row.product_id}:${row.sales_channel_id}`);
          productIds.add(row.product_id);
        }
      }

      const result = { moved: ids.length, ids, productIds: [...productIds] };
      if (ids.length === 0) return { result, skipAudit: true };
      return {
        result,
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
