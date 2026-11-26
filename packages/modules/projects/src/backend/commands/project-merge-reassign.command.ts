import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/**
 * `projects.project.merge_reassign` (`specs/192-organization-merge/` US6,
 * FR-091, FR-093, FR-094; `contracts/participant-dispositions.md` §B) — one
 * batch of the Project host's own records step (`records` phase), as one
 * Command. The loser's rows follow the survivor:
 *
 *  1. **links** to Orders, Quote Requests and Opportunities — a record stays
 *     in one Project, so a link is re-pointed, never duplicated. Its
 *     Organization is already on the survivor (`structure` ran first);
 *  2. **comments** (notes and messages), with the references their texts
 *     hold — they keep their own time, so they appear in the survivor's thread
 *     in chronological order. The loser's description and its references stay
 *     on the archived loser;
 *  3. **attachments** — a file the survivor already holds is not attached
 *     twice: the loser's row is dropped;
 *  4. **references naming the loser** as their target, in any Project's
 *     texts, now name the survivor. The texts themselves are never rewritten:
 *     a `[[project:<loser>]]` token resolves to the survivor when rendered;
 *  5. **read markers**: a person who had read the loser's thread up to a time
 *     has read the survivor's up to at least that time, so the moved messages
 *     are not shown as unread (FR-094).
 *
 * Steps 1 – 4 consume loser-side state and step 5 is idempotent, so a re-run
 * finds only what is left (R-3). At most `batchSize` rows per batch.
 * Irreversible, no event (R-13). Audit: `objectType` = `project`, `objectId` =
 * the survivor, `stateAfter = { mergeId, loserId, moved, ids }`.
 */
export async function projectRecordCounts(em: EntityManager, survivorId: string, loserId: string): Promise<Record<string, number>> {
  const [row] = await em.execute<
    Array<{ links: number; comments: number; attachments: number; sources: number; targets: number; reads: number }>
  >(
    `select
       (select count(*)::int from "project_links" where "project_id" = ?) as "links",
       (select count(*)::int from "project_comments" where "project_id" = ?) as "comments",
       (select count(*)::int from "project_attachments" where "project_id" = ?) as "attachments",
       (select count(*)::int from "project_references" where "project_id" = ? and "source_kind" = 'comment') as "sources",
       (select count(*)::int from "project_references" where "target_type" = 'project' and "target_id" = ?) as "targets",
       (select count(*)::int from "project_message_reads" l
         where l."project_id" = ? and not exists (
           select 1 from "project_message_reads" s
            where s."project_id" = ? and s."admin_user_id" = l."admin_user_id" and s."last_read_at" >= l."last_read_at")) as "reads"`,
    [loserId, loserId, loserId, loserId, loserId, loserId, survivorId],
  );
  return {
    'ProjectLink.projectId': Number(row?.links ?? 0),
    'ProjectComment.projectId': Number(row?.comments ?? 0),
    'ProjectAttachment.projectId': Number(row?.attachments ?? 0),
    'ProjectReference.projectId': Number(row?.sources ?? 0),
    'ProjectReference.targetId': Number(row?.targets ?? 0),
    'ProjectMessageRead.projectId': Number(row?.reads ?? 0),
  };
}

export interface ProjectMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

export function makeProjectMergeReassignCommand(input: MergeStepInput): Command<ProjectMergeReassignResult> {
  return {
    action: 'projects.project.merge_reassign',
    objectType: 'project',
    objectId: input.survivorId,
    run: async ({ em }) => {
      const { survivorId, loserId } = input;
      let budget = Math.max(1, input.batchSize);
      const ids: string[] = [];
      const take = (rows: ReadonlyArray<{ id: string }>): void => {
        for (const row of rows) ids.push(row.id);
        budget -= rows.length;
      };

      // 1. Links.
      take(
        await em.execute<Array<{ id: string }>>(
          `update "project_links" set "project_id" = ? where "id" = any(array(
             select "id" from "project_links" where "project_id" = ? order by "id" limit ? for update)) returning "id"`,
          [survivorId, loserId, budget],
        ),
      );

      // 2. Comments, then the references their texts hold.
      if (budget > 0) {
        take(
          await em.execute<Array<{ id: string }>>(
            `update "project_comments" set "project_id" = ? where "id" = any(array(
               select "id" from "project_comments" where "project_id" = ? order by "created_at", "id" limit ? for update)) returning "id"`,
            [survivorId, loserId, budget],
          ),
        );
      }
      if (budget > 0) {
        take(
          await em.execute<Array<{ id: string }>>(
            `update "project_references" set "project_id" = ? where "id" = any(array(
               select "id" from "project_references" where "project_id" = ? and "source_kind" = 'comment'
                order by "id" limit ? for update)) returning "id"`,
            [survivorId, loserId, budget],
          ),
        );
      }

      // 3. Attachments: a file the survivor already holds is dropped from the loser, the rest move.
      if (budget > 0) {
        take(
          await em.execute<Array<{ id: string }>>(
            `delete from "project_attachments" where "id" = any(array(
               select l."id" from "project_attachments" l
                where l."project_id" = ? and exists (
                  select 1 from "project_attachments" s where s."project_id" = ? and s."asset_id" = l."asset_id")
                order by l."id" limit ? for update)) returning "id"`,
            [loserId, survivorId, budget],
          ),
        );
      }
      if (budget > 0) {
        take(
          await em.execute<Array<{ id: string }>>(
            `update "project_attachments" set "project_id" = ? where "id" = any(array(
               select "id" from "project_attachments" where "project_id" = ? order by "id" limit ? for update)) returning "id"`,
            [survivorId, loserId, budget],
          ),
        );
      }

      // 4. References naming the loser, in any Project's texts.
      if (budget > 0) {
        take(
          await em.execute<Array<{ id: string }>>(
            `update "project_references" set "target_id" = ? where "id" = any(array(
               select "id" from "project_references" where "target_type" = 'project' and "target_id" = ?
                order by "id" limit ? for update)) returning "id"`,
            [survivorId, loserId, budget],
          ),
        );
      }

      // 5. Read markers (FR-094): the later of the two marks.
      if (budget > 0) {
        const carried = await em.execute<Array<{ admin_user_id: string }>>(
          `insert into "project_message_reads" ("project_id", "admin_user_id", "last_read_at")
             select ?, l."admin_user_id", l."last_read_at" from "project_message_reads" l
              where l."project_id" = ? and not exists (
                select 1 from "project_message_reads" s
                 where s."project_id" = ? and s."admin_user_id" = l."admin_user_id" and s."last_read_at" >= l."last_read_at")
              order by l."admin_user_id" limit ?
           on conflict ("project_id", "admin_user_id")
             do update set "last_read_at" = greatest("project_message_reads"."last_read_at", excluded."last_read_at")
           returning "admin_user_id"`,
          [survivorId, loserId, survivorId, budget],
        );
        take(carried.map((row) => ({ id: row.admin_user_id })));
      }

      const result = { moved: ids.length, ids };
      if (ids.length === 0) return { result, skipAudit: true };
      return { result, before: null, after: { mergeId: input.mergeId, loserId, moved: ids.length, ids } };
    },
  };
}
