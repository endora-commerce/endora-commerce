import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type ProjectDetail, type ProjectReadPort, type RecordMergeRecord } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { mergeOrganization } from '../../helpers/organization-merge-participants.js';
import {
  PROJECTS_ADMIN,
  callProjects,
  createProject,
  createStageTask,
  deleteProjectTasks,
  deleteProjects,
  dictionaryIds,
  getProject,
  stageNamed,
  taskRowsOf,
} from './helpers.js';

/**
 * `specs/192-organization-merge/` US6 (T088) — merging two duplicate Projects,
 * end to end over the admin routes and the platform's runner: every
 * disposition of the Project inventory (`contracts/participant-dispositions.md`
 * §B), the archived loser, the refusals and the event.
 *
 *  1. Q's comments and attachments appear in P in chronological order, Q's
 *     links move to P, and P's Organizations and Members are the union of both
 *     (P's role kept on a conflict) — FR-091;
 *  2. the Tasks in Q's context are in P's, those of one of Q's Stages with no
 *     Stage — FR-092;
 *  3. a comment elsewhere mentioning Q is displayed as P — FR-093;
 *  4. (the module off) is `off-state.test.ts`'s, with every other route.
 */
describe('Project merge (US6)', () => {
  let h: BackendServerHandle;
  const created: string[] = [];
  const cookies = PROJECTS_ADMIN;
  const SENTINEL = 'S192P-';

  async function sql<T = unknown>(statement: string, params: unknown[] = []): Promise<T> {
    return h.em().fork().getConnection().execute(statement, params) as Promise<T>;
  }

  async function project(title: string, organizationIds: string[], extra: Record<string, unknown> = {}): Promise<ProjectDetail> {
    const detail = await createProject(h, { title, organizationIds, visibility: 'everyone', ...extra });
    created.push(detail.id);
    return detail;
  }

  const preview = (survivorId: string, loserId: string) =>
    callProjects(h, 'POST', `/${survivorId}/merge-preview`, { payload: { loserId } });
  const start = (survivorId: string, payload: Record<string, unknown>) =>
    callProjects(h, 'POST', `/${survivorId}/merges`, { payload });

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await deleteProjectTasks(h, created);
    await sql(`delete from "projects" where "merged_into_project_id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  describe('refusals (FR-090, FR-012)', () => {
    it('refuses a merge into itself, a missing acknowledgement, and a Project the caller does not see', async () => {
      const one = await project('Refusal one', []);
      const two = await project('Refusal two', []);
      const self = await start(one.id, { loserId: one.id, acknowledgeIrreversible: true });
      expect(self.statusCode, self.body).toBe(422);
      expect(self.json().error.code).toBe(ERROR_CODES.RECORD_MERGE_SAME_RECORD);
      const unacknowledged = await start(one.id, { loserId: two.id });
      expect(unacknowledged.statusCode, unacknowledged.body).toBe(422);
      expect(unacknowledged.json().error.code).toBe(ERROR_CODES.RECORD_MERGE_ACKNOWLEDGEMENT_REQUIRED);
      const missing = await preview(one.id, randomUUID());
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe(ERROR_CODES.PROJECT_NOT_FOUND);
    });
  });

  describe('a merge of Q into P', () => {
    let organizationA: string;
    let organizationB: string;
    let p: ProjectDetail;
    let q: ProjectDetail;
    let r: ProjectDetail;
    let merge: RecordMergeRecord;
    let otherAdmin: string;
    let survivorRole: string;
    let loserRole: string;
    let taskInStage: string;
    let commentIds: string[];
    let linkId: string;
    const events: unknown[] = [];

    beforeAll(async () => {
      organizationA = await mergeOrganization(h, 'Project merge A');
      organizationB = await mergeOrganization(h, 'Project merge B');
      p = await project('Tender P', [organizationA]);
      q = await project(`${SENTINEL}Tender Q`, [organizationB], { description: `${SENTINEL}details` });
      r = await project('Elsewhere R', []);
      otherAdmin = randomUUID();
      const roles = await dictionaryIds(h, 'project_roles');
      [survivorRole, loserRole] = Object.values(roles) as [string, string];

      // Members: the harness administrator on both, with different Roles; another person on Q only.
      const members = async (projectId: string, rows: Array<[string, string]>): Promise<void> => {
        for (const [adminUserId, roleId] of rows) {
          const memberId = randomUUID();
          await sql(`insert into "project_members" ("id","project_id","admin_user_id","added_at") values (?, ?, ?, now())`, [
            memberId,
            projectId,
            adminUserId,
          ]);
          await sql(`insert into "project_member_roles" ("member_id","role_id") values (?, ?)`, [memberId, roleId]);
        }
      };
      await sql(`delete from "project_members" where "project_id" in (?, ?)`, [p.id, q.id]);
      await members(p.id, [[TEST_ADMIN_ID, survivorRole]]);
      await members(q.id, [
        [TEST_ADMIN_ID, loserRole],
        [otherAdmin, loserRole],
      ]);
      await sql(`insert into "project_viewers" ("project_id","admin_user_id") values (?, ?)`, [q.id, otherAdmin]);

      // A link to an Order under Q's Organization.
      linkId = randomUUID();
      await sql(
        `insert into "project_links" ("id","project_id","record_kind","record_id","organization_id") values (?, ?, 'order', ?, ?)`,
        [linkId, q.id, randomUUID(), organizationB],
      );

      // Comments: a note of P, then two messages of Q by somebody else, then a note of P again —
      // the merged thread interleaves them by time.
      const comment = async (projectId: string, kind: 'note' | 'message', at: string, author = otherAdmin): Promise<string> => {
        const id = randomUUID();
        await sql(
          `insert into "project_comments" ("id","project_id","kind","body","author_admin_user_id","created_at") values (?, ?, ?, ?, ?, ?)`,
          [id, projectId, kind, `${SENTINEL}${kind} at ${at}`, author, at],
        );
        return id;
      };
      commentIds = [
        await comment(p.id, 'note', '2026-11-01T09:00:00Z', TEST_ADMIN_ID),
        await comment(q.id, 'message', '2026-11-02T09:00:00Z'),
        await comment(q.id, 'message', '2026-11-03T09:00:00Z'),
        await comment(p.id, 'note', '2026-11-04T09:00:00Z', TEST_ADMIN_ID),
      ];
      // The harness administrator had read Q's thread to its end (FR-094).
      const read = await callProjects(h, 'POST', `/${q.id}/messages/read`, { payload: { throughMessageId: commentIds[2] } });
      expect(read.statusCode, read.body).toBeLessThan(300);

      // A comment of R mentioning Q (FR-093).
      const mention = await callProjects(h, 'POST', `/${r.id}/comments`, {
        payload: { kind: 'note', body: `See [[project:${q.id}]] for the tender.` },
      });
      expect(mention.statusCode, mention.body).toBe(201);

      // Tasks in Q's context: one in a Stage, one without.
      taskInStage = (await createStageTask(h, q.id, stageNamed(q, 'Design'), { title: 'Stage task of Q' })).id;

      h.eventBus.on('project.merged.v1' as never, (payload: unknown) => {
        events.push(payload);
      });
    });

    it('previews the values that differ and what follows, writing nothing (FR-002)', async () => {
      const before = await sql<Array<{ n: number }>>(`select count(*)::int as "n" from "record_merges"`);
      const res = await preview(p.id, q.id);
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.refusals).toEqual([]);
      expect(data.incomplete).toEqual([]);
      expect(data.fields.map((field: { code: string }) => field.code)).toEqual(expect.arrayContaining(['title', 'description']));
      const records = data.participants.find((x: { key: string }) => x.key === 'project-records');
      expect(records.counts).toMatchObject({ 'ProjectLink.projectId': 1, 'ProjectComment.projectId': 2 });
      const tasks = data.participants.find((x: { moduleId: string }) => x.moduleId === 'tasks');
      expect(tasks.counts['Task.contextId']).toBe(1);
      const after = await sql<Array<{ n: number }>>(`select count(*)::int as "n" from "record_merges"`);
      expect(after[0]!.n).toBe(before[0]!.n);
    });

    it('starts, freezing Q: a write naming Q is refused while the merge runs (R-6)', async () => {
      const res = await start(p.id, { loserId: q.id, fieldChoices: { title: 'loser' }, acknowledgeIrreversible: true });
      expect(res.statusCode, res.body).toBe(202);
      merge = res.json().data;
      expect(merge).toMatchObject({ hostType: 'project', survivorId: p.id, loserId: q.id, state: 'running' });
      expect(merge.steps.map((step) => `${step.moduleId}/${step.key}`).sort()).toEqual([
        'crm/project-references',
        'projects/host-structure',
        'projects/project-records',
        'tasks/project-tasks',
      ]);
      const frozen = await callProjects(h, 'POST', `/${q.id}/comments`, { payload: { kind: 'note', body: 'While merging' } });
      expect(frozen.statusCode, frozen.body).toBe(409);
      expect(frozen.json().error.code).toBe('RECORD_MERGE_IN_PROGRESS');
    });

    it('runs every phase and completes', async () => {
      expect(await h.recordMergeRuntime.run(merge.id)).toBe('completed');
      const record = (await h.app.inject({ method: 'GET', url: `/api/v1/admin/project-merges/${merge.id}`, cookies })).json().data;
      expect(record.state).toBe('completed');
      expect(record.steps.filter((step: { state: string }) => step.state !== 'done')).toEqual([]);
      expect(record.survivorName).toContain(p.number);
    });

    it('scenario 1: Q’s comments in P by time, Q’s link in P, Organizations and Members unioned with P’s role kept (FR-091)', async () => {
      const comments = await callProjects(h, 'GET', `/${p.id}/comments?kind=note`);
      const messages = await callProjects(h, 'GET', `/${p.id}/comments?kind=message`);
      expect(messages.statusCode, messages.body).toBe(200);
      const ids = [...comments.json().data, ...messages.json().data]
        .sort((a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt))
        .map((c: { id: string }) => c.id);
      expect(ids).toEqual(commentIds);
      const [link] = await sql<Array<{ project_id: string }>>(`select "project_id" from "project_links" where "id" = ?`, [linkId]);
      expect(link!.project_id).toBe(p.id);

      const detail = await getProject(h, p.id);
      expect(detail.organizations.map((o) => o.id).sort()).toEqual([organizationA, organizationB].sort());
      const byAdmin = new Map(detail.members.map((m) => [m.adminUser.id, m.roles.map((role) => role.id)]));
      expect(byAdmin.get(TEST_ADMIN_ID)).toEqual([survivorRole]);
      expect(byAdmin.get(otherAdmin)).toEqual([loserRole]);
      expect(detail.viewers.map((v) => v.id)).toContain(otherAdmin);
      // The title chosen from Q; P keeps its own workflow.
      expect(detail.title).toBe(`${SENTINEL}Tender Q`);
      expect(detail.stages.map((s) => s.id).sort()).toEqual(p.stages.map((s) => s.id).sort());
      // Q's messages were read by the harness administrator: they are not unread in P (FR-094).
      expect(detail.unreadMessageCount).toBe(0);
    });

    it('scenario 2: Q’s Tasks are in P’s context, the one of Q’s Stage with no Stage (FR-092)', async () => {
      expect(await taskRowsOf(h, q.id)).toEqual([]);
      const tasks = await taskRowsOf(h, p.id);
      expect(tasks.find((task) => task.id === taskInStage)).toMatchObject({ context_group_id: null });
    });

    it('scenario 3: a comment elsewhere mentioning Q renders as P and leads to it; the text is not rewritten (FR-093)', async () => {
      const res = await callProjects(h, 'GET', `/${r.id}/comments?kind=note`);
      const [note] = res.json().data;
      expect(note.body).toContain(`[[project:${q.id}]]`);
      expect(note.references).toEqual([
        { type: 'project', id: q.id, available: true, label: p.number, url: `/projects/${p.id}` },
      ]);
      const [row] = await sql<Array<{ target_id: string }>>(
        `select "target_id" from "project_references" where "project_id" = ? and "target_type" = 'project'`,
        [r.id],
      );
      expect(row!.target_id).toBe(p.id);
    });

    it('archives Q: read by id with its pointer and its own Stage history, out of every list, refused on write (FR-051 – FR-053)', async () => {
      const archived = await getProject(h, q.id);
      expect(archived).toMatchObject({ id: q.id, mergedIntoProjectId: p.id, mergeId: merge.id });
      expect(archived.permissions).toEqual({ canWrite: false, canConfigure: false });
      expect(archived.stages.length).toBeGreaterThan(0);
      const history = await callProjects(h, 'GET', `/${q.id}/stage-history`);
      expect(history.statusCode, history.body).toBe(200);
      expect(history.json().data.length).toBeGreaterThan(0);

      const list = await callProjects(h, 'GET', `?organizationId=${organizationB}`);
      const listed = list.json().items.map((item: { id: string }) => item.id);
      expect(listed).toContain(p.id);
      expect(listed).not.toContain(q.id);

      const write = await callProjects(h, 'PATCH', `/${q.id}`, { payload: { title: 'Too late', version: archived.version } });
      expect(write.statusCode, write.body).toBe(409);
      expect(write.json().error).toMatchObject({ code: 'PROJECT_MERGED', details: { survivorId: p.id } });

      const port = h.container.resolve<ProjectReadPort>('projectReadPort');
      await enterSystemScope('test: project merge read port', async () => {
        expect(await port.resolveMerged(q.id)).toBe(p.id);
        expect(await port.resolveMerged(p.id)).toBe(p.id);
        expect((await port.findById(q.id))?.mergedIntoProjectId).toBe(p.id);
        expect((await port.findByIds([q.id, p.id])).map((record) => record.id)).toEqual([p.id]);
        expect((await port.getMerge(merge.id))?.state).toBe('completed');
      });
    });

    it('takes no new Task into the archived Q (FR-053)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/tasks',
        cookies,
        payload: { title: 'Too late', context: { contextType: 'project', contextId: q.id, contextGroupId: stageNamed(q, 'Design') } },
      });
      expect(res.statusCode, res.body).toBe(422);
    });

    it('refuses to merge the archived Q again (FR-090)', async () => {
      const again = await start(r.id, { loserId: q.id, acknowledgeIrreversible: true });
      expect(again.statusCode, again.body).toBe(409);
      expect(again.json().error.code).toBe(ERROR_CODES.RECORD_MERGE_RECORD_UNAVAILABLE);
    });

    it('publishes project.merged.v1 once, with ids only, and never again on a re-run (FR-054)', async () => {
      expect(events).toEqual([
        expect.objectContaining({
          projectId: p.id,
          mergedProjectId: q.id,
          mergeId: merge.id,
          organizationIds: [organizationA, organizationB].sort(),
        }),
      ]);
      await h.recordMergeRuntime.run(merge.id);
      expect(events).toHaveLength(1);
    });

    it('records the merge id in every audit entry it wrote, and no value (FR-060)', async () => {
      const entries = await sql<Array<{ action: string; state_after: Record<string, unknown> }>>(
        `select "action", "state_after" from "audit_log_entries" where "state_after" ->> 'mergeId' = ? order by "acted_at", "id"`,
        [merge.id],
      );
      const actions = entries.map((entry) => entry.action);
      expect(actions[0]).toBe('projects.project.merge.start');
      expect(actions.at(-1)).toBe('projects.project.merge.finalize');
      expect(actions).toEqual(
        expect.arrayContaining(['projects.project.merge.structure', 'projects.project.merge_reassign', 'task.merge_move_context']),
      );
      expectNoAuditValues(
        entries.map((entry) => ({ action: entry.action, stateAfter: entry.state_after })),
        [SENTINEL],
      );
      expect(entries.at(-1)!.state_after['changedFields']).toEqual(expect.arrayContaining(['title']));
    });

    it('lists the merge for both Projects (FR-081)', async () => {
      for (const projectId of [p.id, q.id]) {
        const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/project-merges?projectId=${projectId}`, cookies });
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json().data.map((m: { id: string }) => m.id)).toContain(merge.id);
      }
    });
  });

  describe('cancel', () => {
    it('cancels a merge no step has started, and the loser is writable again (FR-011)', async () => {
      const survivor = await project('Cancel P', []);
      const loser = await project('Cancel Q', []);
      const res = await start(survivor.id, { loserId: loser.id, acknowledgeIrreversible: true });
      expect(res.statusCode, res.body).toBe(202);
      const record = res.json().data;
      const cancel = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/project-merges/${record.id}/cancel`,
        cookies,
        payload: { expectedVersion: record.version },
      });
      expect(cancel.statusCode, cancel.body).toBe(200);
      expect(cancel.json().data.state).toBe('cancelled');
      const note = await callProjects(h, 'POST', `/${loser.id}/comments`, { payload: { kind: 'note', body: 'Writable again' } });
      expect(note.statusCode, note.body).toBe(201);
      expect(await h.recordMergeRuntime.run(record.id)).toBe('idle');
    });
  });
});
