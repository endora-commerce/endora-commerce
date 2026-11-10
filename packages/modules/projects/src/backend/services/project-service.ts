import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PROJECTS_EVENTS,
  type AdminUserReadPort,
  type CreateProjectBody,
  type CustomFieldValuePort,
  type OrganizationDetailsPort,
  type ProjectCreatedEvent,
  type ProjectDetail,
  type ProjectMemberInput,
  type ProjectOutOfReachAfterWrite,
  type ProjectStageInput,
  type UpdateProjectBody,
  roundHalfUp,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { randomUUID } from 'crypto';
import { enterStage, todayIn } from '../domain/deadline.js';
import { defaultLinearMoves, type StageMoveDef } from '../domain/stage-graph.js';
import { Project } from '../entities/project.entity.js';
import { ProjectMember } from '../entities/project-member.entity.js';
import { ProjectMemberRole } from '../entities/project-member-role.entity.js';
import { ProjectOrganization } from '../entities/project-organization.entity.js';
import { ProjectReference } from '../entities/project-reference.entity.js';
import { ProjectStage } from '../entities/project-stage.entity.js';
import { ProjectStageEntry } from '../entities/project-stage-entry.entity.js';
import { ProjectStageMove } from '../entities/project-stage-move.entity.js';
import { ProjectStageTask } from '../entities/project-stage-task.entity.js';
import { ProjectValueChange, type ProjectValueState } from '../entities/project-value-change.entity.js';
import { ProjectViewer } from '../entities/project-viewer.entity.js';
import { isDeepStrictEqual } from 'node:util';
import { newlyMentioned, type ProjectMentionService, type SavedProjectMentions } from './mention-service.js';
import type { ProjectAccess } from './project-access.js';
import { mergeProjectCustomFields } from './project-custom-fields.js';
import { tellAfterCommit } from './project-notifier.js';
import { nextProjectNumber } from './project-number.js';
import { assertRolesExist, lockRolesShared } from './role-locks.js';
import type { ProjectReadService } from './project-read-service.js';
import { PROJECT_TASK_CONTEXT_TYPE, type ProjectTasks } from './project-tasks.js';
import { storedReferencesOf, type ProjectReferenceService, type ProjectReferenceSource } from './reference-service.js';
import type { StageEntryPlan, StageTaskService } from './stage-task-service.js';
import { templateNotFound, type TemplateGraph, type TemplateService } from './template-service.js';

/**
 * A Project's own writes (`contracts/admin-api.md` §2.1, `data-model.md`
 * §2.4): create, edit, delete, its Organizations and its Members — each a
 * Command (Constitution XIII), one audit row per Command, `objectType:
 * 'project'`.
 *
 * Every write but creation starts from `ProjectAccess.loadVisible`, so a
 * Project the caller may not see answers 404 like a missing one; inside the
 * Command the Project row is locked and everything else is read by its id.
 * Every refusal happens before anything is written.
 *
 * **From a Template** (User Story 3, research R-7) a Project is given a copy
 * of the Template's Stages, workflow, gates, alerts, Stage Task definitions
 * and default description — its own rows, never a reference — and names the
 * Template as provenance. The body's own fields win; its `stages` are refused
 * beside a Template (the Template's are what is copied, edited afterwards on
 * the Project). A Role of the Template may be given to a Member even when it
 * has been archived since (spec edge case).
 *
 * **The first Stage** is entered by the create Command, which decides its
 * Stage Tasks as a move does (`stage-task-service.ts`): created after the
 * commit while Tasks is on, marked skipped while it is off.
 *
 * Removing an Organization a linked record belongs to is refused (409
 * `PROJECT_ORGANIZATION_IN_USE`, User Story 6): the link keeps its record's
 * Organization, under a foreign key into the Project's Organizations.
 *
 * **Custom Field values** (User Story 9, research R-18) are validated and
 * merged by `custom_fields` before the Command — a create by hand is always
 * held to the definitions, so a required field is asked for even when none is
 * sent — and written inside it: by the create Command, and on an edit by a
 * Command of their own, `projects.project.custom_fields_update`, so the trail
 * names a change of the fields apart from an edit of the text. The edit's bag
 * is merged against the Project as `loadVisible` read it; the Command holds
 * the Project to the version that read carried, and every write of the bag
 * bumps it, so a bag merged against stale values is never written.
 */

export interface ProjectServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: ProjectAccess;
  read: ProjectReadService;
  /** `organizations`' read port — lazy, resolved per call. */
  organizations: OrganizationDetailsPort;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
  tasks: ProjectTasks;
  /** The Template a Project is created from (User Story 3). */
  templates: TemplateService;
  /** The first Stage's Stage Tasks, decided in the create Command and created after it. */
  stageTasks: StageTaskService;
  /** The references a description carries — an index written by the Command that saves it (User Story 7). */
  references: Pick<ProjectReferenceService, 'rowsFor'>;
  /** Telling the people a description newly mentions, after the commit (FR-026). */
  mentions: Pick<ProjectMentionService, 'tell'>;
  /** `custom_fields`' value service — lazy, resolved per call (User Story 9). */
  customFields: CustomFieldValuePort;
}

export function projectChanged(): HttpError {
  return new HttpError(409, ERROR_CODES.PROJECT_CHANGED, 'The project changed since it was read. Reload it and try again.');
}

function memberInvalid(message: string): HttpError {
  return new HttpError(422, ERROR_CODES.PROJECT_MEMBER_INVALID, message);
}

/** A Member's Role deleted between the check and the write (issue #453). */
function memberRoleGone(): HttpError {
  return memberInvalid('A project role does not exist.');
}

/**
 * Lock a Project's row for the rest of the Command — writes on one Project run
 * one at a time — and ask again, under the lock, whether the caller may still
 * see it (T144 F3). `loadVisible` answered before the Command; another
 * administrator may have added an Organization out of the caller's reach, or
 * taken them off the Project, in between, and that is refused as if the
 * Project did not exist.
 *
 * `rule: 'reach'` asks the Organization rule alone — for the second and later
 * Commands of one request (`update`), which may follow the caller's own change
 * of who sees the Project: their own Command may take it out of their sight,
 * never out of their reach.
 */
export async function lockProject(
  em: EntityManager,
  access: Pick<ProjectAccess, 'assertVisibleUnderLock'>,
  id: string,
  rule: 'visible' | 'reach' = 'visible',
): Promise<Project> {
  const project = await lockProjectRow(em, id);
  await access.assertVisibleUnderLock(em, id, rule);
  return project;
}

/**
 * Lock a Project's row **without** asking whether the caller sees it — only
 * for the module's own bookkeeping of a write that already committed (a Stage
 * Task failure record), which must land whoever's sight the Project is in now.
 */
export async function lockProjectRow(em: EntityManager, id: string): Promise<Project> {
  const project = await em.findOne(Project, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
  // `loadVisible` found it a moment ago; a delete in between is a change too.
  if (!project) throw projectChanged();
  return project;
}

/**
 * The audit snapshot of a Project. The audit trail is the platform's and is not
 * tenant-scoped, so it carries no free text and no figure a tenant owns: the
 * description by its length only, and neither the title (owner ruling O-1,
 * 2026-11-10: a title is a value, #470), the value nor the custom-field
 * values at all — a write says *that* they changed ({@link changedValueKeys}),
 * never what to (T144 F4). The values go to the Project's own store, which its
 * history reads ({@link recordValueChange}, T145).
 */
function snapshot(project: Project): Record<string, unknown> {
  return {
    number: project.number,
    state: project.state,
    startOn: project.startOn ?? null,
    visibility: project.visibility,
    descriptionLength: project.description.length,
    version: project.version,
  };
}

/** The values a write may change that the trail does not carry: the title (O-1) and the value. */
type ValueSide = Pick<Project, 'valueAmount' | 'valueCurrency'> & { title?: string | null };

const NO_VALUE: ValueSide = { valueAmount: null, valueCurrency: null, title: null };

/**
 * An amount as `numeric(18,2)` stores and prints it — `1234.5` typed is
 * `1234.50` (T145): what a value change records and compares. The request
 * schema has already refused more than two places, so this pads and never rounds.
 */
function storedAmount(amount: string | null | undefined): string | null {
  return amount === null || amount === undefined ? null : roundHalfUp(amount, 2);
}

/**
 * What a write changed among the values the trail does not carry: `changedFields`
 * (`value`) and `changedCustomFields` (the keys whose value differs), each only
 * when non-empty.
 */
function changedValueKeys(
  value: { before: ValueSide; after: ValueSide } | null,
  customFields: { before: Record<string, unknown>; after: Record<string, unknown> } | null,
): { changedFields?: string[]; changedCustomFields?: string[] } {
  const out: { changedFields?: string[]; changedCustomFields?: string[] } = {};
  const fields: string[] = [];
  if (value && (value.before.title ?? null) !== (value.after.title ?? null)) fields.push('title');
  if (
    value &&
    (storedAmount(value.before.valueAmount) !== storedAmount(value.after.valueAmount) ||
      (value.before.valueCurrency ?? null) !== (value.after.valueCurrency ?? null))
  ) {
    fields.push('value');
  }
  if (fields.length > 0) out.changedFields = fields;
  if (customFields) {
    const keys = [...new Set([...Object.keys(customFields.before), ...Object.keys(customFields.after)])]
      .filter((key) => !isDeepStrictEqual(customFields.before[key], customFields.after[key]))
      .sort();
    if (keys.length > 0) out.changedCustomFields = keys;
  }
  return out;
}

/**
 * The audit keys of a write that may change a Project's values — and, when it
 * did, the values themselves kept in the Project's own store (T145, #470): a
 * {@link ProjectValueChange} row in the Command's transaction, which the audit
 * entry points at by `valueChangeId`. The audit trail gets the names only; the
 * Project's history serves the values from the row. `before` is `null` for a
 * create (`value.before === null`).
 */
function recordValueChange(
  em: EntityManager,
  projectId: string,
  value: { before: ValueSide | null; after: ValueSide } | null,
  customFields: { before: Record<string, unknown>; after: Record<string, unknown> } | null,
): { changedFields?: string[]; changedCustomFields?: string[]; valueChangeId?: string } {
  const created = value !== null && value.before === null;
  const keys = changedValueKeys(value && { before: value.before ?? NO_VALUE, after: value.after }, customFields);
  if (!keys.changedFields && !keys.changedCustomFields) return keys;
  const before: ProjectValueState = {};
  const after: ProjectValueState = {};
  if (keys.changedFields?.includes('title') && value) {
    before.title = value.before?.title ?? null;
    after.title = value.after.title ?? null;
  }
  if (keys.changedFields?.includes('value') && value) {
    before.valueAmount = storedAmount(value.before?.valueAmount);
    before.valueCurrency = value.before?.valueCurrency ?? null;
    after.valueAmount = storedAmount(value.after.valueAmount);
    after.valueCurrency = value.after.valueCurrency ?? null;
  }
  if (keys.changedCustomFields && customFields) {
    const side = (values: Record<string, unknown>) =>
      Object.fromEntries(keys.changedCustomFields!.map((key) => [key, values[key] ?? null]));
    before.customFieldValues = side(customFields.before);
    after.customFieldValues = side(customFields.after);
  }
  const row = em.create(ProjectValueChange, { projectId, before: created ? null : before, after });
  return { ...keys, valueChangeId: row.id };
}

export class ProjectService {
  constructor(private readonly deps: ProjectServiceDeps) {}

  /** `POST /projects` — the Project in its first Stage, with Organizations, Members and workflow. */
  async create(body: CreateProjectBody, language: string): Promise<ProjectDetail> {
    let template: TemplateGraph | null = null;
    if (body.templateId) {
      if (body.stages) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'A project created from a template takes the template’s stages; change them on the project afterwards.',
        );
      }
      template = await this.deps.templates.forCopy(body.templateId);
      if (!template) throw templateNotFound(422);
    }
    const stages: StageToCreate[] = template
      ? stagesFromTemplate(template)
      : (body.stages ?? []).map((stage) => ({ ...stage, tasks: [] }));
    if (stages.length === 0) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A project needs at least one stage.');
    }
    await this.#assertOrganizations(body.organizationIds);
    const members = body.members ?? [];
    await this.#assertMembers(members, new Map(), new Set(template?.roleIds ?? []));
    const viewerIds = body.viewerIds ?? [];
    await this.#assertAdmins(viewerIds, 'A listed person must be an active administrator.');
    await this.#assertRolesExist(stages.flatMap((stage) => stage.responsibleRoleIds ?? []));
    const customFieldValues = await mergeProjectCustomFields(this.deps.customFields, {}, body.customFieldValues ?? {});
    const today = todayIn(await this.deps.read.timeZone());
    const tasksPresent = this.deps.tasks.present();
    let plan: StageEntryPlan = { materialize: false, notes: [] };
    let entryId = '';
    let firstStageId = '';

    const id = randomUUID();
    const created: { mentions: SavedProjectMentions | null } = { mentions: null };
    await this.deps.commandBus.run({
      action: 'projects.project.create',
      objectType: 'project',
      objectId: id,
      run: async ({ em, actor }) => {
        if (actor.actorAdminUserId === null) {
          // `created_by_admin_user_id` is not null: a Project is somebody's.
          throw new Error('projects: a Project is created by an administrator; the ambient actor is none.');
        }
        // Issue #453 — the Roles its Stages, Stage Tasks and Members name, held
        // against a delete, and asked again to exist.
        const memberRoleIds = members.flatMap((member) => member.roleIds);
        await lockRolesShared(em as EntityManager, [...stageRoleIds(stages), ...memberRoleIds]);
        await assertRolesExist(em as EntityManager, stageRoleIds(stages));
        await assertRolesExist(em as EntityManager, memberRoleIds, memberRoleGone);
        const project = em.create(Project, {
          id,
          number: await nextProjectNumber(em),
          title: body.title,
          description: body.description ?? template?.description ?? '',
          valueAmount: body.value?.amount ?? null,
          valueCurrency: body.value?.currency ?? null,
          ...(body.startOn ? { startOn: body.startOn } : { startOn: today }),
          visibility: body.visibility ?? 'inherit',
          templateId: template?.id ?? null,
          customFieldValues,
          createdByAdminUserId: actor.actorAdminUserId,
        });
        // Flushed in the order of the foreign keys: these entities hold each
        // other's ids as values, not relations, so the unit of work cannot
        // order the inserts itself. The Project first, its Stages next, then
        // what refers to them, and the Project points at its first Stage last:
        // the current-Stage key is checked per statement, the "open Project
        // has a Stage" trigger at commit.
        await em.flush();
        // The description's references, an index written with it (User Story 7).
        await this.#saveReferences(
          em as EntityManager,
          { projectId: id, kind: 'description', sourceId: null },
          project.description,
        );
        created.mentions = { projectId: id, number: project.number, adminUserIds: newlyMentioned(null, project.description) };
        const rows = stages.map((stage, index) =>
          em.create(ProjectStage, {
            projectId: id,
            name: stage.name,
            color: stage.color,
            position: index + 1,
            plannedDurationDays: stage.plannedDurationDays ?? 0,
            responsibleRoleIds: stage.responsibleRoleIds ?? [],
            alertOffsetsDays: stage.alertOffsetsDays ?? [],
            completionGate: stage.completionGate ?? false,
            completionPermitted: stage.completionPermitted ?? index === stages.length - 1,
          }),
        );
        const first = rows[0]!;
        firstStageId = first.id;
        Object.assign(first, enterStage({ ...first, startedOn: null, deadlineOn: null }, today));
        await em.flush();
        const moves = template ? copiedMoves(template, rows) : defaultLinearMoves(rows);
        for (const move of moves) em.create(ProjectStageMove, { projectId: id, ...move });
        stages.forEach((stage, index) => {
          stage.tasks.forEach((task, at) =>
            em.create(ProjectStageTask, {
              stageId: rows[index]!.id,
              title: task.title,
              description: task.description,
              responsibleRoleId: task.responsibleRoleId,
              dueOffsetDays: task.dueOffsetDays,
              position: at + 1,
            }),
          );
        });
        for (const organizationId of body.organizationIds) em.create(ProjectOrganization, { projectId: id, organizationId });
        const memberRows = members.map((member) =>
          em.create(ProjectMember, { projectId: id, adminUserId: member.adminUserId }),
        );
        for (const adminUserId of viewerIds) em.create(ProjectViewer, { projectId: id, adminUserId });
        await em.flush();
        plan = await this.deps.stageTasks.planEntry(em as EntityManager, first, tasksPresent);
        const entry = em.create(ProjectStageEntry, {
          projectId: id,
          kind: 'enter',
          fromStageId: null,
          toStageId: first.id,
          fromStageName: null,
          toStageName: first.name,
          notes: plan.notes,
          actorAdminUserId: actor.actorAdminUserId,
        });
        entryId = entry.id;
        await em.flush();
        members.forEach((member, index) => {
          for (const roleId of member.roleIds) em.create(ProjectMemberRole, { memberId: memberRows[index]!.id, roleId });
        });
        project.currentStageId = first.id;
        return {
          result: id,
          after: {
            ...snapshot(project),
            organizationIds: body.organizationIds,
            members: members.map((m) => ({ adminUserId: m.adminUserId, roleIds: m.roleIds })),
            viewerIds,
            stages: rows.map((stage) => stage.name),
            templateId: template?.id ?? null,
            ...recordValueChange(em as EntityManager, id, { before: null, after: project }, { before: {}, after: customFieldValues }),
          },
        };
      },
      event: (projectId) => {
        const payload: ProjectCreatedEvent = {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          projectId,
          templateId: template?.id ?? null,
        };
        return { eventName: PROJECTS_EVENTS.PROJECT_CREATED, payload };
      },
    });
    if (plan.materialize) await this.deps.stageTasks.materializeAfterCommit(id, firstStageId, entryId);
    if (created.mentions) await this.#tellMentioned(created.mentions);
    return this.deps.read.afterWrite(id, language);
  }

  /**
   * `PATCH /projects/:id` — title, description, value and start date, and who
   * sees the Project (User Story 5), against `version`.
   *
   * Up to four Commands, each only when it changes something, in this order:
   * `projects.project.update` (the fields), `.custom_fields_update`,
   * `.visibility_set` and `.viewers_set` — so the trail names a change of who
   * sees a Project, and of its custom fields, apart from an edit of its text. Every refusal is checked before the first; each
   * Command locks the Project and checks the version the one before left, and
   * bumps it.
   */
  async update(id: string, body: UpdateProjectBody, language: string): Promise<ProjectDetail> {
    const visible = await this.deps.access.loadVisible(id);
    if (visible.version !== body.version) throw projectChanged();
    const storedValues = visible.custom_field_values ?? {};
    const customFieldValues = await mergeProjectCustomFields(this.deps.customFields, storedValues, body.customFieldValues);
    const customFieldsChange = !isDeepStrictEqual(customFieldValues, storedValues);
    const currentViewers = (
      (await this.deps.emFactory().execute(
        `select v."admin_user_id" from "project_viewers" v where v."project_id" = ?`,
        [visible.id],
      )) as Array<{ admin_user_id: string }>
    ).map((row) => row.admin_user_id);
    const viewerIds = body.viewerIds === undefined ? null : [...new Set(body.viewerIds)];
    const viewersChange = viewerIds !== null && !sameSet(viewerIds, currentViewers);
    if (viewersChange) {
      // Only somebody newly listed must be active: a person listed before and
      // deactivated since does not stop the Project being saved.
      await this.#assertAdmins(
        viewerIds.filter((adminUserId) => !currentViewers.includes(adminUserId)),
        'A listed person must be an active administrator.',
      );
    }
    const fieldsChange =
      body.title !== undefined || body.description !== undefined || body.value !== undefined || body.startOn !== undefined;
    const visibilityChange = body.visibility !== undefined && body.visibility !== visible.visibility;

    let expected = body.version;
    let first = true;
    const described: { mentions: SavedProjectMentions | null } = { mentions: null };
    /**
     * Lock the Project, hold it to the version the previous Command left, and
     * bump it. The first Command asks both rules again under its lock; a later
     * one the Organization rule only — the one before may have been the
     * caller's own change of who sees the Project.
     */
    const claim = async (em: EntityManager): Promise<Project> => {
      const project = await lockProject(em, this.deps.access, visible.id, first ? 'visible' : 'reach');
      first = false;
      if (project.version !== expected) throw projectChanged();
      return project;
    };
    const bumped = (project: Project): void => {
      project.version += 1;
      expected = project.version;
    };

    if (fieldsChange) {
      await this.deps.commandBus.run({
        action: 'projects.project.update',
        objectType: 'project',
        objectId: visible.id,
        run: async ({ em }) => {
          const project = await claim(em as EntityManager);
          const before = snapshot(project);
          const valueBefore = {
            valueAmount: project.valueAmount ?? null,
            valueCurrency: project.valueCurrency ?? null,
            title: project.title,
          };
          if (body.title !== undefined) project.title = body.title;
          if (body.description !== undefined && body.description !== project.description) {
            described.mentions = {
              projectId: visible.id,
              number: project.number,
              adminUserIds: newlyMentioned(project.description, body.description),
            };
            project.description = body.description;
            await this.#saveReferences(
              em as EntityManager,
              { projectId: visible.id, kind: 'description', sourceId: null },
              project.description,
            );
          }
          if (body.value !== undefined) {
            project.valueAmount = body.value?.amount ?? null;
            project.valueCurrency = body.value?.currency ?? null;
          }
          if (body.startOn !== undefined) project.startOn = body.startOn;
          bumped(project);
          return {
            result: null,
            before,
            after: {
              ...snapshot(project),
              ...recordValueChange(em as EntityManager, visible.id, { before: valueBefore, after: project }, null),
            },
          };
        },
      });
    }
    if (customFieldsChange) {
      await this.deps.commandBus.run({
        action: 'projects.project.custom_fields_update',
        objectType: 'project',
        objectId: visible.id,
        run: async ({ em }) => {
          // The version is what holds the bag to the one merged above: every
          // write of the bag bumps it.
          const project = await claim(em as EntityManager);
          const before = { ...(project.customFieldValues ?? {}) };
          project.customFieldValues = customFieldValues;
          bumped(project);
          // The audit trail names the fields; their values go to the Project's own store (T144 F4, T145).
          return {
            result: null,
            before: null,
            after: recordValueChange(em as EntityManager, visible.id, null, { before, after: customFieldValues }),
          };
        },
      });
    }
    if (visibilityChange) {
      await this.deps.commandBus.run({
        action: 'projects.project.visibility_set',
        objectType: 'project',
        objectId: visible.id,
        run: async ({ em }) => {
          const project = await claim(em as EntityManager);
          const before = { visibility: project.visibility };
          project.visibility = body.visibility!;
          bumped(project);
          return { result: null, before, after: { visibility: project.visibility } };
        },
      });
    }
    if (viewersChange) {
      await this.deps.commandBus.run({
        action: 'projects.project.viewers_set',
        objectType: 'project',
        objectId: visible.id,
        run: async ({ em }) => {
          const project = await claim(em as EntityManager);
          const before = (
            (await em.execute(`select v."admin_user_id" from "project_viewers" v where v."project_id" = ?`, [
              visible.id,
            ])) as Array<{ admin_user_id: string }>
          )
            .map((row) => row.admin_user_id)
            .sort();
          await em.nativeDelete(ProjectViewer, { projectId: visible.id });
          for (const adminUserId of viewerIds) em.create(ProjectViewer, { projectId: visible.id, adminUserId });
          bumped(project);
          return { result: null, before: { viewerIds: before }, after: { viewerIds: [...viewerIds].sort() } };
        },
      });
    }
    if (described.mentions) await this.#tellMentioned(described.mentions);
    return this.deps.read.afterWrite(visible.id, language);
  }

  /**
   * Replace the stored references of the description with those its text
   * carries now. **Call it inside the Command that saves the text, with that
   * Command's EntityManager, for a Project it created or loaded through
   * `ProjectAccess`** — the rows are written by that Project's id only.
   */
  async #saveReferences(em: EntityManager, source: ProjectReferenceSource, text: string | null | undefined): Promise<void> {
    await em.nativeDelete(ProjectReference, storedReferencesOf(source));
    for (const row of this.deps.references.rowsFor(source, text)) em.create(ProjectReference, row);
  }

  /** Tell the people a committed description newly mentions — a failure costs the save nothing. */
  async #tellMentioned(saved: SavedProjectMentions): Promise<void> {
    if (saved.adminUserIds.length === 0) return;
    await tellAfterCommit(saved.projectId, async () => {
      await this.deps.mentions.tell(saved);
    });
  }

  /** `DELETE /projects/:id` — refused while records are linked (FR-021). */
  async delete(id: string): Promise<void> {
    const visible = await this.deps.access.loadVisible(id);
    await this.deps.commandBus.run({
      action: 'projects.project.delete',
      objectType: 'project',
      objectId: visible.id,
      run: async ({ em }) => {
        const project = await lockProject(em, this.deps.access, visible.id);
        const links = (await em.execute(
          `select count(*)::int as "n" from "project_links" l where l."project_id" = ?`,
          [project.id],
        )) as Array<{ n: number }>;
        if (Number(links[0]?.n ?? 0) > 0) {
          throw new HttpError(409, ERROR_CODES.PROJECT_HAS_LINKS, 'Unlink the records of this project before deleting it.');
        }
        const before = snapshot(project);
        // Its Stages, Members, history and everything else it owns go with it
        // (`on delete cascade`).
        em.remove(project);
        return { result: null, before, after: null };
      },
    });
    // Its Tasks go with it too (spec edge case) — after the commit, through
    // the Tasks module's own Commands. With Tasks off they stay, belonging to
    // a Project nobody can see, and so are hidden by the Tasks module, whose
    // maintenance pass deletes them once it is back on (`existingContexts`, #450).
    if (this.deps.tasks.present()) {
      await this.deps.tasks.write.deleteInContext({ contextType: PROJECT_TASK_CONTEXT_TYPE, contextId: visible.id });
    }
  }

  /**
   * `PUT /projects/:id/organizations` — the whole set. One Command per
   * Organization added or removed, so the trail names each; every refusal is
   * checked before the first.
   *
   * A caller confined to some Organizations who removes them all makes the
   * Project internal, and so out of their own reach: the change stands, and
   * the answer says only that (T144 F3).
   */
  async setOrganizations(
    id: string,
    organizationIds: readonly string[],
    language: string,
  ): Promise<ProjectDetail | ProjectOutOfReachAfterWrite> {
    const visible = await this.deps.access.loadVisible(id);
    const current = (
      (await this.deps.emFactory().execute(
        `select po."organization_id" from "project_organizations" po where po."project_id" = ?`,
        [visible.id],
      )) as Array<{ organization_id: string }>
    ).map((row) => row.organization_id);
    const added = organizationIds.filter((orgId) => !current.includes(orgId));
    const removed = current.filter((orgId) => !organizationIds.includes(orgId));
    await this.#assertOrganizations(added);
    if (await hasLinksOf(this.deps.emFactory(), visible.id, removed)) throw organizationInUse();

    for (const organizationId of added) {
      await this.deps.commandBus.run({
        action: 'projects.project.organization_add',
        objectType: 'project',
        objectId: visible.id,
        run: async ({ em }) => {
          await lockProject(em, this.deps.access, visible.id);
          const inserted = (await em.execute(
            `insert into "project_organizations" ("project_id", "organization_id") values (?, ?)
             on conflict do nothing returning "organization_id"`,
            [visible.id, organizationId],
          )) as unknown[];
          if (inserted.length === 0) return { result: null, skipAudit: true };
          return { result: null, before: null, after: { organizationId } };
        },
      });
    }
    for (const organizationId of removed) {
      await this.deps.commandBus.run({
        action: 'projects.project.organization_remove',
        objectType: 'project',
        objectId: visible.id,
        run: async ({ em }) => {
          await lockProject(em, this.deps.access, visible.id);
          // Again under the lock — a link may have been made since; the
          // foreign key from `project_links` is the schema's own answer.
          if (await hasLinksOf(em as EntityManager, visible.id, [organizationId])) throw organizationInUse();
          const deleted = await em.nativeDelete(ProjectOrganization, { projectId: visible.id, organizationId });
          if (deleted === 0) return { result: null, skipAudit: true };
          return { result: null, before: { organizationId }, after: null };
        },
      });
    }
    if (!(await this.deps.access.inReachAfterWrite(visible.id))) return { id: visible.id, outOfReach: true };
    return this.deps.read.afterWrite(visible.id, language);
  }

  /** `PUT /projects/:id/members` — the whole set, Members and their Roles, in one Command. */
  async setMembers(id: string, members: readonly ProjectMemberInput[], language: string): Promise<ProjectDetail> {
    const visible = await this.deps.access.loadVisible(id);
    const em = this.deps.emFactory();
    const held = (await em.execute(
      `select pm."admin_user_id", pmr."role_id" from "project_members" pm
         join "project_member_roles" pmr on pmr."member_id" = pm."id"
        where pm."project_id" = ?`,
      [visible.id],
    )) as Array<{ admin_user_id: string; role_id: string }>;
    const heldRoles = new Map<string, Set<string>>();
    for (const row of held) {
      heldRoles.set(row.admin_user_id, (heldRoles.get(row.admin_user_id) ?? new Set()).add(row.role_id));
    }
    await this.#assertMembers(members, heldRoles);

    await this.deps.commandBus.run({
      action: 'projects.project.member_set',
      objectType: 'project',
      objectId: visible.id,
      run: async ({ em: tx }) => {
        await lockProject(tx, this.deps.access, visible.id);
        // Issue #453 — the Roles the Members hold, held against a delete and asked again.
        const memberRoleIds = members.flatMap((member) => member.roleIds);
        await lockRolesShared(tx as EntityManager, memberRoleIds);
        await assertRolesExist(tx as EntityManager, memberRoleIds, memberRoleGone);
        const rows = (await tx.execute(
          `select pm."id", pm."admin_user_id", coalesce(array_agg(pmr."role_id") filter (where pmr."role_id" is not null), '{}') as "role_ids"
             from "project_members" pm left join "project_member_roles" pmr on pmr."member_id" = pm."id"
            where pm."project_id" = ? group by pm."id", pm."admin_user_id"`,
          [visible.id],
        )) as Array<{ id: string; admin_user_id: string; role_ids: string[] | string }>;
        const before = rows.map((row) => ({
          adminUserId: row.admin_user_id,
          roleIds: (Array.isArray(row.role_ids) ? row.role_ids : String(row.role_ids).replace(/^\{|\}$/g, '').split(',')).filter(Boolean).sort(),
        }));
        const wanted = new Map(members.map((member) => [member.adminUserId, member.roleIds]));
        for (const row of rows) {
          if (!wanted.has(row.admin_user_id)) {
            await tx.nativeDelete(ProjectMember, { id: row.id });
            continue;
          }
          await tx.nativeDelete(ProjectMemberRole, { memberId: row.id });
          for (const roleId of wanted.get(row.admin_user_id)!) tx.create(ProjectMemberRole, { memberId: row.id, roleId });
          wanted.delete(row.admin_user_id);
        }
        const added = [...wanted].map(([adminUserId, roleIds]) => ({
          member: tx.create(ProjectMember, { projectId: visible.id, adminUserId }),
          roleIds,
        }));
        // A Member's row before its Roles' (see `create`).
        await tx.flush();
        for (const { member, roleIds } of added) {
          for (const roleId of roleIds) tx.create(ProjectMemberRole, { memberId: member.id, roleId });
        }
        return {
          result: null,
          before: { members: before },
          after: { members: members.map((m) => ({ adminUserId: m.adminUserId, roleIds: [...m.roleIds].sort() })) },
        };
      },
    });
    return this.deps.read.afterWrite(visible.id, language);
  }

  /**
   * Each Organization exists and is in the caller's reach (FR-004). The two are
   * one refusal: telling them apart would confirm an Organization exists to
   * somebody who may not see it.
   */
  async #assertOrganizations(organizationIds: readonly string[]): Promise<void> {
    if (organizationIds.length === 0) return;
    const outOfScope = () =>
      new HttpError(
        422,
        ERROR_CODES.PROJECT_ORGANIZATION_OUT_OF_SCOPE,
        'An organization of this project is not available to you.',
      );
    if (organizationIds.some((orgId) => !this.deps.access.isOrgInScope(orgId))) throw outOfScope();
    const found = await this.deps.organizations.findByIds(organizationIds);
    if (found.length !== new Set(organizationIds).size) throw outOfScope();
  }

  /** Every id names an active administrator. */
  async #assertAdmins(adminUserIds: readonly string[], message: string): Promise<void> {
    const ids = [...new Set(adminUserIds)];
    if (ids.length === 0) return;
    const found = await this.deps.adminUsers.findByIds(ids, { activeOnly: true });
    const active = new Set(found.filter((a) => a.status === 'active' && a.deletedAt === null).map((a) => a.id));
    if (ids.some((adminUserId) => !active.has(adminUserId))) throw memberInvalid(message);
  }

  /**
   * Members are active administrators, and each Role exists and is not
   * archived — unless the Member already holds it here: an archived Role stays
   * on the Projects that use it (US4 sc.2), it is only not handed out again —
   * or the Template the Project is created from names it (spec edge case "A
   * Template whose Role has been archived").
   */
  async #assertMembers(
    members: readonly ProjectMemberInput[],
    heldRoles: Map<string, Set<string>>,
    templateRoles: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    await this.#assertAdmins(
      members.map((member) => member.adminUserId),
      'A member must be an active administrator.',
    );
    const roleIds = [...new Set(members.flatMap((member) => member.roleIds))];
    if (roleIds.length === 0) return;
    const rows = (await this.deps.emFactory().execute(
      `select r."id", r."archived_at" from "project_roles" r where r."id" = any(?::uuid[])`,
      [`{${roleIds.join(',')}}`],
    )) as Array<{ id: string; archived_at: Date | null }>;
    const archived = new Map(rows.map((row) => [row.id, row.archived_at !== null]));
    for (const member of members) {
      for (const roleId of member.roleIds) {
        if (!archived.has(roleId)) throw memberInvalid('A project role does not exist.');
        if (archived.get(roleId) && !heldRoles.get(member.adminUserId)?.has(roleId) && !templateRoles.has(roleId)) {
          throw memberInvalid('An archived project role is not handed out again.');
        }
      }
    }
  }

  /** The responsible Roles of a Stage exist. */
  async #assertRolesExist(roleIds: readonly string[]): Promise<void> {
    await assertRolesExist(this.deps.emFactory(), roleIds);
  }
}

function organizationInUse(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.PROJECT_ORGANIZATION_IN_USE,
    'A record of this organization is linked to the project. Unlink it before removing the organization.',
  );
}

/** Whether a record of any of `organizationIds` is linked to the Project (spec edge case, FR-021). */
async function hasLinksOf(em: EntityManager, projectId: string, organizationIds: readonly string[]): Promise<boolean> {
  if (organizationIds.length === 0) return false;
  const rows = (await em.execute(
    `select 1 as "one" from "project_links" l where l."project_id" = ? and l."organization_id" = any(?::uuid[]) limit 1`,
    [projectId, `{${organizationIds.join(',')}}`],
  )) as unknown[];
  return rows.length > 0;
}

export { assertRolesExist } from './role-locks.js';

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/** Every Role a Project's new Stages and their Stage Tasks name. */
function stageRoleIds(stages: readonly StageToCreate[]): string[] {
  return stages.flatMap((stage) => [
    ...(stage.responsibleRoleIds ?? []),
    ...stage.tasks.flatMap((task) => (task.responsibleRoleId ? [task.responsibleRoleId] : [])),
  ]);
}

/** A Stage the create Command writes, with the Stage Task definitions it is given. */
type StageToCreate = ProjectStageInput & { tasks: TemplateGraph['stages'][number]['tasks'] };

/** A Template's Stages as the Project's own (R-7): every attribute, explicit, and their Stage Tasks. */
function stagesFromTemplate(template: TemplateGraph): StageToCreate[] {
  return template.stages.map((stage) => ({
    name: stage.name,
    color: stage.color,
    plannedDurationDays: stage.plannedDurationDays,
    responsibleRoleIds: stage.responsibleRoleIds,
    alertOffsetsDays: stage.alertOffsetsDays,
    completionGate: stage.completionGate,
    completionPermitted: stage.completionPermitted,
    tasks: stage.tasks,
  }));
}

/** The Template's moves between the Project's copies of its Stages — the n-th Stage is the n-th copy. */
function copiedMoves(template: TemplateGraph, rows: readonly ProjectStage[]): StageMoveDef[] {
  const copyOf = new Map(template.stages.map((stage, index) => [stage.id, rows[index]!.id]));
  return template.moves
    .filter((move) => copyOf.has(move.fromStageId) && copyOf.has(move.toStageId))
    .map((move) => ({ fromStageId: copyOf.get(move.fromStageId)!, toStageId: copyOf.get(move.toStageId)! }));
}
