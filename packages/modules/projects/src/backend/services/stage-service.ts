import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PROJECT_STAGES_MAX,
  type CreateProjectStageBody,
  type ProjectDetail,
  type ProjectStage as ProjectStageView,
  type ProjectStageMove as ProjectStageMoveInput,
  type SetProjectMovesResult,
  type UpdateProjectStageBody,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { recomputeDeadline } from '../domain/deadline.js';
import { StageGraph, StageGraphError } from '../domain/stage-graph.js';
import { ProjectStage } from '../entities/project-stage.entity.js';
import { ProjectStageMove } from '../entities/project-stage-move.entity.js';
import type { ProjectAccess } from './project-access.js';
import type { ProjectReadService } from './project-read-service.js';
import { assertRolesExist, lockProject } from './project-service.js';
import { lockRolesForWrite } from './role-locks.js';
import { PROJECT_TASK_CONTEXT_TYPE, type ProjectTasks } from './project-tasks.js';

/**
 * A Project's Stages and its workflow (`contracts/admin-api.md` §2.2,
 * FR-010 – FR-013): add, edit, delete and reorder Stages, and replace the
 * permitted moves — each a Command (`projects.project.stage_create`,
 * `.stage_update`, `.stage_delete`, `.stage_reorder`, `.moves_set`).
 *
 * Every write starts from `ProjectAccess.loadVisible`; inside the Command the
 * Project row is locked, so a Stage edit and a move of the same Project run
 * one after the other, and the Stages and moves are read by its id.
 *
 * A Stage added at the end gets the default move from the Stage that was last
 * (FR-011: "each Stage → the next one"); one in the middle is reached by
 * whatever moves the editor sets. Deleting the only Stage, the one the
 * Project is in, or one that holds Tasks (`taskReadPort.countInContext`, asked
 * only while Tasks is on) is refused.
 */

export interface StageServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: ProjectAccess;
  read: ProjectReadService;
  tasks: ProjectTasks;
}

export function stageNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'No such stage on this project.');
}

function stageSnapshot(stage: ProjectStage): Record<string, unknown> {
  return {
    stageId: stage.id,
    name: stage.name,
    color: stage.color,
    position: stage.position,
    plannedDurationDays: stage.plannedDurationDays,
    responsibleRoleIds: stage.responsibleRoleIds,
    alertOffsetsDays: stage.alertOffsetsDays,
    completionGate: stage.completionGate,
    completionPermitted: stage.completionPermitted,
    deadlineOn: stage.deadlineOn ?? null,
    deadlineManual: stage.deadlineManual,
  };
}

async function stagesOf(em: EntityManager, projectId: string): Promise<ProjectStage[]> {
  return em.find(ProjectStage, { projectId }, { orderBy: { position: 'asc', id: 'asc' } });
}

export class StageService {
  constructor(private readonly deps: StageServiceDeps) {}

  /** `POST /projects/:id/stages` — appended after the last Stage. */
  async create(projectId: string, body: CreateProjectStageBody): Promise<ProjectStageView> {
    const visible = await this.deps.access.loadVisible(projectId);
    await assertRolesExist(this.deps.emFactory(), body.responsibleRoleIds ?? []);
    const stageId = await this.deps.commandBus.run({
      action: 'projects.project.stage_create',
      objectType: 'project',
      objectId: visible.id,
      run: async ({ em }) => {
        await lockProject(em, this.deps.access, visible.id);
        // Issue #453 — the Roles it names, held against a delete and asked again.
        await lockRolesForWrite(em as EntityManager, body.responsibleRoleIds ?? []);
        const stages = await stagesOf(em, visible.id);
        if (stages.length >= PROJECT_STAGES_MAX) {
          throw new HttpError(422, ERROR_CODES.PROJECT_STAGE_LIMIT, `A project has at most ${PROJECT_STAGES_MAX} stages.`, {
            projectId: visible.id,
            maximum: PROJECT_STAGES_MAX,
          });
        }
        const last = stages[stages.length - 1];
        const stage = em.create(ProjectStage, {
          projectId: visible.id,
          name: body.name,
          color: body.color,
          position: (last?.position ?? 0) + 1,
          plannedDurationDays: body.plannedDurationDays ?? 0,
          responsibleRoleIds: body.responsibleRoleIds ?? [],
          alertOffsetsDays: body.alertOffsetsDays ?? [],
          completionGate: body.completionGate ?? false,
          completionPermitted: body.completionPermitted ?? false,
        });
        await em.flush();
        if (last) em.create(ProjectStageMove, { projectId: visible.id, fromStageId: last.id, toStageId: stage.id });
        return { result: stage.id, before: null, after: stageSnapshot(stage) };
      },
    });
    return this.deps.read.stageAfterWrite(visible.id, stageId);
  }

  /**
   * `PATCH /projects/:id/stages/:stageId`. `deadlineOn` sets the deadline by
   * hand; `null` drops the manual deadline. A deadline that is not manual
   * follows the start and the planned duration (FR-013).
   */
  async update(projectId: string, stageId: string, body: UpdateProjectStageBody): Promise<ProjectStageView> {
    const visible = await this.deps.access.loadVisible(projectId);
    await assertRolesExist(this.deps.emFactory(), body.responsibleRoleIds ?? []);
    await this.deps.commandBus.run({
      action: 'projects.project.stage_update',
      objectType: 'project',
      objectId: visible.id,
      run: async ({ em }) => {
        await lockProject(em, this.deps.access, visible.id);
        // Issue #453 — the Roles it names, held against a delete and asked again.
        await lockRolesForWrite(em as EntityManager, body.responsibleRoleIds ?? []);
        const stage = await em.findOne(ProjectStage, { id: stageId, projectId: visible.id });
        if (!stage) throw stageNotFound();
        const before = stageSnapshot(stage);
        if (body.name !== undefined) stage.name = body.name;
        if (body.color !== undefined) stage.color = body.color;
        if (body.plannedDurationDays !== undefined) stage.plannedDurationDays = body.plannedDurationDays;
        if (body.responsibleRoleIds !== undefined) stage.responsibleRoleIds = body.responsibleRoleIds;
        if (body.alertOffsetsDays !== undefined) stage.alertOffsetsDays = body.alertOffsetsDays;
        if (body.completionGate !== undefined) stage.completionGate = body.completionGate;
        if (body.completionPermitted !== undefined) stage.completionPermitted = body.completionPermitted;
        if (body.deadlineOn !== undefined) {
          stage.deadlineManual = body.deadlineOn !== null;
          stage.deadlineOn = body.deadlineOn;
        }
        stage.deadlineOn = recomputeDeadline({
          startedOn: stage.startedOn ?? null,
          deadlineOn: stage.deadlineOn ?? null,
          deadlineManual: stage.deadlineManual,
          plannedDurationDays: stage.plannedDurationDays,
        });
        return { result: null, before, after: stageSnapshot(stage) };
      },
    });
    return this.deps.read.stageAfterWrite(visible.id, stageId);
  }

  /**
   * `DELETE /projects/:id/stages/:stageId` — never the only Stage, never the
   * one the Project is in, never one holding Tasks. With Tasks off nothing can
   * be counted and the Stage goes; its Tasks then belong to no Stage the
   * Project shows, and the Tasks module's maintenance pass takes the Stage off
   * them once it is back on (`existingContexts`, #450).
   */
  async delete(projectId: string, stageId: string): Promise<void> {
    const visible = await this.deps.access.loadVisible(projectId);
    const holdsTasks =
      this.deps.tasks.present() &&
      (await this.deps.tasks.read.countInContext({
        contextType: PROJECT_TASK_CONTEXT_TYPE,
        contextId: visible.id,
        contextGroupId: stageId,
      })) > 0;
    await this.deps.commandBus.run({
      action: 'projects.project.stage_delete',
      objectType: 'project',
      objectId: visible.id,
      run: async ({ em }) => {
        const project = await lockProject(em, this.deps.access, visible.id);
        const stages = await stagesOf(em, visible.id);
        const stage = stages.find((s) => s.id === stageId);
        if (!stage) throw stageNotFound();
        if (stages.length === 1) {
          throw new HttpError(409, ERROR_CODES.PROJECT_STAGE_LAST, 'A project needs at least one stage.');
        }
        // A closed Project keeps the Stage it was closed in as its current
        // one — it reopens there — so that one is "current" too.
        if (project.currentStageId === stageId || project.lostStageId === stageId) {
          throw new HttpError(409, ERROR_CODES.PROJECT_STAGE_CURRENT, 'The project is in this stage.');
        }
        if (holdsTasks) {
          throw new HttpError(409, ERROR_CODES.PROJECT_STAGE_HAS_TASKS, 'This stage holds tasks.');
        }
        const before = stageSnapshot(stage);
        // Its moves and Stage Task definitions go with it (`on delete cascade`);
        // the Stage history keeps its name.
        em.remove(stage);
        await em.flush();
        stages
          .filter((s) => s.id !== stageId)
          .forEach((s, index) => {
            s.position = index + 1;
          });
        return { result: null, before, after: null };
      },
    });
  }

  /** `PUT /projects/:id/stages/order` — every Stage of the Project, in the new order. */
  async reorder(projectId: string, stageIds: readonly string[], language: string): Promise<ProjectDetail> {
    const visible = await this.deps.access.loadVisible(projectId);
    await this.deps.commandBus.run({
      action: 'projects.project.stage_reorder',
      objectType: 'project',
      objectId: visible.id,
      run: async ({ em }) => {
        await lockProject(em, this.deps.access, visible.id);
        const stages = await stagesOf(em, visible.id);
        const known = new Set(stages.map((s) => s.id));
        if (stageIds.length !== stages.length || stageIds.some((id) => !known.has(id))) {
          throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Name every stage of this project, each once.');
        }
        const before = stages.map((s) => s.id);
        const byId = new Map(stages.map((s) => [s.id, s]));
        // Positions are unique per Project, checked at commit, so they can swap.
        stageIds.forEach((id, index) => {
          byId.get(id)!.position = index + 1;
        });
        return { result: null, before: { stageIds: before }, after: { stageIds: [...stageIds] } };
      },
    });
    return this.deps.read.afterWrite(visible.id, language);
  }

  /** `PUT /projects/:id/moves` — the whole workflow; Stages it leaves unreachable are named, not refused. */
  async setMoves(projectId: string, moves: readonly ProjectStageMoveInput[]): Promise<SetProjectMovesResult> {
    const visible = await this.deps.access.loadVisible(projectId);
    return this.deps.commandBus.run({
      action: 'projects.project.moves_set',
      objectType: 'project',
      objectId: visible.id,
      run: async ({ em }) => {
        await lockProject(em, this.deps.access, visible.id);
        const stages = await stagesOf(em, visible.id);
        let graph: StageGraph;
        try {
          graph = new StageGraph(stages, moves);
        } catch (error) {
          if (error instanceof StageGraphError) throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, error.message);
          throw error;
        }
        const previous = (await em.execute(
          `select m."from_stage_id", m."to_stage_id" from "project_stage_moves" m where m."project_id" = ?`,
          [visible.id],
        )) as Array<{ from_stage_id: string; to_stage_id: string }>;
        const before = previous.map((m) => ({ fromStageId: m.from_stage_id, toStageId: m.to_stage_id }));
        await em.nativeDelete(ProjectStageMove, { projectId: visible.id });
        for (const move of moves) {
          em.create(ProjectStageMove, { projectId: visible.id, fromStageId: move.fromStageId, toStageId: move.toStageId });
        }
        const positionOf = new Map(stages.map((s) => [s.id, s.position]));
        const ordered = moves
          .map((m) => ({ fromStageId: m.fromStageId, toStageId: m.toStageId }))
          .sort(
            (a, b) =>
              (positionOf.get(a.fromStageId) ?? 0) - (positionOf.get(b.fromStageId) ?? 0) ||
              (positionOf.get(a.toStageId) ?? 0) - (positionOf.get(b.toStageId) ?? 0),
          );
        const result: SetProjectMovesResult = { moves: ordered, unreachableStageIds: graph.unreachable() };
        return { result, before: { moves: before }, after: { moves: ordered } };
      },
    });
  }
}
