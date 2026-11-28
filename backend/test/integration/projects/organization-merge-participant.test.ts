import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import {
  expectOrganizationParticipantConforms,
  insertOrganizationPair,
} from '../../helpers/organization-merge-conformance.js';
import { ProjectsOrganizationMergeParticipant } from '../../../../packages/modules/projects/src/backend/merge/organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T066 — the `projects` participant of an
 * Organization merge (as a holder of Organization references) over a real
 * database: `project_organizations` unioned into the survivor, then
 * `project_links.organization_id` re-pointed (the links' foreign key into
 * `project_organizations` is why the order matters), through
 * `projects.project.merge_reassign_organization`, held to
 * `expectMergeParticipant` with batches smaller than one Project's links.
 */
describe('Organization merge — the projects participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const sql = <T = unknown>(statement: string, params: unknown[] = []): Promise<T> =>
    h.em().fork().getConnection().execute(statement, params) as Promise<T>;

  async function project(organizationIds: string[]): Promise<string> {
    const id = randomUUID();
    const stageId = randomUUID();
    const connection = h.orm.em.getConnection();
    await connection.transactional(async (trx) => {
      await connection.execute(
        `insert into "projects" ("id","number","title","visibility","created_by_admin_user_id") values (?, ?, 'Merge', 'everyone', ?)`,
        [id, `PRJ-M${id.slice(0, 8)}`, TEST_ADMIN_ID],
        'run',
        trx,
      );
      await connection.execute(
        `insert into "project_stages" ("id","project_id","name","color","position") values (?, ?, 'Design', '#3b82f6', 1)`,
        [stageId, id],
        'run',
        trx,
      );
      await connection.execute(`update "projects" set "current_stage_id" = ? where "id" = ?`, [stageId, id], 'run', trx);
      for (const organizationId of organizationIds) {
        await connection.execute(
          `insert into "project_organizations" ("project_id","organization_id") values (?, ?)`,
          [id, organizationId],
          'run',
          trx,
        );
      }
    });
    return id;
  }

  const link = (projectId: string, organizationId: string, kind = 'order') =>
    sql(`insert into "project_links" ("id","project_id","record_kind","record_id","organization_id") values (?, ?, ?, ?, ?)`, [
      randomUUID(),
      projectId,
      kind,
      randomUUID(),
      organizationId,
    ]);

  it('unions the loser’s Project memberships into the survivor and re-points its links (conformance)', async () => {
    const ids = await insertOrganizationPair(h);
    const projects: string[] = [];
    const outcome = await expectOrganizationParticipantConforms({
      h,
      moduleId: 'projects',
      key: 'organization-projects',
      ids,
      batchSize: 2,
      build: (commandBus: Pick<CommandBus, 'run'>) => new ProjectsOrganizationMergeParticipant({ emFactory: () => h.em(), commandBus }),
      seed: async ({ survivorId, loserId }) => {
        // Only the loser takes part, with three links (more than one batch).
        const only = await project([loserId]);
        await link(only, loserId);
        await link(only, loserId, 'quote_request');
        await link(only, loserId, 'opportunity');
        // Both take part: the survivor's row is the twin the union meets.
        const both = await project([survivorId, loserId]);
        await link(both, loserId);
        await link(both, survivorId);
        projects.push(only, both);
      },
      snapshot: async ({ survivorId, loserId }) => ({
        organizations: await sql(
          `select "project_id","organization_id" from "project_organizations" where "organization_id" in (?, ?) order by "project_id","organization_id"`,
          [survivorId, loserId],
        ),
        links: await sql(`select "id","project_id","organization_id" from "project_links" where "organization_id" in (?, ?) order by "id"`, [
          survivorId,
          loserId,
        ]),
      }),
    });
    // 2 memberships + 4 links.
    expect(outcome.moved).toBe(6);
    const rows = await sql<Array<{ project_id: string; organization_id: string }>>(
      `select "project_id","organization_id" from "project_organizations" where "project_id" in (?, ?) order by "project_id"`,
      projects,
    );
    expect(rows.every((row) => row.organization_id === ids.survivorId)).toBe(true);
    expect(rows).toHaveLength(2);
  });
});
