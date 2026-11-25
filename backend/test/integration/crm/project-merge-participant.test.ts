import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { mergeSql, seedRows } from '../../helpers/organization-merge-participants.js';
import { expectComposedProjectParticipant } from '../../helpers/project-merge-participants.js';

/**
 * `specs/192-organization-merge/` US6, T085 — the `crm` participant of a
 * Project merge over a real database: references naming the loser in
 * Opportunities' texts are re-pointed at the survivor through
 * `crm.opportunity_reference.merge_reassign`, held to `expectMergeParticipant`
 * with batches smaller than the rows. A reference of another type, or to the
 * survivor, is left alone.
 */
describe('Project merge — the crm participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('re-points references to the loser (conformance)', async () => {
    const opportunityId = randomUUID();
    const outcome = await expectComposedProjectParticipant(h, {
      moduleId: 'crm',
      key: 'project-references',
      action: 'crm.opportunity_reference.merge_reassign',
      batchSize: 2,
      seed: async ({ survivorId, loserId }) => {
        const reference = (targetType: string, targetId: string) =>
          [
            `insert into "crm_opportunity_references" ("id","opportunity_id","source_kind","source_id","target_type","target_id")
             values (?, ?, 'comment', ?, ?, ?)`,
            [randomUUID(), opportunityId, randomUUID(), targetType, targetId],
          ] as const;
        await seedRows(h, [
          reference('project', loserId),
          reference('project', loserId),
          reference('project', loserId),
          reference('project', survivorId),
          reference('task', loserId),
        ]);
      },
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(
          h,
          `select "id","target_type","target_id" from "crm_opportunity_references" where "target_id" in (?, ?) order by "id"`,
          [survivorId, loserId],
        ),
      failOn: { table: 'crm_opportunity_references', on: 'UPDATE', when: (loserId) => `OLD."target_id" = '${loserId}'` },
    });
    expect(outcome.moved).toBe(3);
    const [left] = await mergeSql<Array<{ n: number }>>(
      h,
      `select count(*)::int as "n" from "crm_opportunity_references" where "target_type" = 'task' and "target_id" = ?`,
      [outcome.loserId],
    );
    expect(left!.n).toBe(1);
    await mergeSql(h, `delete from "crm_opportunity_references" where "opportunity_id" = ?`, [opportunityId]);
    await mergeSql(h, `delete from "projects" where "id" in (?, ?)`, [outcome.survivorId, outcome.loserId]);
  });
});
