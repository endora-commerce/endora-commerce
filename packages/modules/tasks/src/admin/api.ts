import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CreateTaskBody,
  CreateTaskPriorityBody,
  CreateTaskTagBody,
  CreateTaskReminderBody,
  CreateTaskStatusBody,
  SetTaskTransitionsBody,
  UpdateTaskStatusBody,
  RecordDocumentLookupResponse,
  RecordHistoryPage,
  TaskAssigneeOption,
  TaskAttachment,
  TaskBoard,
  TaskBoardCardConfig,
  TaskComment,
  TaskContextOption,
  TaskDeleteResult,
  TaskDigestSubscription,
  TaskDetail,
  TaskLink,
  TaskLinkKind,
  TaskListResponse,
  TaskLookupOption,
  TaskPriorityConfig,
  TaskReminder,
  TaskStatusChangeResult,
  TaskSummary,
  TaskTag,
  TaskTimeZone,
  TaskWorkflow,
  UpdateTaskBody,
  UpdateTaskPriorityBody,
  UpdateTaskTagBody,
} from '@endora-commerce/contracts';

/**
 * The HTTP calls of the Tasks admin screens
 * (`specs/165-task-management/contracts/admin-api.md` §1, §4).
 *
 * Every shape is `@endora-commerce/contracts`' — the schemas the backend
 * validates with. Single records are `{ data }` envelopes; the list answers
 * `{ items, nextCursor }` and knows no total; the history is the shared
 * `RecordHistoryPage`.
 */

const BASE = '/api/v1/admin/tasks';
/** `catalog`'s own list — what `@@@` searches, offered to a holder of `catalog:read`. */
const PRODUCTS_BASE = '/api/v1/admin/catalog/products';

/** A Product as the `@@@` list offers it. */
export interface MentionableProduct {
  id: string;
  sku: string;
  name: Record<string, string>;
}

export interface TaskListParams {
  q?: string;
  /** Workflow status codes, any of. */
  status?: readonly string[];
  /** An administrator's id, `me` or `none`. */
  assignee?: string;
  overdue?: boolean;
  cursor?: string;
  limit?: number;
}

function listQuery(params: TaskListParams): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  for (const status of params.status ?? []) qs.append('status', status);
  if (params.assignee) qs.set('assignee', params.assignee);
  if (params.overdue) qs.set('overdue', 'true');
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  const tail = qs.toString();
  return tail ? `?${tail}` : '';
}

function data<T>(promise: Promise<{ data: T }>): Promise<T> {
  return promise.then((envelope) => envelope.data);
}

/** `?…` for a non-empty query, nothing for an empty one. */
function tail(query: URLSearchParams): string {
  const text = query.toString();
  return text ? `?${text}` : '';
}

export const tasksApi = {
  listTasks(params: TaskListParams = {}): Promise<TaskListResponse> {
    return apiClient.get<TaskListResponse>(`${BASE}${listQuery(params)}`);
  },

  /** `GET /tasks` with a query the screen built from its address (`lib/task-filters.ts`). */
  listTasksBy(query: URLSearchParams): Promise<TaskListResponse> {
    return apiClient.get<TaskListResponse>(`${BASE}${tail(query)}`);
  },

  /** The caller's open Tasks, by due date, undated last — narrowed by the list's filters. */
  myTasks(query: URLSearchParams = new URLSearchParams()): Promise<TaskSummary[]> {
    return data(apiClient.get<{ data: TaskSummary[] }>(`${BASE}/mine${tail(query)}`));
  },

  /** One column per status, each with its count and first cards (R-11) — `tasks:read`. */
  board(query: URLSearchParams): Promise<TaskBoard> {
    return data(apiClient.get<{ data: TaskBoard }>(`${BASE}/board${tail(query)}`));
  },

  /** What a board card shows, and what it could — `tasks:read`. */
  boardCardFields(): Promise<TaskBoardCardConfig> {
    return data(apiClient.get<{ data: TaskBoardCardConfig }>(`${BASE}/board/card-fields`));
  },

  /** `tasks:configure` — answers the configuration as it stands afterwards. */
  setBoardCardFields(fields: readonly string[]): Promise<TaskBoardCardConfig> {
    return data(apiClient.put<{ data: TaskBoardCardConfig }>(`${BASE}/board/card-fields`, { fields }));
  },

  getTask(id: string): Promise<TaskDetail> {
    return data(apiClient.get<{ data: TaskDetail }>(`${BASE}/${id}`));
  },

  createTask(body: CreateTaskBody): Promise<TaskDetail> {
    return data(apiClient.post<{ data: TaskDetail }>(BASE, body));
  },

  /** Any of the fields, at least one; answers the Task as it is now. A status is not one of them. */
  updateTask(id: string, body: UpdateTaskBody): Promise<TaskDetail> {
    return data(apiClient.patch<{ data: TaskDetail }>(`${BASE}/${id}`, body));
  },

  /** Publishes the caller's own draft, one-way (FR-037); answers the Task as it is now. */
  publishTask(id: string): Promise<TaskDetail> {
    return data(apiClient.post<{ data: TaskDetail }>(`${BASE}/${id}/publish`, {}));
  },

  /** A move through the workflow, from the status the caller saw (409 when the Task left it). */
  changeStatus(id: string, from: string, to: string): Promise<TaskStatusChangeResult> {
    return data(apiClient.post<{ data: TaskStatusChangeResult }>(`${BASE}/${id}/status`, { from, to }));
  },

  /** The configured statuses, in order, and the moves between them — `tasks:read`. */
  workflow(): Promise<TaskWorkflow> {
    return data(apiClient.get<{ data: TaskWorkflow }>(`${BASE}/workflow`));
  },

  /** `tasks:configure` — each answers the whole workflow as it stands afterwards. */
  createStatus(body: CreateTaskStatusBody): Promise<TaskWorkflow> {
    return data(apiClient.post<{ data: TaskWorkflow }>(`${BASE}/statuses`, body));
  },

  updateStatus(code: string, body: UpdateTaskStatusBody): Promise<TaskWorkflow> {
    return data(apiClient.patch<{ data: TaskWorkflow }>(`${BASE}/statuses/${encodeURIComponent(code)}`, body));
  },

  /** The whole list in its new order, one Command (issue #1560); 409 `ORDER_STALE` when it changed meanwhile. */
  reorderStatuses(orderedCodes: readonly string[]): Promise<TaskWorkflow> {
    return data(apiClient.put<{ data: TaskWorkflow }>(`${BASE}/statuses/order`, { orderedCodes }));
  },

  /** Removes a status; `replacement` takes the Tasks in it (required while any are). */
  deleteStatus(code: string, replacement?: string): Promise<TaskWorkflow> {
    const tail = replacement ? `?replacement=${encodeURIComponent(replacement)}` : '';
    return data(apiClient.delete<{ data: TaskWorkflow }>(`${BASE}/statuses/${encodeURIComponent(code)}${tail}`));
  },

  /** A delta of moves: added, removed. */
  setTransitions(body: SetTaskTransitionsBody): Promise<TaskWorkflow> {
    return data(apiClient.put<{ data: TaskWorkflow }>(`${BASE}/transitions`, body));
  },

  /** Deletes a Task; its sub-tasks become top-level, and the answer says how many the caller may see. */
  deleteTask(id: string): Promise<TaskDeleteResult> {
    return data(apiClient.delete<{ data: TaskDeleteResult }>(`${BASE}/${id}`));
  },

  /** Relates two Tasks, shown on both — `tasks:write` on both; nothing changes when they already are. */
  relate(taskId: string, otherId: string): Promise<void> {
    return apiClient.put<void>(`${BASE}/${taskId}/relations/${otherId}`, {});
  },

  /** Removes the link between two related Tasks, from either side. */
  unrelate(taskId: string, otherId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${taskId}/relations/${otherId}`);
  },

  /** Links a record to a Task — `tasks:write` and the record's own read code; answers the link (new or already there). */
  addLink(taskId: string, kind: TaskLinkKind, id: string): Promise<TaskLink> {
    return data(apiClient.post<{ data: TaskLink }>(`${BASE}/${taskId}/links`, { kind, id }));
  },

  /** Removes a link — an unavailable one too. */
  removeLink(taskId: string, linkId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${taskId}/links/${linkId}`);
  },

  /** What a Task may be linked to, of one kind, by number — `tasks:write`; empty for a kind the caller may not link. */
  lookupRecords(kind: TaskLinkKind, query = ''): Promise<TaskLookupOption[]> {
    const qs = new URLSearchParams({ kind });
    if (query.trim()) qs.set('q', query.trim());
    return data(apiClient.get<{ data: TaskLookupOption[] }>(`${BASE}/lookups/records?${qs.toString()}`));
  },

  /** Where a Task may be placed — a record with its groups (a Project with its Stages) — `tasks:write`. */
  lookupContexts(query = ''): Promise<TaskContextOption[]> {
    const tail = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    return data(apiClient.get<{ data: TaskContextOption[] }>(`${BASE}/lookups/contexts${tail}`));
  },

  /**
   * Active administrators by name or e-mail who may be assigned — `tasks:write`,
   * the assignee picker's source. A Task (`taskId`), or the record a new Task is
   * created in (`context`), narrows them to who may see it (#506).
   */
  assignees(
    q: string,
    scope: { taskId?: string; context?: { contextType: string; contextId: string } } = {},
  ): Promise<TaskAssigneeOption[]> {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (scope.taskId) qs.set('taskId', scope.taskId);
    if (scope.context) {
      qs.set('contextType', scope.context.contextType);
      qs.set('contextId', scope.context.contextId);
    }
    const query = qs.toString();
    return data(apiClient.get<{ data: TaskAssigneeOption[] }>(`${BASE}/lookups/assignees${query ? `?${query}` : ''}`));
  },

  /** The operator's priority list, most urgent first — `tasks:read`. */
  priorities(): Promise<TaskPriorityConfig[]> {
    return data(apiClient.get<{ data: TaskPriorityConfig[] }>(`${BASE}/priorities`));
  },

  /** `tasks:configure` — each answers the whole priority list as it stands afterwards. */
  createPriority(body: CreateTaskPriorityBody): Promise<TaskPriorityConfig[]> {
    return data(apiClient.post<{ data: TaskPriorityConfig[] }>(`${BASE}/priorities`, body));
  },

  updatePriority(code: string, body: UpdateTaskPriorityBody): Promise<TaskPriorityConfig[]> {
    return data(apiClient.patch<{ data: TaskPriorityConfig[] }>(`${BASE}/priorities/${encodeURIComponent(code)}`, body));
  },

  /** The whole list in its new order, most urgent first, one Command (issue #1560). */
  reorderPriorities(orderedCodes: readonly string[]): Promise<TaskPriorityConfig[]> {
    return data(apiClient.put<{ data: TaskPriorityConfig[] }>(`${BASE}/priorities/order`, { orderedCodes }));
  },

  /** Removes a priority; `replacement` — a code, or `none` — is what its Tasks get (required while any hold it). */
  deletePriority(code: string, replacement?: string): Promise<TaskPriorityConfig[]> {
    const tail = replacement ? `?replacement=${encodeURIComponent(replacement)}` : '';
    return data(apiClient.delete<{ data: TaskPriorityConfig[] }>(`${BASE}/priorities/${encodeURIComponent(code)}${tail}`));
  },

  /** The tag list, by name — `tasks:read`. A stable function: the kit's tag picker reads it once per mount. */
  listTags(): Promise<TaskTag[]> {
    return data(apiClient.get<{ data: TaskTag[] }>(`${BASE}/tags`));
  },

  /** `tasks:configure`; 409 `TASK_TAG_NAME_TAKEN` for a name taken in any case. */
  createTag(body: CreateTaskTagBody): Promise<TaskTag> {
    return data(apiClient.post<{ data: TaskTag }>(`${BASE}/tags`, body));
  },

  updateTag(id: string, body: UpdateTaskTagBody): Promise<TaskTag> {
    return data(apiClient.patch<{ data: TaskTag }>(`${BASE}/tags/${id}`, body));
  },

  /** Deletes a tag; it comes off every Task that carries it. */
  deleteTag(id: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/tags/${id}`);
  },

  /** Who a text of a Task may mention (`taskId` omitted on the create form). */
  lookupMentionable(taskId: string | null, query = ''): Promise<TaskAssigneeOption[]> {
    const qs = new URLSearchParams();
    if (taskId) qs.set('taskId', taskId);
    if (query.trim()) qs.set('q', query.trim());
    const tail = qs.toString();
    return data(apiClient.get<{ data: TaskAssigneeOption[] }>(`${BASE}/lookups/mentionable${tail ? `?${tail}` : ''}`));
  },

  /** The `@@` document list, grouped — `tasks:write`. */
  lookupDocuments(query = ''): Promise<RecordDocumentLookupResponse> {
    const tail = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    return apiClient.get<RecordDocumentLookupResponse>(`${BASE}/lookups/documents${tail}`);
  },

  /** Products by name or SKU, for `@@@` — `catalog`'s own list, behind `catalog:read`. */
  searchProducts(query: string): Promise<MentionableProduct[]> {
    const qs = new URLSearchParams({ page: '0', pageSize: '20' });
    if (query.trim()) qs.set('q', query.trim());
    return data(apiClient.get<{ data: MentionableProduct[] }>(`${PRODUCTS_BASE}?${qs.toString()}`));
  },

  listAttachments(taskId: string): Promise<TaskAttachment[]> {
    return data(apiClient.get<{ data: TaskAttachment[] }>(`${BASE}/${taskId}/attachments`));
  },

  /** The Task's own upload (multipart) — `tasks:write`; posted by the kit's `uploadAttachment`. */
  attachmentUploadPath(taskId: string): string {
    return `${BASE}/${taskId}/attachments/upload`;
  },

  removeAttachment(taskId: string, attachmentId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${taskId}/attachments/${attachmentId}`);
  },

  /** The comment thread, oldest first, a deleted comment in its place — `tasks:read`. */
  listComments(taskId: string): Promise<TaskComment[]> {
    return data(apiClient.get<{ data: TaskComment[] }>(`${BASE}/${taskId}/comments`));
  },

  /** A new comment — `tasks:read`, on a Task the caller may see. */
  addComment(taskId: string, body: string): Promise<TaskComment> {
    return data(apiClient.post<{ data: TaskComment }>(`${BASE}/${taskId}/comments`, { body }));
  },

  /** Edit a comment — its author only. */
  updateComment(taskId: string, commentId: string, body: string): Promise<TaskComment> {
    return data(apiClient.patch<{ data: TaskComment }>(`${BASE}/${taskId}/comments/${commentId}`, { body }));
  },

  /** Delete a comment — its author only; it stays in the thread, marked. */
  removeComment(taskId: string, commentId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${taskId}/comments/${commentId}`);
  },

  /** A reminder at a moment or before the due date, for the caller and assignees — `tasks:write`. */
  addReminder(taskId: string, body: CreateTaskReminderBody): Promise<TaskReminder> {
    return data(apiClient.post<{ data: TaskReminder }>(`${BASE}/${taskId}/reminders`, body));
  },

  /** Removes a reminder — its creator, or a writer. */
  removeReminder(taskId: string, reminderId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${taskId}/reminders/${reminderId}`);
  },

  /** The caller's daily digest: its hour, or `null` while it is off. */
  digest(): Promise<TaskDigestSubscription> {
    return data(apiClient.get<{ data: TaskDigestSubscription }>(`${BASE}/me/digest`));
  },

  /** Turns the caller's daily digest on, at `hour` of the Tasks time zone. */
  setDigest(hour: number): Promise<TaskDigestSubscription> {
    return data(apiClient.put<{ data: TaskDigestSubscription }>(`${BASE}/me/digest`, { hour }));
  },

  /** Turns the caller's daily digest off. */
  stopDigest(): Promise<void> {
    return apiClient.delete<void>(`${BASE}/me/digest`);
  },

  /** The Tasks time zone — `tasks:read`. */
  timeZone(): Promise<TaskTimeZone> {
    return data(apiClient.get<{ data: TaskTimeZone }>(`${BASE}/settings/time-zone`));
  },

  /** Sets the Tasks time zone — `tasks:configure`; 422 for a zone that is not one. */
  setTimeZone(timeZone: string): Promise<TaskTimeZone> {
    return data(apiClient.put<{ data: TaskTimeZone }>(`${BASE}/settings/time-zone`, { timeZone }));
  },

  history(id: string, cursor?: string): Promise<RecordHistoryPage> {
    return apiClient.get<RecordHistoryPage>(`${BASE}/${id}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  },
};
