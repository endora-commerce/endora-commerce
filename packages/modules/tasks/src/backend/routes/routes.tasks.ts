import type { FastifyInstance } from 'fastify';
import {
  CreateTaskBodySchema,
  ERROR_CODES,
  isCustomFieldFilterUnavailableFailure,
  MyTasksQuerySchema,
  RecordHistoryQuerySchema,
  TaskAssigneeLookupQuerySchema,
  TaskContextLookupQuerySchema,
  TaskCountQuerySchema,
  TaskDocumentLookupQuerySchema,
  TaskListQuerySchema,
  TaskMentionableLookupQuerySchema,
  TaskRecordLookupQuerySchema,
  TaskStatusChangeBodySchema,
  UpdateTaskBodySchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { TaskBoardCardFieldService } from '../services/board-card-field-service.js';
import { lookupContexts } from '../services/context-lookup.js';
import type { TaskDocumentLookupService } from '../services/document-lookup-service.js';
import type { TaskMentionService } from '../services/mention-service.js';
import type { TaskRecordLinkService } from '../services/record-link-service.js';
import type { TaskContextRegistry } from '../services/task-context-registry.js';
import type { TaskHistoryService } from '../services/task-history-service.js';
import type { TaskService } from '../services/task-service.js';

export interface TaskRoutesDeps {
  taskService: TaskService;
  historyService: TaskHistoryService;
  mentionService: TaskMentionService;
  documentLookupService: TaskDocumentLookupService;
  /** The link picker's source (R-16). */
  recordLinkService: Pick<TaskRecordLinkService, 'records'>;
  /** The Project/Stage picker's source: each present context owner's descriptor. */
  contexts: TaskContextRegistry;
  /** The board's card fields — what `cardValues=true` fills each row with. */
  cardFields: Pick<TaskBoardCardFieldService, 'selected'>;
  requireAdmin: RequireAdminFactory;
}

const API = '/api/v1/admin/tasks';

/**
 * A custom field the list does not offer is the caller's mistake: 400, naming
 * it (research R-8). Everything else is rethrown untouched. The list, *My
 * Tasks* and the board share it.
 */
export function refuseUnofferedCustomField(error: unknown): never {
  if (isCustomFieldFilterUnavailableFailure(error)) {
    throw new HttpError(400, ERROR_CODES.CUSTOM_FIELD_FILTER_UNAVAILABLE, error.message, {
      key: error.keys[0] ?? '',
      keys: [...error.keys],
    });
  }
  throw error;
}

/**
 * Tasks (`specs/165-task-management/contracts/admin-api.md` §1, grown from
 * 163's). Reading is `tasks:read`; creating, editing, a status move,
 * publishing a draft, deleting and the assignee picker are `tasks:write` — and
 * a holder of `tasks:see_private` may delete a private Task with `tasks:read`. A Task the caller may not see —
 * its context hidden, or another admin's draft or private Task — answers 404
 * `TASK_NOT_FOUND`, the same as a missing one, and is absent from every list.
 *
 * The static paths (`/mine`, `/count`, `/lookups/…`, `/custom-field-filters`) are
 * static routes, which the router matches before `/:id`, so none is ever read
 * as an id.
 */
export async function registerTaskRoutes(app: FastifyInstance, deps: TaskRoutesDeps): Promise<void> {
  const { requireAdmin, taskService: tasks, historyService: history, mentionService, documentLookupService } = deps;

  app.get(API, { preHandler: requireAdmin('tasks:read') }, async (request) => {
    const query = TaskListQuerySchema.parse(request.query ?? {});
    // A board lane's further cards carry the card fields its first ones did (R-11).
    const cardFields = query.cardValues ? await deps.cardFields.selected() : undefined;
    return tasks
      .list(query, await request.responseLanguage(), cardFields ? { cardFields } : {})
      .catch(refuseUnofferedCustomField);
  });

  // How many rows the list would answer under the same filters, across every
  // page (`specs/183-record-tab-contributions/contracts/task-count-api.md`).
  app.get(`${API}/count`, { preHandler: requireAdmin('tasks:read') }, async (request) => ({
    data: {
      count: await tasks.count(TaskCountQuerySchema.parse(request.query ?? {})).catch(refuseUnofferedCustomField),
    },
  }));

  // The `task` custom fields the list offers as filters (FR-007).
  app.get(`${API}/custom-field-filters`, { preHandler: requireAdmin('tasks:read') }, async () => ({
    data: await tasks.customFieldFilterFields(),
  }));

  app.get(`${API}/mine`, { preHandler: requireAdmin('tasks:read') }, async (request) => ({
    data: await tasks
      .mine(MyTasksQuerySchema.parse(request.query ?? {}), await request.responseLanguage())
      .catch(refuseUnofferedCustomField),
  }));

  // For a private Task (`taskId`), its Creator alone (FR-038); for a Task in a
  // record, or a `contextType`/`contextId` on the create form, who may see it (#506).
  app.get(`${API}/lookups/assignees`, { preHandler: requireAdmin('tasks:write') }, async (request) => {
    const query = TaskAssigneeLookupQuerySchema.parse(request.query ?? {});
    const context =
      query.contextType !== undefined && query.contextId !== undefined
        ? { contextType: query.contextType, contextId: query.contextId }
        : undefined;
    return { data: await tasks.assignees(query.q, query.taskId, context) };
  });

  // Who a text of a Task may mention (admin-api §3): somebody who may see it.
  app.get(`${API}/lookups/mentionable`, { preHandler: requireAdmin('tasks:read') }, async (request) => ({
    data: await mentionService.mentionable(TaskMentionableLookupQuerySchema.parse(request.query ?? {})),
  }));

  // What a text of a Task may refer to after `@@` (admin-api §3): `tasks:write`,
  // because a reference is chosen only while writing. Each group's own read code
  // and its owner's presence are the service's to decide — a switchable owner's
  // code on the route would answer 403 where the list should leave the group out.
  app.get(`${API}/lookups/documents`, { preHandler: requireAdmin('tasks:write') }, async (request) =>
    documentLookupService.documents(TaskDocumentLookupQuerySchema.parse(request.query ?? {})),
  );

  // What a Task may be linked to (admin-api §3, R-16): `tasks:write`, because a
  // link is chosen only while writing. Each kind's read code and its owner's
  // presence are the service's to decide; a kind nobody may link answers empty.
  app.get(`${API}/lookups/records`, { preHandler: requireAdmin('tasks:write') }, async (request) => {
    const query = TaskRecordLookupQuerySchema.parse(request.query ?? {});
    return { data: await deps.recordLinkService.records(query.kind, query.q) };
  });

  // Where a Task may be placed (US6 scenario 3): the contexts the caller may
  // see and put a Task into, through each present owner's descriptor.
  app.get(`${API}/lookups/contexts`, { preHandler: requireAdmin('tasks:write') }, async (request) => ({
    data: await lookupContexts(deps.contexts, TaskContextLookupQuerySchema.parse(request.query ?? {}).q),
  }));

  app.post(
    API,
    { preHandler: requireAdmin('tasks:write'), schema: { body: CreateTaskBodySchema } },
    async (request, reply) => {
      const created = await tasks.create(CreateTaskBodySchema.parse(request.body), await request.responseLanguage());
      reply.code(201);
      return { data: created };
    },
  );

  app.get<{ Params: { id: string } }>(`${API}/:id`, { preHandler: requireAdmin('tasks:read') }, async (request) => ({
    data: await tasks.get(request.params.id, await request.responseLanguage()),
  }));

  app.patch<{ Params: { id: string } }>(
    `${API}/:id`,
    { preHandler: requireAdmin('tasks:write'), schema: { body: UpdateTaskBodySchema } },
    async (request) => ({
      data: await tasks.update(
        request.params.id,
        UpdateTaskBodySchema.parse(request.body),
        await request.responseLanguage(),
      ),
    }),
  );

  // A status move goes through the configured workflow (research R-1); `PATCH`
  // no longer takes a status.
  app.post<{ Params: { id: string } }>(
    `${API}/:id/status`,
    { preHandler: requireAdmin('tasks:write'), schema: { body: TaskStatusChangeBodySchema } },
    async (request) => ({
      data: await tasks.changeStatus(
        request.params.id,
        TaskStatusChangeBodySchema.parse(request.body),
        await request.responseLanguage(),
      ),
    }),
  );

  // Publishing a draft (FR-037): `tasks:write`, and the service asks that the
  // caller is its Creator — somebody else's draft is 404 for them.
  app.post<{ Params: { id: string } }>(
    `${API}/:id/publish`,
    { preHandler: requireAdmin('tasks:write') },
    async (request) => ({ data: await tasks.publish(request.params.id, await request.responseLanguage()) }),
  );

  // 200, not 204: the answer says how many of the Task's sub-tasks the caller
  // may see became top-level (FR-029, `TaskDeleteResponseSchema`). The gate is
  // `tasks:read`: a holder of `tasks:see_private` may delete someone else's
  // private Task without `tasks:write` (FR-041, Q1 = B), and the service
  // refuses everyone else with the 403 the gate would have given.
  app.delete<{ Params: { id: string } }>(`${API}/:id`, { preHandler: requireAdmin('tasks:read') }, async (request) => ({
    data: await tasks.delete(request.params.id),
  }));

  app.get<{ Params: { id: string } }>(
    `${API}/:id/history`,
    { preHandler: requireAdmin('tasks:read') },
    async (request) => history.list(request.params.id, RecordHistoryQuerySchema.parse(request.query ?? {})),
  );
}
