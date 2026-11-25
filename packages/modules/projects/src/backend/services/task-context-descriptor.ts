import type { EntityManager } from '@mikro-orm/postgresql';
import {
  pickLocalized,
  type SupportedLanguage,
  type TaskContextDescription,
  type TaskContextDescriptor,
  type TaskContextSearchHit,
} from '@endora-commerce/contracts';
import { mergeWriteRefusal } from '@endora-commerce/platform/tenancy';
import { isUuid, PROJECTS_WRITE_PERMISSION, uuidArray, type ProjectAccess } from './project-access.js';
import { PROJECT_TASK_CONTEXT_TYPE } from './project-tasks.js';

/**
 * The `project` Task context (research R-1, R-9): what makes a Task belong to
 * a Project and one of its Stages, without `tasks` knowing Projects exist.
 *
 * Every answer runs under the **caller's** ambient context and goes through
 * `ProjectAccess` — the Organization rule and the visibility rule (R-2, R-3) —
 * so a Project Task is seen exactly by whoever may see its Project: in the
 * Tasks list, in *My Tasks*, by id, and nowhere else. With Projects switched
 * off the registry stops enumerating this descriptor and the Tasks are hidden
 * (fail-closed); they return when Projects is back.
 *
 * `canSeeAs` answers for somebody else — the assignee the Tasks module is
 * about to tell — through `ProjectAccess.canSeeAs` (research R-4), so the bell
 * never names a Task of a Project its recipient may not see.
 *
 * `canChangeTasks` lets a Task into a Project, out of one — detached, or moved
 * to another record — or deleted from one only for a caller holding
 * `projects:write` who sees the Project (T144, T147).
 *
 * `describe` names a Project by number and title, links to its screen, and
 * labels each Stage — the Task's group — by its current name. It describes only
 * the Projects `visibleIds` hands back; an id it leaves out is shown by
 * `tasks` as an unavailable record.
 *
 * `search` answers the Project/Stage picker a page at a time (issue #504)
 * through `ProjectAccess.searchVisibleByLabel` — both rules in its one
 * statement — and describes the page as `describe` would.
 *
 * `renderNote` words the note a Stage Task leaves on a Task nobody was
 * assigned to: it is **stored as the Role** (`role:<id>`, {@link responsibleRoleNote}),
 * never as a sentence, so each reader sees it in their own language with the
 * Role's current name. Any other note is shown as stored.
 *
 * `existingContexts` tells the Tasks module's maintenance pass which Projects
 * still exist and which Stages each has, whoever may see them
 * (`specs/165-task-management/` R-19, issue #450): the Tasks of a Project
 * deleted while Tasks was off are then deleted, and those of a deleted Stage
 * lose it. Asked only in the system scope, answered by
 * `ProjectAccess.existingWithStages`. With Projects off it is never asked — the
 * registry does not enumerate this descriptor — so nothing is taken for gone.
 */

type ProjectLabelRow = { id: string; number: string; title: string };

const ROLE_NOTE = /^role:([0-9a-f-]{36})$/i;

/** The `contextNote` of a Stage Task's Task left unassigned: the responsible Role, as a key. */
export function responsibleRoleNote(roleId: string): string {
  return `role:${roleId}`;
}
export function createProjectTaskContext(deps: {
  access: ProjectAccess;
  emFactory: () => EntityManager;
  /** `_i18n`'s resolver over this module's bundles. */
  translate: (key: string, language: SupportedLanguage, params?: Record<string, string | number>) => Promise<string>;
}): TaskContextDescriptor {
  const { access, emFactory, translate } = deps;

  /** Each Project described — its label, address and Stages — with one read of the Stages. */
  async function withStages(projects: readonly ProjectLabelRow[]): Promise<TaskContextSearchHit[]> {
    if (projects.length === 0) return [];
    const stages = (await emFactory().execute(
      `select s."id", s."project_id", s."name" from "project_stages" s
        where s."project_id" = any(?::uuid[]) order by s."position", s."id"`,
      [uuidArray(projects.map((project) => project.id))],
    )) as Array<{ id: string; project_id: string; name: string }>;
    return projects.map((project) => ({
      id: project.id,
      description: {
        label: `${project.number} ${project.title}`,
        href: `/projects/${project.id}`,
        groups: new Map(stages.filter((s) => s.project_id === project.id).map((s) => [s.id, s.name])),
      },
    }));
  }
  return {
    contextType: PROJECT_TASK_CONTEXT_TYPE,
    ownerModuleId: 'projects',
    allVisibleContextIds: () => access.allVisibleIds(),
    visibleContextIds: (ids) => access.visibleIds(ids),
    // Another administrator — an assignee about to be told — by their own
    // reach, permissions and the visibility rule (research R-4).
    canSeeAs: (adminUserId, id) => access.canSeeAs(adminUserId, id),
    // Putting a Task into a Project, taking one out or deleting one is a change
    // to the Project's work: it needs `projects:write` and a Project the caller sees.
    // A Project merged into another one, or being merged away, takes no Task
    // (`specs/192-organization-merge/` FR-053): its Tasks have moved, or are
    // moving, to the survivor.
    canChangeTasks: async (id) => {
      if (!(await access.callerHolds(PROJECTS_WRITE_PERMISSION)) || mergeWriteRefusal('project', id) !== null) return false;
      const row = await access.findVisible(id);
      return row !== null && !row.merged_into_project_id;
    },
    existingContexts: (ids) => access.existingWithStages(ids),
    describe: async (ids) => {
      const visible = [...(await access.visibleIds(ids))];
      if (visible.length === 0) return new Map<string, TaskContextDescription>();
      const projects = (await emFactory().execute(
        `select p."id", p."number", p."title" from "projects" p where p."id" = any(?::uuid[])`,
        [uuidArray(visible)],
      )) as ProjectLabelRow[];
      return new Map((await withStages(projects)).map((hit) => [hit.id, hit.description]));
    },
    // The picker's page (issue #504): one search bounded by `limit` and one
    // read of those Projects' Stages — never every Project the caller sees.
    // `changeableOnly` is `canChangeTasks` for the page at once: every Project
    // the search returns is visible, so it is `projects:write` alone.
    search: async ({ q, limit, changeableOnly }) => {
      if (changeableOnly && !(await access.callerHolds(PROJECTS_WRITE_PERMISSION))) return [];
      return withStages(await access.searchVisibleByLabel(q, limit));
    },
    renderNote: async (note, language) => {
      const roleId = ROLE_NOTE.exec(note)?.[1];
      if (!roleId || !isUuid(roleId)) return note;
      const [role] = (await emFactory().execute(
        `select r."name", r."default_name" from "project_roles" r where r."id" = ?`,
        [roleId],
      )) as Array<{ name: Record<string, string>; default_name: string }>;
      // A Role deleted since is named by a dash, never by its id.
      const name = role ? pickLocalized(role.name, language) || role.default_name : '—';
      return translate('stageTasks.contextNote.responsibleRole', language, { role: name });
    },
  };
}
