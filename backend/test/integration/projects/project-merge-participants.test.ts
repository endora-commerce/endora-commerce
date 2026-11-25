import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { mergeOrganization, mergeSql, seedRows } from '../../helpers/organization-merge-participants.js';
import { expectComposedProjectParticipant } from '../../helpers/project-merge-participants.js';

/**
 * `specs/192-organization-merge/` US6, T081 — the Project host's own records
 * step (`projects.project.merge_reassign`, key `project-records`) over a real
 * database, held to `expectMergeParticipant` with batches smaller than the
 * rows: links, comments and their references move; an attachment of a file the
 * survivor already holds is dropped, the rest move; references naming the
 * loser name the survivor; read markers are carried (FR-094).
 */
describe('Project merge — the projects records step', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('moves the loser’s records to the survivor (conformance)', async () => {
    const organizationId = await mergeOrganization(h, 'Project records');
    const reader = randomUUID();
    const sharedAsset = randomUUID();
    const outcome = await expectComposedProjectParticipant(h, {
      moduleId: 'projects',
      key: 'project-records',
      action: 'projects.project.merge_reassign',
      batchSize: 3,
      seed: async ({ survivorId, loserId }) => {
        const commentId = randomUUID();
        await seedRows(h, [
          // Both hold the Organization (the structure step's union).
          [`insert into "project_organizations" ("project_id","organization_id") values (?, ?), (?, ?)`, [survivorId, organizationId, loserId, organizationId]],
          [
            `insert into "project_links" ("id","project_id","record_kind","record_id","organization_id") values (?, ?, 'order', ?, ?)`,
            [randomUUID(), loserId, randomUUID(), organizationId],
          ],
          [
            `insert into "project_comments" ("id","project_id","kind","body","author_admin_user_id","created_at") values (?, ?, 'message', 'S192R-one', ?, now() - interval '2 days')`,
            [commentId, loserId, reader],
          ],
          [
            `insert into "project_comments" ("id","project_id","kind","body","author_admin_user_id","created_at") values (?, ?, 'note', 'S192R-two', ?, now() - interval '1 day')`,
            [randomUUID(), loserId, reader],
          ],
          [
            `insert into "project_references" ("id","project_id","source_kind","source_id","target_type","target_id") values (?, ?, 'comment', ?, 'order', ?)`,
            [randomUUID(), loserId, commentId, randomUUID()],
          ],
          // The loser's description reference stays with it.
          [
            `insert into "project_references" ("id","project_id","source_kind","source_id","target_type","target_id") values (?, ?, 'description', null, 'order', ?)`,
            [randomUUID(), loserId, randomUUID()],
          ],
          // The survivor's description mentions the loser.
          [
            `insert into "project_references" ("id","project_id","source_kind","source_id","target_type","target_id") values (?, ?, 'description', null, 'project', ?)`,
            [randomUUID(), survivorId, loserId],
          ],
          // One file both hold, one only the loser holds.
          [
            `insert into "project_attachments" ("id","project_id","asset_id","added_by_admin_user_id","added_at") values (?, ?, ?, ?, now()), (?, ?, ?, ?, now()), (?, ?, ?, ?, now())`,
            [randomUUID(), survivorId, sharedAsset, reader, randomUUID(), loserId, sharedAsset, reader, randomUUID(), loserId, randomUUID(), reader],
          ],
          // A reader of the loser's thread, behind on the survivor's.
          [
            `insert into "project_message_reads" ("project_id","admin_user_id","last_read_at") values (?, ?, now() - interval '3 days'), (?, ?, now())`,
            [survivorId, reader, loserId, reader],
          ],
        ]);
      },
      snapshot: async ({ survivorId, loserId }) => ({
        links: await mergeSql(h, `select "id","project_id" from "project_links" where "project_id" in (?, ?) order by "id"`, [survivorId, loserId]),
        comments: await mergeSql(h, `select "id","project_id" from "project_comments" where "project_id" in (?, ?) order by "id"`, [survivorId, loserId]),
        attachments: await mergeSql(h, `select "id","project_id","asset_id" from "project_attachments" where "project_id" in (?, ?) order by "id"`, [
          survivorId,
          loserId,
        ]),
        references: await mergeSql(
          h,
          `select "id","project_id","target_id" from "project_references" where "project_id" in (?, ?) or "target_id" in (?, ?) order by "id"`,
          [survivorId, loserId, survivorId, loserId],
        ),
        reads: await mergeSql(h, `select "project_id","admin_user_id" from "project_message_reads" where "project_id" in (?, ?) order by 1, 2`, [
          survivorId,
          loserId,
        ]),
      }),
      failOn: { table: 'project_comments', on: 'UPDATE', when: (loserId) => `OLD."project_id" = '${loserId}'` },
    });
    // 1 link + 2 comments + 1 comment reference + 2 attachments (1 dropped, 1 moved) + 1 target reference + 1 read marker.
    expect(outcome.moved).toBe(8);
    const attachments = await mergeSql<Array<{ project_id: string; asset_id: string }>>(
      h,
      `select "project_id","asset_id" from "project_attachments" where "project_id" in (?, ?)`,
      [outcome.survivorId, outcome.loserId],
    );
    expect(attachments.every((row) => row.project_id === outcome.survivorId)).toBe(true);
    expect(attachments.filter((row) => row.asset_id === sharedAsset)).toHaveLength(1);
    const [description] = await mergeSql<Array<{ n: number }>>(
      h,
      `select count(*)::int as "n" from "project_references" where "project_id" = ? and "source_kind" = 'description'`,
      [outcome.loserId],
    );
    expect(description!.n).toBe(1);
    const [read] = await mergeSql<Array<{ caught_up: boolean }>>(
      h,
      `select s."last_read_at" >= l."last_read_at" as "caught_up" from "project_message_reads" s
         join "project_message_reads" l on l."admin_user_id" = s."admin_user_id" and l."project_id" = ?
        where s."project_id" = ? and s."admin_user_id" = ?`,
      [outcome.loserId, outcome.survivorId, reader],
    );
    expect(read!.caught_up).toBe(true);
    await mergeSql(h, `delete from "project_links" where "project_id" in (?, ?)`, [outcome.survivorId, outcome.loserId]);
    await mergeSql(h, `delete from "projects" where "id" in (?, ?)`, [outcome.survivorId, outcome.loserId]);
  });
});
