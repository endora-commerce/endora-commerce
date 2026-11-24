import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PROJECTS_EVENTS,
  type CloseProjectBody,
  type MoveProjectBody,
  type ProjectCloseHookData,
  type ProjectClosedEvent,
  type ProjectDetail,
  type ProjectMoveResult,
  type ProjectReopenHookData,
  type ProjectReopenedEvent,
  type ProjectStageEntryNote,
  type ProjectStageMoveHookData,
  type ProjectStageMovedEvent,
  type ReopenProjectBody,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { randomUUID } from 'crypto';
import { enterStage, todayIn } from '../domain/deadline.js';
import { StageGraph } from '../domain/stage-graph.js';
import { ProjectStage } from '../entities/project-stage.entity.js';
import { ProjectStageEntry } from '../entities/project-stage-entry.entity.js';
import { ProjectStageMove } from '../entities/project-stage-move.entity.js';
import type { ProjectAccess, VisibleProjectRow } from './project-access.js';
import type { ProjectReadService } from './project-read-service.js';
import { lockProject, projectChanged } from './project-service.js';
import type { ProjectStageGuardRegistry } from './project-stage-guard-registry.js';
import type { ProjectTasks } from './project-tasks.js';
import type { StageEntryPlan, StageTaskService } from './stage-task-service.js';

/**
 * Walking a Project (`contracts/admin-api.md` §2.2, FR-003, FR-005, FR-006,
 * FR-011 – FR-014): a move to another Stage, closing as completed or lost, and
 * reopening — each one Command (`projects.project.stage_move`, `.close`,
 * `.reopen`), one Stage-history row, one event on commit.
 *
 * In this order, and **every refusal before anything is written**:
 *
 * 1. the Project, through `ProjectAccess.loadVisible` (404 alike for missing,
 *    out of reach and invisible);
 * 2. its state and the `version` the caller read (409 `PROJECT_CHANGED`);
 * 3. the workflow — a move the Project's moves do not permit is 409
 *    `PROJECT_MOVE_NOT_PERMITTED`; completing needs a Stage that permits it;
 *    losing needs a loss reason that is not archived;
 * 4. the completion gate of the Stage being left (R-8, the module's own first
 *    guard) — 409 `PROJECT_STAGE_GATE_OPEN_TASKS` naming the open Tasks; with
 *    Tasks off it is not applied and the entry records
 *    `gate_not_applied_tasks_off`. Losing a Project is not gated;
 * 5. the registered stage guards (`projectStageGuardRegistry`, R-6), each
 *    owner present — a refusal is 409 `PROJECT_GUARD_REFUSED` with its sentence;
 * 6. the Command: the Project row locked, the version and the workflow checked
 *    again under the lock — two moves at once, one wins and the other is told
 *    the Project changed — then the write, the history row, the version bump.
 *
 * Entering a Stage records its start, today in `projects.alerts_time_zone`,
 * and its deadline (FR-013), and decides its Stage Tasks inside the same
 * Command; they are created **after** it commits (`stage-task-service.ts`).
 */

export interface MoveServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: ProjectAccess;
  read: ProjectReadService;
  guards: ProjectStageGuardRegistry;
  stageTasks: StageTaskService;
  tasks: ProjectTasks;
}

function notPermitted(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(409, ERROR_CODES.PROJECT_MOVE_NOT_PERMITTED, message, details);
}

function assertVersion(row: VisibleProjectRow, version: number): void {
  if (row.version !== version) throw projectChanged();
}

/** The Project's workflow as it is under the lock. */
async function lockedGraph(em: EntityManager, projectId: string): Promise<{ graph: StageGraph; stages: ProjectStage[] }> {
  const stages = await em.find(ProjectStage, { projectId }, { orderBy: { position: 'asc', id: 'asc' } });
  const moves = await em.find(ProjectStageMove, { projectId });
  return { graph: new StageGraph(stages, moves), stages };
}

export class MoveService {
  constructor(private readonly deps: MoveServiceDeps) {}

  /** `POST /projects/:id/move`. */
  async move(projectId: string, body: MoveProjectBody, language: string): Promise<ProjectMoveResult> {
    const visible = await this.deps.access.loadVisible(projectId);
    if (visible.state !== 'open') throw notPermitted('A closed project does not move between stages. Reopen it first.');
    assertVersion(visible, body.version);
    const from = visible.current_stage_id!;
    const { graph, stages: workflowStages } = await this.deps.read.graphOf(visible.id);
    if (!graph.canMove(from, body.toStageId)) {
      throw notPermitted('The project’s workflow does not allow this move.', {
        fromStageId: from,
        toStageId: body.toStageId,
      });
    }
    const gateNotes = await this.deps.stageTasks.gate(visible.id, workflowStages.find((s) => s.id === from)!);
    await this.deps.guards.run({ projectId: visible.id, fromStageId: from, toStageId: body.toStageId, kind: 'move' });
    const today = todayIn(await this.deps.read.timeZone());
    const tasksPresent = this.deps.tasks.present();
    let plan: StageEntryPlan = { materialize: false, notes: [] };

    let moved: Omit<ProjectStageMovedEvent, 'eventId' | 'occurredAt'> | null = null;
    // Hookable (issue #1845, `PROJECT_HOOKABLE_ACTIONS.stageMove`): the Stages by id, set by `run`.
    const hooked = (): ProjectStageMoveHookData => ({
      projectId: visible.id,
      fromStageId: moved!.fromStageId!,
      toStageId: moved!.toStageId,
    });
    const entryId = await this.deps.commandBus.run({
      action: 'projects.project.stage_move',
      objectType: 'project',
      objectId: visible.id,
      hookData: hooked,
      outboxData: hooked,
      run: async ({ em, actor }) => {
        const project = await lockProject(em, this.deps.access, visible.id);
        if (project.version !== body.version || project.state !== 'open') throw projectChanged();
        const { graph: current, stages } = await lockedGraph(em, project.id);
        const source = project.currentStageId!;
        if (!current.canMove(source, body.toStageId)) {
          throw notPermitted('The project’s workflow does not allow this move.', {
            fromStageId: source,
            toStageId: body.toStageId,
          });
        }
        const fromStage = stages.find((s) => s.id === source)!;
        const toStage = stages.find((s) => s.id === body.toStageId)!;
        Object.assign(
          toStage,
          enterStage(
            {
              startedOn: toStage.startedOn ?? null,
              deadlineOn: toStage.deadlineOn ?? null,
              deadlineManual: toStage.deadlineManual,
              plannedDurationDays: toStage.plannedDurationDays,
            },
            today,
          ),
        );
        project.currentStageId = toStage.id;
        project.version += 1;
        plan = await this.deps.stageTasks.planEntry(em as EntityManager, toStage, tasksPresent);
        const notes: ProjectStageEntryNote[] = [...gateNotes, ...plan.notes];
        const entry = em.create(ProjectStageEntry, {
          projectId: project.id,
          kind: 'enter',
          fromStageId: fromStage.id,
          toStageId: toStage.id,
          fromStageName: fromStage.name,
          toStageName: toStage.name,
          notes,
          actorAdminUserId: actor.actorAdminUserId,
        });
        moved = {
          projectId: project.id,
          fromStageId: fromStage.id,
          toStageId: toStage.id,
          fromStageName: fromStage.name,
          toStageName: toStage.name,
        };
        return {
          result: entry.id,
          // The Stages by id: a Stage's name is a value (#1226). The Stage
          // history (`project_stage_entries`) keeps the names it was moved by.
          before: { stageId: fromStage.id, version: body.version },
          after: {
            stageId: toStage.id,
            startedOn: toStage.startedOn ?? null,
            deadlineOn: toStage.deadlineOn ?? null,
            version: project.version,
            ...(notes.length > 0 ? { notes } : {}),
          },
        };
      },
      event: () => {
        const payload: ProjectStageMovedEvent = {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          ...moved!,
        };
        return { eventName: PROJECTS_EVENTS.STAGE_MOVED, payload };
      },
    });

    const created = plan.materialize
      ? await this.deps.stageTasks.materializeAfterCommit(visible.id, body.toStageId, entryId)
      : { createdTaskIds: [], failed: false };
    const [project, entry] = await Promise.all([
      this.deps.read.afterWrite(visible.id, language),
      this.deps.read.entryAfterWrite(visible.id, entryId),
    ]);
    return { project, entry, createdTaskIds: created.createdTaskIds, notes: entry.notes };
  }

  /** `POST /projects/:id/close` — completed from a Stage that permits it, or lost from any. */
  async close(projectId: string, body: CloseProjectBody, language: string): Promise<ProjectDetail> {
    const visible = await this.deps.access.loadVisible(projectId);
    if (visible.state !== 'open') throw notPermitted('The project is already closed.');
    assertVersion(visible, body.version);
    const stageId = visible.current_stage_id!;
    const { stages } = await this.deps.read.graphOf(visible.id);
    const stage = stages.find((s) => s.id === stageId)!;
    let lossReasonCode: string | null = null;
    if (body.outcome === 'completed') {
      if (!stage.completion_permitted) {
        throw new HttpError(
          409,
          ERROR_CODES.PROJECT_COMPLETION_NOT_PERMITTED,
          'The project cannot be completed from its current stage.',
          { stageId },
        );
      }
    } else {
      lossReasonCode = await this.#activeLossReasonCode(body.lossReasonId);
    }
    const kind = body.outcome === 'completed' ? 'close_completed' : 'close_lost';
    // Losing a Project is not gated (FR-012).
    const gateNotes = body.outcome === 'completed' ? await this.deps.stageTasks.gate(visible.id, stage) : [];
    await this.deps.guards.run({ projectId: visible.id, fromStageId: stageId, toStageId: null, kind });

    // Hookable (#1845, `PROJECT_HOOKABLE_ACTIONS.close`): the outcome and the loss reason by code.
    let closedIn = stageId;
    const hooked = (): ProjectCloseHookData => ({
      projectId: visible.id,
      state: body.outcome,
      stageId: closedIn,
      lossReasonCode,
    });
    await this.deps.commandBus.run({
      action: 'projects.project.close',
      objectType: 'project',
      objectId: visible.id,
      hookData: hooked,
      outboxData: hooked,
      run: async ({ em, actor }) => {
        const project = await lockProject(em, this.deps.access, visible.id);
        if (project.version !== body.version || project.state !== 'open') throw projectChanged();
        const current = await em.findOne(ProjectStage, { id: project.currentStageId!, projectId: project.id });
        if (!current) throw projectChanged();
        if (body.outcome === 'completed' && !current.completionPermitted) throw projectChanged();
        closedIn = current.id;
        project.state = body.outcome;
        project.closedAt = new Date();
        if (body.outcome === 'lost') {
          project.lostStageId = current.id;
          project.lossReasonId = body.lossReasonId;
          project.lossComment = body.comment?.trim() ? body.comment.trim() : null;
        }
        project.version += 1;
        em.create(ProjectStageEntry, {
          projectId: project.id,
          kind,
          fromStageId: current.id,
          toStageId: null,
          fromStageName: current.name,
          toStageName: null,
          notes: gateNotes,
          actorAdminUserId: actor.actorAdminUserId,
        });
        return {
          result: null,
          before: { state: 'open', version: body.version },
          // The loss comment is free text: the trail records that one was
          // written, never what it says.
          after: {
            state: project.state,
            stageId: current.id,
            ...(lossReasonCode ? { lossReasonCode, lossCommentLength: project.lossComment?.length ?? 0 } : {}),
            version: project.version,
          },
        };
      },
      event: () => {
        const payload: ProjectClosedEvent = {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          projectId: visible.id,
          outcome: body.outcome,
          stageId,
          ...(lossReasonCode ? { lossReasonCode } : {}),
        };
        return { eventName: PROJECTS_EVENTS.PROJECT_CLOSED, payload };
      },
    });
    return this.deps.read.afterWrite(visible.id, language);
  }

  /** `POST /projects/:id/reopen` — back into the Stage it was closed in (FR-006). */
  async reopen(projectId: string, body: ReopenProjectBody, language: string): Promise<ProjectDetail> {
    const visible = await this.deps.access.loadVisible(projectId);
    if (visible.state === 'open') throw notPermitted('Only a closed project can be reopened.');
    assertVersion(visible, body.version);
    const stageId = visible.lost_stage_id ?? visible.current_stage_id!;
    await this.deps.guards.run({ projectId: visible.id, fromStageId: null, toStageId: stageId, kind: 'reopen' });

    // Hookable (#1845, `PROJECT_HOOKABLE_ACTIONS.reopen`): how it had ended, read under the lock.
    let previousState: ProjectReopenHookData['previousState'] = visible.state as ProjectReopenHookData['previousState'];
    const hooked = (): ProjectReopenHookData => ({ projectId: visible.id, stageId, previousState });
    await this.deps.commandBus.run({
      action: 'projects.project.reopen',
      objectType: 'project',
      objectId: visible.id,
      hookData: hooked,
      outboxData: hooked,
      run: async ({ em, actor }) => {
        const project = await lockProject(em, this.deps.access, visible.id);
        if (project.version !== body.version || project.state === 'open') throw projectChanged();
        previousState = project.state;
        const stage = await em.findOne(ProjectStage, { id: stageId, projectId: project.id });
        if (!stage) throw projectChanged();
        const before = { state: project.state, version: body.version };
        project.state = 'open';
        project.closedAt = null;
        project.currentStageId = stage.id;
        project.lostStageId = null;
        project.lossReasonId = null;
        project.lossComment = null;
        project.version += 1;
        em.create(ProjectStageEntry, {
          projectId: project.id,
          kind: 'reopen',
          fromStageId: null,
          toStageId: stage.id,
          fromStageName: null,
          toStageName: stage.name,
          actorAdminUserId: actor.actorAdminUserId,
        });
        return {
          result: null,
          before,
          after: { state: 'open', stageId: stage.id, version: project.version },
        };
      },
      event: () => {
        const payload: ProjectReopenedEvent = {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          projectId: visible.id,
          stageId,
        };
        return { eventName: PROJECTS_EVENTS.PROJECT_REOPENED, payload };
      },
    });
    return this.deps.read.afterWrite(visible.id, language);
  }

  /** The code of a loss reason that exists and is not archived (FR-005), or 422. */
  async #activeLossReasonCode(lossReasonId: string): Promise<string> {
    const rows = (await this.deps.emFactory().execute(
      `select lr."code" from "project_loss_reasons" lr where lr."id" = ? and lr."archived_at" is null`,
      [lossReasonId],
    )) as Array<{ code: string }>;
    if (!rows[0]) {
      throw new HttpError(422, ERROR_CODES.PROJECT_LOSS_REASON_INVALID, 'Choose a loss reason that is in use.');
    }
    return rows[0].code;
  }
}
