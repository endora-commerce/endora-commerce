import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';

/**
 * `projects.project.merge.structure` (`specs/192-organization-merge/` US6,
 * FR-091; `contracts/project-merge.md` §2) — one batch of the Project host's
 * `structure` phase, as one Command: the survivor gains the loser's
 * Organizations, Members and viewers it does not have yet (union).
 *
 *  1. **Organizations** first: a linked record moves in the `records` phase
 *     after this one, and its foreign key needs its Organization on the
 *     survivor (FR-091 — "Organizations a linked record needs are added before
 *     the link moves").
 *  2. **Members**: a person who is a Member of both keeps the survivor's Roles
 *     (the survivor's role on conflict); one who is not gets a Member row on the
 *     survivor with the loser's Roles.
 *  3. **Viewers**: the people listed on the loser are listed on the survivor.
 *
 * Before those, once per merge, the **Stage map** goes into the merge's host
 * context for `tasks` (FR-092): each of the loser's Stages → the survivor's
 * Stage of the same name (trimmed, case-insensitive), otherwise the survivor's
 * current Stage, which is also the fallback for a Task the map does not name.
 * The loser's Stages themselves stay on it with its history.
 *
 * The archived loser keeps its own rows — so whoever could open it can still
 * open it and follow its pointer — which also makes the step idempotent by
 * construction: what is counted is what the loser holds that the survivor
 * lacks, and a re-run finds nothing (research R-3). The survivor's
 * `configurationVersion` moves with every batch that changed its sets, so a
 * screen editing them from an older read is refused rather than overwriting.
 *
 * Audit: `objectType` = `project`, `objectId` = the survivor,
 * `stateAfter = { mergeId, loserId, moved, ids }` — Organization and
 * administrator ids, never a name.
 */
export async function projectStructureCounts(em: EntityManager, survivorId: string, loserId: string): Promise<Record<string, number>> {
  const [row] = await em.execute<Array<{ organizations: number; members: number; viewers: number }>>(
    `select
       (select count(*)::int from "project_organizations" l
         where l."project_id" = ? and not exists (
           select 1 from "project_organizations" s where s."project_id" = ? and s."organization_id" = l."organization_id")) as "organizations",
       (select count(*)::int from "project_members" l
         where l."project_id" = ? and not exists (
           select 1 from "project_members" s where s."project_id" = ? and s."admin_user_id" = l."admin_user_id")) as "members",
       (select count(*)::int from "project_viewers" l
         where l."project_id" = ? and not exists (
           select 1 from "project_viewers" s where s."project_id" = ? and s."admin_user_id" = l."admin_user_id")) as "viewers"`,
    [loserId, survivorId, loserId, survivorId, loserId, survivorId],
  );
  return {
    'ProjectOrganization.projectId': Number(row?.organizations ?? 0),
    'ProjectMember.projectId': Number(row?.members ?? 0),
    'ProjectViewer.projectId': Number(row?.viewers ?? 0),
  };
}

export interface ProjectMergeStructureResult {
  readonly moved: number;
}

export interface ProjectMergeStructureDeps {
  readonly recordMerge: () => RecordMergeService;
}

async function buildStageMap(
  em: EntityManager,
  survivorId: string,
  loserId: string,
): Promise<{ stageMap: Record<string, string>; fallbackStageId: string | null }> {
  const [survivor] = await em.execute<Array<{ current_stage_id: string | null }>>(
    'select "current_stage_id" from "projects" where "id" = ?',
    [survivorId],
  );
  const survivorStages = await em.execute<Array<{ id: string; name: string }>>(
    'select "id", "name" from "project_stages" where "project_id" = ? order by "position"',
    [survivorId],
  );
  const loserStages = await em.execute<Array<{ id: string; name: string }>>(
    'select "id", "name" from "project_stages" where "project_id" = ?',
    [loserId],
  );
  const key = (name: string): string => name.trim().toLocaleLowerCase();
  const byName = new Map<string, string>();
  for (const stage of survivorStages) if (!byName.has(key(stage.name))) byName.set(key(stage.name), stage.id);
  const fallbackStageId = survivor?.current_stage_id ?? survivorStages[0]?.id ?? null;
  const stageMap: Record<string, string> = {};
  for (const stage of loserStages) {
    const to = byName.get(key(stage.name)) ?? fallbackStageId;
    if (to !== null) stageMap[stage.id] = to;
  }
  return { stageMap, fallbackStageId };
}

export function makeProjectMergeStructureCommand(
  deps: ProjectMergeStructureDeps,
  input: MergeStepInput,
): Command<ProjectMergeStructureResult> {
  return {
    action: 'projects.project.merge.structure',
    objectType: 'project',
    objectId: input.survivorId,
    run: async ({ em }) => {
      const { survivorId, loserId } = input;
      let budget = Math.max(1, input.batchSize);
      const ids: string[] = [];
      // The survivor's row, held for the batch: its sets change below.
      await em.execute('select "id" from "projects" where "id" = ? for update', [survivorId]);

      // 0. The Stage map, once (the merge row is the authority; the context the
      //    runner handed in may be a batch old).
      const context = await deps.recordMerge().hostContextWithin(em, input.mergeId);
      let stageMapWritten = false;
      if (context['stageMap'] === undefined) {
        const map = await buildStageMap(em, survivorId, loserId);
        await deps.recordMerge().setHostContext(em, input.mergeId, { ...context, ...map });
        stageMapWritten = true;
      }

      // 1. Organizations (union).
      const organizations = await em.execute<Array<{ organization_id: string }>>(
        `insert into "project_organizations" ("project_id", "organization_id")
           select ?, l."organization_id" from "project_organizations" l
            where l."project_id" = ? and not exists (
              select 1 from "project_organizations" s where s."project_id" = ? and s."organization_id" = l."organization_id")
            order by l."organization_id" limit ?
         on conflict do nothing returning "organization_id"`,
        [survivorId, loserId, survivorId, budget],
      );
      for (const row of organizations) ids.push(row.organization_id);
      budget -= organizations.length;

      // 2. Members (union; the survivor's Roles on conflict).
      if (budget > 0) {
        const added = await em.execute<Array<{ id: string; admin_user_id: string }>>(
          `insert into "project_members" ("id", "project_id", "admin_user_id", "added_at")
             select gen_random_uuid(), ?, l."admin_user_id", l."added_at" from "project_members" l
              where l."project_id" = ? and not exists (
                select 1 from "project_members" s where s."project_id" = ? and s."admin_user_id" = l."admin_user_id")
              order by l."admin_user_id" limit ?
           on conflict ("project_id", "admin_user_id") do nothing returning "id", "admin_user_id"`,
          [survivorId, loserId, survivorId, budget],
        );
        if (added.length > 0) {
          await em.execute(
            `insert into "project_member_roles" ("member_id", "role_id")
               select s."id", r."role_id" from "project_members" s
                 join "project_members" l on l."project_id" = ? and l."admin_user_id" = s."admin_user_id"
                 join "project_member_roles" r on r."member_id" = l."id"
                where s."project_id" = ? and s."id" = any(?::uuid[])
             on conflict do nothing`,
            [loserId, survivorId, `{${added.map((row) => row.id).join(',')}}`],
          );
        }
        for (const row of added) ids.push(row.admin_user_id);
        budget -= added.length;
      }

      // 3. Viewers (union).
      if (budget > 0) {
        const viewers = await em.execute<Array<{ admin_user_id: string }>>(
          `insert into "project_viewers" ("project_id", "admin_user_id")
             select ?, l."admin_user_id" from "project_viewers" l
              where l."project_id" = ? and not exists (
                select 1 from "project_viewers" s where s."project_id" = ? and s."admin_user_id" = l."admin_user_id")
              order by l."admin_user_id" limit ?
           on conflict do nothing returning "admin_user_id"`,
          [survivorId, loserId, survivorId, budget],
        );
        for (const row of viewers) ids.push(row.admin_user_id);
        budget -= viewers.length;
      }

      // The map counts as a batch's work, so the runner calls again for the sets.
      if (ids.length === 0) return { result: { moved: stageMapWritten ? 1 : 0 }, skipAudit: true };
      await em.execute('update "projects" set "configuration_version" = "configuration_version" + 1 where "id" = ?', [survivorId]);
      return {
        result: { moved: ids.length },
        before: null,
        after: { mergeId: input.mergeId, loserId, moved: ids.length, ids },
      };
    },
  };
}
