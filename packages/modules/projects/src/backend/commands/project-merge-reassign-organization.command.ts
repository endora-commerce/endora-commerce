import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/**
 * `projects.project.merge_reassign_organization` (`specs/192-organization-merge/`
 * T066, `contracts/participant-dispositions.md` §A) — one batch of the
 * `projects` participant of an Organization merge (this module as an
 * Organization holder, not as the Project host), as one Command. Per Project
 * the loser takes part in, in Project order:
 *
 *  1. the survivor becomes one of the Project's Organizations, unless it is
 *     already (union: insert on conflict do nothing);
 *  2. the Project's records linked under the loser are re-pointed at the
 *     survivor — `project_links` holds a foreign key into
 *     `project_organizations`, so the twin must exist first and the loser's
 *     row can go only once nothing is linked under it;
 *  3. the loser's `project_organizations` row is deleted.
 *
 * Steps 2 and 3 consume loser-side state (R-3), each moved link and each
 * deleted row counting one unit of `batchSize`; a Project whose links outrun
 * the batch keeps its loser row until a later batch has moved the rest.
 *
 * Irreversible, no event (R-13). Audit: `objectType` = `organization`,
 * `objectId` = the survivor, `stateAfter = { mergeId, loserId, moved, ids }`.
 */
export async function projectOrganizationMergeCounts(em: EntityManager, loserId: string): Promise<Record<string, number>> {
  const [organizations, links] = await Promise.all([
    em.execute<Array<{ count: number }>>(
      `select count(*)::int as "count" from "project_organizations" where "organization_id" = ?`,
      [loserId],
    ),
    em.execute<Array<{ count: number }>>(`select count(*)::int as "count" from "project_links" where "organization_id" = ?`, [
      loserId,
    ]),
  ]);
  return {
    'ProjectOrganization.organizationId': Number(organizations[0]?.count ?? 0),
    'ProjectLink.organizationId': Number(links[0]?.count ?? 0),
  };
}

export interface ProjectMergeReassignOrganizationResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

export function makeProjectMergeReassignOrganizationCommand(
  input: MergeStepInput,
): Command<ProjectMergeReassignOrganizationResult> {
  return {
    action: 'projects.project.merge_reassign_organization',
    objectType: 'organization',
    objectId: input.survivorId,
    run: async ({ em }) => {
      let budget = Math.max(1, input.batchSize);
      const ids: string[] = [];
      const projects = await em.execute<Array<{ project_id: string }>>(
        `select "project_id" from "project_organizations" where "organization_id" = ? order by "project_id" limit ? for update`,
        [input.loserId, budget],
      );
      for (const { project_id: projectId } of projects) {
        if (budget <= 0) break;
        await em.execute(
          `insert into "project_organizations" ("project_id", "organization_id") values (?, ?) on conflict do nothing`,
          [projectId, input.survivorId],
        );
        const links = await em.execute<Array<{ id: string }>>(
          `update "project_links" set "organization_id" = ? where "id" = any(array(` +
            `select "id" from "project_links" where "project_id" = ? and "organization_id" = ? order by "id" limit ? for update)) ` +
            `returning "id"`,
          [input.survivorId, projectId, input.loserId, budget],
        );
        for (const link of links) ids.push(link.id);
        budget -= links.length;
        if (budget <= 0) break;
        const left = await em.execute<Array<{ one: number }>>(
          `select 1 as "one" from "project_links" where "project_id" = ? and "organization_id" = ? limit 1`,
          [projectId, input.loserId],
        );
        if (left.length > 0) break;
        await em.execute(`delete from "project_organizations" where "project_id" = ? and "organization_id" = ?`, [
          projectId,
          input.loserId,
        ]);
        ids.push(projectId);
        budget -= 1;
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
