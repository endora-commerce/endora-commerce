import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PROJECT_TEMPLATE_NAME_MAX,
  type ProjectTemplateBody,
  type ProjectTemplateDetail,
  type ProjectTemplateSummary,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { randomUUID } from 'crypto';
import { defaultLinearMoves } from '../domain/stage-graph.js';
import { ProjectTemplate } from '../entities/project-template.entity.js';
import { ProjectTemplateRole } from '../entities/project-template-role.entity.js';
import { ProjectTemplateStage } from '../entities/project-template-stage.entity.js';
import { ProjectTemplateStageMove } from '../entities/project-template-stage-move.entity.js';
import { ProjectTemplateStageTask } from '../entities/project-template-stage-task.entity.js';
import { isUuid, uuidArray } from './project-access.js';
import { assertRolesExist } from './project-service.js';
import { lockRolesForWrite } from './role-locks.js';

/**
 * Project Templates (`specs/163-projects-and-tasks/`, User Story 3;
 * `contracts/admin-api.md` §2.5; research R-7).
 *
 * A Template is a reusable structure — default description, Project Roles,
 * Stages with their attributes and Stage Task definitions, and the permitted
 * moves between them — and nothing a running Project has: no Organization,
 * Member, value, date or link. It is **copied** into a Project when one is
 * created from it (`project-service.ts`), never referenced, so editing,
 * archiving or deleting it changes no Project.
 *
 * Every write is one Command with `objectType: 'project_template'`:
 * `projects.template.create`, `.save` (the whole graph replaced, `PUT`),
 * `.duplicate`, `.archive`, `.restore`. Every refusal is checked before the
 * Command. Templates are platform-wide configuration (`@GlobalEntity`), read
 * by id directly — no Organization reach applies to them.
 *
 * **Stage ids.** In the body a Stage is named by a `key`; a key that is the id
 * of one of this Template's Stages keeps that id, any other key gets a new one.
 * Moves name Stages by key, so a move can name a Stage that has no id yet.
 */

export interface TemplateServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** `_i18n`'s resolver over this module's bundles — a duplicate's name in the reader's language. */
  translate: (key: string, language: SupportedLanguage, params?: Record<string, string | number>) => Promise<string>;
}

/** A Template's whole graph as the copy into a Project reads it (R-7). */
export interface TemplateGraph {
  id: string;
  name: string;
  description: string;
  roleIds: string[];
  stages: Array<{
    id: string;
    name: string;
    color: string;
    position: number;
    plannedDurationDays: number;
    responsibleRoleIds: string[];
    alertOffsetsDays: number[];
    completionGate: boolean;
    completionPermitted: boolean;
    tasks: Array<{
      id: string;
      title: string;
      description: string;
      responsibleRoleId: string | null;
      dueOffsetDays: number;
      position: number;
    }>;
  }>;
  moves: Array<{ fromStageId: string; toStageId: string }>;
}

export function templateNotFound(status: 404 | 422 = 404): HttpError {
  return new HttpError(
    status,
    ERROR_CODES.PROJECT_TEMPLATE_NOT_FOUND,
    status === 404 ? 'No such project template.' : 'This template does not exist or is archived.',
  );
}

function invalid(message: string): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, message);
}

/** The audit snapshot of a Template — its structure, no description text. */
function snapshot(graph: TemplateGraph, archivedAt: Date | null = null): Record<string, unknown> {
  return {
    name: graph.name,
    descriptionLength: graph.description.length,
    roleIds: graph.roleIds,
    stages: graph.stages.map((stage) => ({ name: stage.name, stageTaskCount: stage.tasks.length })),
    moveCount: graph.moves.length,
    archived: archivedAt !== null,
  };
}

/** Read a Template's graph with `em`; `null` when it does not exist. */
export async function readTemplateGraph(em: EntityManager, id: string): Promise<(TemplateGraph & { archivedAt: Date | null; createdAt: Date; updatedAt: Date }) | null> {
  if (!isUuid(id)) return null;
  const template = await em.findOne(ProjectTemplate, { id }, { refresh: true });
  if (!template) return null;
  const [roles, stages, moves] = await Promise.all([
    em.find(ProjectTemplateRole, { templateId: id }),
    em.find(ProjectTemplateStage, { templateId: id }, { orderBy: { position: 'asc', id: 'asc' }, refresh: true }),
    em.find(ProjectTemplateStageMove, { templateId: id }),
  ]);
  const tasks =
    stages.length > 0
      ? await em.find(
          ProjectTemplateStageTask,
          { templateStageId: { $in: stages.map((stage) => stage.id) } },
          { orderBy: { position: 'asc', id: 'asc' }, refresh: true },
        )
      : [];
  const positionOf = new Map(stages.map((stage) => [stage.id, stage.position]));
  // Roles in the dictionary's order, so a read is stable.
  const roleOrder = roles.length
    ? ((await em.execute(`select r."id" from "project_roles" r where r."id" = any(?::uuid[]) order by r."position", r."id"`, [
        uuidArray(roles.map((role) => role.roleId)),
      ])) as Array<{ id: string }>)
    : [];
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    roleIds: roleOrder.map((row) => row.id),
    archivedAt: template.archivedAt ?? null,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    stages: stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      color: stage.color,
      position: stage.position,
      plannedDurationDays: stage.plannedDurationDays,
      responsibleRoleIds: [...stage.responsibleRoleIds],
      alertOffsetsDays: [...stage.alertOffsetsDays],
      completionGate: stage.completionGate,
      completionPermitted: stage.completionPermitted,
      tasks: tasks
        .filter((task) => task.templateStageId === stage.id)
        .map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          responsibleRoleId: task.responsibleRoleId ?? null,
          dueOffsetDays: task.dueOffsetDays,
          position: task.position,
        })),
    })),
    moves: moves
      .map((move) => ({ fromStageId: move.fromStageId, toStageId: move.toStageId }))
      .sort(
        (a, b) =>
          (positionOf.get(a.fromStageId) ?? 0) - (positionOf.get(b.fromStageId) ?? 0) ||
          (positionOf.get(a.toStageId) ?? 0) - (positionOf.get(b.toStageId) ?? 0),
      ),
  };
}

/** The Roles a Template body's Stages and Stage Tasks name as responsible. */
function stageRolesNamedBy(body: ProjectTemplateBody): string[] {
  return [
    ...body.stages.flatMap((stage) => stage.responsibleRoleIds ?? []),
    ...body.stages.flatMap((stage) => (stage.tasks ?? []).map((task) => task.responsibleRoleId).filter((r): r is string => !!r)),
  ];
}

/** Every Role a Template body names: its own, and its Stages' and Stage Tasks'. */
function rolesNamedBy(body: ProjectTemplateBody): string[] {
  return [...(body.roleIds ?? []), ...stageRolesNamedBy(body)];
}

export class TemplateService {
  constructor(private readonly deps: TemplateServiceDeps) {}

  /** `GET /projects/templates` — by name; `activeOnly` leaves archived ones out (what the create screen offers). */
  async list(activeOnly: boolean): Promise<ProjectTemplateSummary[]> {
    const rows = (await this.deps.emFactory().execute(
      `select t."id", t."name", t."archived_at", t."updated_at",
              (select count(*)::int from "project_template_stages" s where s."template_id" = t."id") as "stage_count"
         from "project_templates" t
        ${activeOnly ? 'where t."archived_at" is null' : ''}
        order by lower(t."name"), t."id"`,
    )) as Array<{ id: string; name: string; archived_at: Date | null; updated_at: Date; stage_count: number }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      stageCount: Number(row.stage_count),
      archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  /** `GET /projects/templates/:id` — 404 `PROJECT_TEMPLATE_NOT_FOUND`. */
  async get(id: string): Promise<ProjectTemplateDetail> {
    const graph = await readTemplateGraph(this.deps.emFactory(), id);
    if (!graph) throw templateNotFound();
    return {
      id: graph.id,
      name: graph.name,
      description: graph.description,
      roleIds: graph.roleIds,
      stages: graph.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        color: stage.color,
        position: stage.position,
        plannedDurationDays: stage.plannedDurationDays,
        responsibleRoleIds: stage.responsibleRoleIds,
        alertOffsetsDays: stage.alertOffsetsDays,
        completionGate: stage.completionGate,
        completionPermitted: stage.completionPermitted,
        tasks: stage.tasks,
      })),
      moves: graph.moves,
      archivedAt: graph.archivedAt ? graph.archivedAt.toISOString() : null,
      createdAt: new Date(graph.createdAt).toISOString(),
      updatedAt: new Date(graph.updatedAt).toISOString(),
    };
  }

  /** The Template a Project is created from — `null` when it is unknown or archived (R-7). */
  async forCopy(id: string): Promise<TemplateGraph | null> {
    const graph = await readTemplateGraph(this.deps.emFactory(), id);
    return graph && graph.archivedAt === null ? graph : null;
  }

  /** `POST /projects/templates`. */
  async create(body: ProjectTemplateBody): Promise<ProjectTemplateDetail> {
    await this.#assertRoles(body, new Set());
    const id = randomUUID();
    await this.deps.commandBus.run({
      action: 'projects.template.create',
      objectType: 'project_template',
      objectId: id,
      run: async ({ em, actor }) => {
        em.create(ProjectTemplate, {
          id,
          name: body.name,
          description: body.description ?? '',
          createdByAdminUserId: actor.actorAdminUserId,
        });
        await em.flush();
        const graph = await this.#writeGraph(em as EntityManager, id, body, new Set());
        return { result: null, before: null, after: snapshot(graph) };
      },
    });
    return this.get(id);
  }

  /** `PUT /projects/templates/:id` — the whole graph replaced in one Command. */
  async save(id: string, body: ProjectTemplateBody): Promise<ProjectTemplateDetail> {
    const current = await readTemplateGraph(this.deps.emFactory(), id);
    if (!current) throw templateNotFound();
    await this.#assertRoles(body, new Set(current.roleIds));
    await this.deps.commandBus.run({
      action: 'projects.template.save',
      objectType: 'project_template',
      objectId: id,
      run: async ({ em }) => {
        // Only the Template's own row is loaded here: its Stages are deleted and
        // written again by id, which an identity map holding them would refuse.
        const template = await em.findOne(ProjectTemplate, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!template) throw templateNotFound();
        template.name = body.name;
        template.description = body.description ?? '';
        template.updatedAt = new Date();
        const graph = await this.#writeGraph(
          em as EntityManager,
          id,
          body,
          new Set(current.stages.map((stage) => stage.id)),
        );
        const archivedAt = template.archivedAt ?? null;
        return { result: null, before: snapshot(current, archivedAt), after: snapshot(graph, archivedAt) };
      },
    });
    return this.get(id);
  }

  /** `POST /projects/templates/:id/duplicate` — an independent copy, active, named "<name> (copy)" in the reader's language. */
  async duplicate(id: string, language: SupportedLanguage): Promise<ProjectTemplateDetail> {
    const source = await readTemplateGraph(this.deps.emFactory(), id);
    if (!source) throw templateNotFound();
    const name = (await this.deps.translate('templates.copyName', language, { name: source.name })).slice(
      0,
      PROJECT_TEMPLATE_NAME_MAX,
    );
    const copyId = randomUUID();
    const body: ProjectTemplateBody = {
      name,
      description: source.description,
      roleIds: source.roleIds,
      stages: source.stages.map((stage) => ({
        key: stage.id,
        name: stage.name,
        color: stage.color,
        plannedDurationDays: stage.plannedDurationDays,
        responsibleRoleIds: stage.responsibleRoleIds,
        alertOffsetsDays: stage.alertOffsetsDays,
        completionGate: stage.completionGate,
        completionPermitted: stage.completionPermitted,
        tasks: stage.tasks.map((task) => ({
          title: task.title,
          description: task.description,
          responsibleRoleId: task.responsibleRoleId,
          dueOffsetDays: task.dueOffsetDays,
        })),
      })),
      moves: source.moves.map((move) => ({ fromStageKey: move.fromStageId, toStageKey: move.toStageId })),
    };
    await this.deps.commandBus.run({
      action: 'projects.template.duplicate',
      objectType: 'project_template',
      objectId: copyId,
      run: async ({ em, actor }) => {
        em.create(ProjectTemplate, {
          id: copyId,
          name,
          description: source.description,
          createdByAdminUserId: actor.actorAdminUserId,
        });
        await em.flush();
        // The source's Stage ids are keys here, never kept: they belong to the source.
        const graph = await this.#writeGraph(em as EntityManager, copyId, body, new Set());
        return { result: null, before: null, after: { ...snapshot(graph), duplicateOf: id } };
      },
    });
    return this.get(copyId);
  }

  /** `POST /projects/templates/:id/archive` — no longer offered for new Projects; nothing else changes. */
  async archive(id: string): Promise<ProjectTemplateDetail> {
    return this.#setArchived(id, true);
  }

  /** `POST /projects/templates/:id/restore`. */
  async restore(id: string): Promise<ProjectTemplateDetail> {
    return this.#setArchived(id, false);
  }

  async #setArchived(id: string, archived: boolean): Promise<ProjectTemplateDetail> {
    if (!isUuid(id) || !(await this.deps.emFactory().findOne(ProjectTemplate, { id }))) throw templateNotFound();
    await this.deps.commandBus.run({
      action: archived ? 'projects.template.archive' : 'projects.template.restore',
      objectType: 'project_template',
      objectId: id,
      run: async ({ em }) => {
        const template = await em.findOne(ProjectTemplate, { id });
        if (!template) throw templateNotFound();
        const wasArchived = template.archivedAt != null;
        if (wasArchived === archived) return { result: null, skipAudit: true };
        template.archivedAt = archived ? new Date() : null;
        template.updatedAt = new Date();
        return { result: null, before: { archived: wasArchived }, after: { archived } };
      },
    });
    return this.get(id);
  }

  /**
   * Roles: every one named exists. A Template's own Roles are not handed out
   * archived — unless the Template already holds that Role (US4 sc.2: an
   * archived Role stays where it is used). A Stage's responsible Roles and a
   * Stage Task's Role may be archived ones, as on a Project.
   */
  async #assertRoles(body: ProjectTemplateBody, held: ReadonlySet<string>): Promise<void> {
    const em = this.deps.emFactory();
    const roleIds = body.roleIds ?? [];
    if (roleIds.length > 0) {
      const rows = (await em.execute(`select r."id", r."archived_at" from "project_roles" r where r."id" = any(?::uuid[])`, [
        uuidArray(roleIds),
      ])) as Array<{ id: string; archived_at: Date | null }>;
      const archived = new Map(rows.map((row) => [row.id, row.archived_at !== null]));
      for (const roleId of roleIds) {
        if (!archived.has(roleId)) throw invalid('A role of this template is not a project role.');
        if (archived.get(roleId) && !held.has(roleId)) {
          // The Role's state refuses a well-formed body, so not `invalid()`'s
          // `VALIDATION_FAILED` (issue #634).
          throw new HttpError(
            422,
            ERROR_CODES.PROJECT_TEMPLATE_ROLE_ARCHIVED,
            'An archived project role is not added to a template.',
            { roleId },
          );
        }
      }
    }
    await assertRolesExist(em, stageRolesNamedBy(body));
  }

  /**
   * Replace a Template's Roles, Stages (with their Stage Tasks) and moves.
   * Children are deleted and written again — the Stages' `on delete cascade`
   * takes their Stage Tasks and moves with them — keeping the id of a Stage
   * whose key is one of `keepIds`.
   */
  async #writeGraph(
    em: EntityManager,
    templateId: string,
    body: ProjectTemplateBody,
    keepIds: ReadonlySet<string>,
  ): Promise<TemplateGraph> {
    // Issue #453 — every write of a Template's graph (create, save, duplicate)
    // holds the Roles it names against a delete, and asks again that they exist.
    await lockRolesForWrite(em, rolesNamedBy(body));
    await em.nativeDelete(ProjectTemplateRole, { templateId });
    await em.nativeDelete(ProjectTemplateStage, { templateId });
    for (const roleId of body.roleIds ?? []) em.create(ProjectTemplateRole, { templateId, roleId });

    const last = body.stages.length - 1;
    const idOf = new Map<string, string>();
    const stages = body.stages.map((stage, index) => {
      const id = keepIds.has(stage.key) ? stage.key : randomUUID();
      idOf.set(stage.key, id);
      return em.create(ProjectTemplateStage, {
        id,
        templateId,
        name: stage.name,
        color: stage.color,
        position: index + 1,
        plannedDurationDays: stage.plannedDurationDays ?? 0,
        responsibleRoleIds: stage.responsibleRoleIds ?? [],
        alertOffsetsDays: stage.alertOffsetsDays ?? [],
        completionGate: stage.completionGate ?? false,
        completionPermitted: stage.completionPermitted ?? index === last,
      });
    });
    // The Stages' rows before what refers to them (ids as values, not relations).
    await em.flush();
    const tasks = body.stages.map((stage, index) =>
      (stage.tasks ?? []).map((task, at) =>
        em.create(ProjectTemplateStageTask, {
          templateStageId: stages[index]!.id,
          title: task.title,
          description: task.description ?? '',
          responsibleRoleId: task.responsibleRoleId ?? null,
          dueOffsetDays: task.dueOffsetDays,
          position: at + 1,
        }),
      ),
    );
    const moves =
      body.moves === undefined
        ? defaultLinearMoves(stages)
        : body.moves.map((move) => ({ fromStageId: idOf.get(move.fromStageKey)!, toStageId: idOf.get(move.toStageKey)! }));
    for (const move of moves) em.create(ProjectTemplateStageMove, { templateId, ...move });
    await em.flush();
    return {
      id: templateId,
      name: body.name,
      description: body.description ?? '',
      roleIds: [...(body.roleIds ?? [])],
      stages: stages.map((stage, index) => ({
        id: stage.id,
        name: stage.name,
        color: stage.color,
        position: stage.position,
        plannedDurationDays: stage.plannedDurationDays,
        responsibleRoleIds: stage.responsibleRoleIds,
        alertOffsetsDays: stage.alertOffsetsDays,
        completionGate: stage.completionGate,
        completionPermitted: stage.completionPermitted,
        tasks: tasks[index]!.map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          responsibleRoleId: task.responsibleRoleId ?? null,
          dueOffsetDays: task.dueOffsetDays,
          position: task.position,
        })),
      })),
      moves,
    };
  }
}
