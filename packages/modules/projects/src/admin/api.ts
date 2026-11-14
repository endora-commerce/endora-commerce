import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CloseProjectBody,
  CreateProjectBody,
  CreateProjectRoleBody,
  CreateProjectStageBody,
  ProjectDetail,
  ProjectListResponse,
  ProjectLossReason,
  ProjectMoveResult,
  ProjectRole,
  ProjectStage,
  ProjectStageEntry,
  ProjectStageMove,
  ProjectState,
  ProjectTasksResponse,
  ProjectTemplateBody,
  ProjectTemplateDetail,
  ProjectTemplateSummary,
  ProjectAdminUserOption,
  ProjectAttachment,
  ProjectComment,
  ProjectCommentKind,
  ProjectLink,
  ProjectMentionableOption,
  ProjectOrganizationOption,
  ProjectPanelRecordKind,
  ProjectRecordKind,
  ProjectSummary,
  ProjectVisibilitySetting,
  MaterializeStageTasksResult,
  SetProjectMovesResult,
  StageTaskDefinition,
  RecordDocumentLookupResponse,
  RecordHistoryPage,
  TaskSummary,
  UpdateProjectBody,
  UpdateProjectRoleBody,
  UpdateProjectStageBody,
} from '@endora-commerce/contracts';

/**
 * The HTTP calls of the Projects admin screens
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.1, §2.2, §2.5 — Templates included).
 *
 * Every shape is `@endora-commerce/contracts`' — the schemas the backend
 * validates with — so a screen and a route cannot disagree about a field
 * without one of them failing to compile. Successful answers are `{ data }`
 * envelopes, except the list, which answers `{ items, nextCursor, total }`.
 *
 * Every write that changes where a Project is — a move, a close, a reopen —
 * names the `version` it was read at; the server answers 409 `PROJECT_CHANGED`
 * when somebody else changed the Project in between, and nothing is written.
 */

const BASE = '/api/v1/admin/projects';

/**
 * The Tasks module's own create route. A Project's Task is created there, not
 * through a Projects route: it names the Project and one of its Stages as its
 * context, and the Tasks module asks this one whether the caller may see them.
 */
const TASKS_BASE = '/api/v1/admin/tasks';

export type ProjectSort = 'createdAt' | 'value' | 'deadline';

/** A record a picker offers to link: what identifies it to the person choosing. */
export interface LinkableRecord {
  id: string;
  /** The record's number — `ORD-…`, `RFQ-…`, `OPP-…`. */
  number: string;
  /** A second line — the status, an Opportunity's title. */
  detail: string;
}

/** How many records a link picker offers per search. */
const LINKABLE_LIMIT = 20;

/**
 * The owners' own list routes, each gated by the owner's read code
 * (task T094, research R-10 — verified 2026-10-27):
 *
 * - `GET /orders?organizationId=&q=&page=&pageSize=` — both filters, as CRM's
 *   Order picker uses them (`orders:read`);
 * - `GET /crm/opportunities?organizationId=&q=&limit=` — both filters
 *   (`OpportunityListQuerySchema`, `crm:read`);
 * - `GET /quote-requests?organizationId=` — the Organization filter only: the
 *   route reads no `q` and answers the Organization's whole list
 *   (`rfqs:handle`), so the number is matched here. No global search needed.
 */
/** `catalog`'s own Product list, behind `catalog:read` — the `@@@` search (CRM's precedent). */
const PRODUCTS_BASE = '/api/v1/admin/catalog/products';

/** A Product as the `@@@` search offers it. */
export interface MentionableProduct {
  id: string;
  sku: string;
  name: Record<string, string>;
}

/** How many entries one page of a history asks for. */
export const HISTORY_PAGE_SIZE = 50;

/**
 * A name from an owner's per-language map (`orders`' `statusName`): the
 * language, else a regional variant of it (`pl` → `pl-PL`), else none.
 */
function namedIn(names: Record<string, string> | undefined, language: string): string | undefined {
  if (!names) return undefined;
  const regional = Object.keys(names).find((key) => key.startsWith(`${language}-`));
  return names[language] || (regional ? names[regional] : undefined) || undefined;
}

const OWNER_LISTS = {
  orders: '/api/v1/admin/orders',
  quoteRequests: '/api/v1/admin/quote-requests',
  opportunities: '/api/v1/admin/crm/opportunities',
} as const;

/** The two configuration dictionaries, by their path segment. Both have one shape (`ProjectRole`). */
export type ProjectDictionaryKind = 'roles' | 'loss-reasons';

export interface ProjectListParams {
  q?: string;
  state?: readonly ProjectState[];
  organizationId?: string;
  /** An administrator's id, or `me`. */
  memberId?: string;
  /** Projects in which some Member holds this Project Role. */
  roleId?: string;
  /** Projects created from this Template. */
  templateId?: string;
  /** The current Stage's name, case-insensitive. */
  stageName?: string;
  /** Custom fields marked as list filters, as the JSON `toCustomFieldFiltersParam` writes. */
  customFieldFilters?: string;
  sort?: ProjectSort;
  order?: 'asc' | 'desc';
  cursor?: string;
  limit?: number;
}

function listQuery(params: ProjectListParams): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  for (const state of params.state ?? []) qs.append('state', state);
  if (params.organizationId) qs.set('organizationId', params.organizationId);
  if (params.memberId) qs.set('memberId', params.memberId);
  if (params.roleId) qs.set('roleId', params.roleId);
  if (params.templateId) qs.set('templateId', params.templateId);
  if (params.stageName) qs.set('stageName', params.stageName);
  if (params.customFieldFilters) qs.set('customFieldFilters', params.customFieldFilters);
  if (params.sort) qs.set('sort', params.sort);
  if (params.order) qs.set('order', params.order);
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  const tail = qs.toString();
  return tail ? `?${tail}` : '';
}

function data<T>(promise: Promise<{ data: T }>): Promise<T> {
  return promise.then((envelope) => envelope.data);
}

export const projectsApi = {
  // --- §2.1 Projects -------------------------------------------------------

  listProjects(params: ProjectListParams = {}): Promise<ProjectListResponse> {
    return apiClient.get<ProjectListResponse>(`${BASE}${listQuery(params)}`);
  },

  getProject(id: string): Promise<ProjectDetail> {
    return data(apiClient.get<{ data: ProjectDetail }>(`${BASE}/${id}`));
  },

  createProject(body: CreateProjectBody): Promise<ProjectDetail> {
    return data(apiClient.post<{ data: ProjectDetail }>(BASE, body));
  },

  /**
   * Title, description, value, start date and who sees the Project, against
   * the `version` read; 409 `PROJECT_CHANGED` when somebody changed it since.
   */
  updateProject(id: string, body: UpdateProjectBody): Promise<ProjectDetail> {
    return data(apiClient.patch<{ data: ProjectDetail }>(`${BASE}/${id}`, body));
  },

  /** 409 `PROJECT_HAS_LINKS` while records are linked; the Project's Tasks go with it. */
  deleteProject(id: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${id}`);
  },

  // --- §2.1a Lookups — what the pickers choose from (User Story 5) ----------
  //
  // The module's own, gated `projects:read` (the list's filters are a reader's): the kit's pickers read
  // `/organizations` and `/admin-users`, behind codes somebody running
  // Projects need not hold.

  /** Organizations in the caller's reach, by name. */
  lookupOrganizations(query = ''): Promise<ProjectOrganizationOption[]> {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    return data(apiClient.get<{ data: ProjectOrganizationOption[] }>(`${BASE}/lookups/organizations${qs}`));
  },

  /** Active administrators, by name or e-mail. */
  lookupAdminUsers(query = ''): Promise<ProjectAdminUserOption[]> {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    return data(apiClient.get<{ data: ProjectAdminUserOption[] }>(`${BASE}/lookups/admin-users${qs}`));
  },

  /**
   * The name of one administrator, or `null` when it cannot be read — the
   * label of a value chosen earlier (an address), never a precondition.
   */
  adminUserName(id: string): Promise<string | null> {
    return apiClient
      .get<{ data: ProjectAdminUserOption[] }>(`${BASE}/lookups/admin-users?id=${encodeURIComponent(id)}`)
      .then((envelope) => envelope.data[0]?.name ?? null)
      .catch(() => null);
  },

  /**
   * One Organization in the caller's reach, or `null` when it is out of reach,
   * missing or cannot be read — a value an address carries (the Organization
   * screen's "New project"), never a precondition.
   */
  organizationOption(id: string): Promise<ProjectOrganizationOption | null> {
    return apiClient
      .get<{ data: ProjectOrganizationOption[] }>(`${BASE}/lookups/organizations?id=${encodeURIComponent(id)}`)
      .then((envelope) => envelope.data[0] ?? null)
      .catch(() => null);
  },

  /** The module setting `projects.visibility`, which *Follow the module setting* means. */
  visibilitySetting(): Promise<ProjectVisibilitySetting> {
    return data(apiClient.get<{ data: { setting: ProjectVisibilitySetting } }>(`${BASE}/visibility-setting`)).then(
      (answer) => answer.setting,
    );
  },

  // --- §2.3 Links and the record panel (User Story 6) -----------------------

  /** The Project's linked records, oldest first; one the reader may not read is `available: false`. */
  listLinks(projectId: string): Promise<ProjectLink[]> {
    return data(apiClient.get<{ data: ProjectLink[] }>(`${BASE}/${projectId}/links`));
  },

  /**
   * 404 `PROJECT_RECORD_NOT_FOUND`; 409 `PROJECT_RECORD_ALREADY_LINKED` (its
   * `details.project` names the holder to somebody who may see it); 422
   * `PROJECT_LINK_ORGANIZATION_MISMATCH`; 503 while the record's module is off.
   */
  addLink(projectId: string, kind: ProjectRecordKind, recordId: string): Promise<ProjectLink> {
    return data(apiClient.post<{ data: ProjectLink }>(`${BASE}/${projectId}/links`, { kind, recordId }));
  },

  removeLink(projectId: string, linkId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${projectId}/links/${linkId}`);
  },

  /** The Project a record is in; rejects with 404 when it is in none the reader may see. */
  projectOfRecord(kind: ProjectPanelRecordKind, recordId: string): Promise<ProjectSummary> {
    return data(apiClient.get<{ data: ProjectSummary }>(`${BASE}/records/${kind}/${recordId}/project`));
  },

  /**
   * Records of one kind and Organization a link picker offers, by number (task
   * T094), each with its status named as its owner's list names it, in
   * `language` (issue #455).
   */
  linkableRecords(kind: ProjectRecordKind, organizationId: string, query: string, language: string): Promise<LinkableRecord[]> {
    const q = query.trim();
    if (kind === 'order') {
      const qs = new URLSearchParams({ organizationId, page: '1', pageSize: String(LINKABLE_LIMIT) });
      if (q) qs.set('q', q);
      return apiClient
        .get<{ data: Array<{ id: string; businessId: string; status: string; statusName?: Record<string, string> }> }>(
          `${OWNER_LISTS.orders}?${qs.toString()}`,
        )
        .then((envelope) =>
          envelope.data.map((order) => ({
            id: order.id,
            number: order.businessId,
            detail: namedIn(order.statusName, language) ?? order.status,
          })),
        );
    }
    if (kind === 'opportunity') {
      const qs = new URLSearchParams({ organizationId, limit: String(LINKABLE_LIMIT) });
      if (q) qs.set('q', q);
      return apiClient
        .get<{ data: Array<{ id: string; number: string; title: string }> }>(`${OWNER_LISTS.opportunities}?${qs.toString()}`)
        .then((envelope) =>
          envelope.data.map((opportunity) => ({ id: opportunity.id, number: opportunity.number, detail: opportunity.title })),
        );
    }
    const qs = new URLSearchParams({ organizationId });
    const needle = q.toLowerCase();
    return apiClient
      .get<{ data: Array<{ id: string; businessId: string; status: string; statusName?: string }> }>(
        `${OWNER_LISTS.quoteRequests}?${qs.toString()}`,
      )
      .then((envelope) =>
        envelope.data
          .filter((request) => needle === '' || request.businessId.toLowerCase().includes(needle))
          .slice(0, LINKABLE_LIMIT)
          .map((request) => ({ id: request.id, number: request.businessId, detail: request.statusName ?? request.status })),
      );
  },

  // --- §2.2 Stages and moves -----------------------------------------------

  createStage(projectId: string, body: CreateProjectStageBody): Promise<ProjectStage> {
    return data(apiClient.post<{ data: ProjectStage }>(`${BASE}/${projectId}/stages`, body));
  },

  updateStage(projectId: string, stageId: string, body: UpdateProjectStageBody): Promise<ProjectStage> {
    return data(apiClient.patch<{ data: ProjectStage }>(`${BASE}/${projectId}/stages/${stageId}`, body));
  },

  deleteStage(projectId: string, stageId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${projectId}/stages/${stageId}`);
  },

  /** Every Stage id of the Project, in the new order; answers the Project. */
  reorderStages(projectId: string, stageIds: readonly string[]): Promise<ProjectDetail> {
    return data(apiClient.put<{ data: ProjectDetail }>(`${BASE}/${projectId}/stages/order`, { stageIds }));
  },

  /** The whole workflow, replaced. */
  setMoves(projectId: string, moves: readonly ProjectStageMove[]): Promise<SetProjectMovesResult> {
    return data(apiClient.put<{ data: SetProjectMovesResult }>(`${BASE}/${projectId}/moves`, { moves }));
  },

  move(projectId: string, toStageId: string, version: number): Promise<ProjectMoveResult> {
    return data(apiClient.post<{ data: ProjectMoveResult }>(`${BASE}/${projectId}/move`, { toStageId, version }));
  },

  close(projectId: string, body: CloseProjectBody): Promise<ProjectDetail> {
    return data(apiClient.post<{ data: ProjectDetail }>(`${BASE}/${projectId}/close`, body));
  },

  reopen(projectId: string, version: number): Promise<ProjectDetail> {
    return data(apiClient.post<{ data: ProjectDetail }>(`${BASE}/${projectId}/reopen`, { version }));
  },

  /** The Tasks a Stage creates on entry, the whole list replaced; answers the Stage. */
  setStageTasks(projectId: string, stageId: string, tasks: readonly StageTaskDefinition[]): Promise<ProjectStage> {
    return data(apiClient.put<{ data: ProjectStage }>(`${BASE}/${projectId}/stages/${stageId}/tasks`, { tasks }));
  },

  /**
   * Create a Stage's Tasks again after creating them failed on entry
   * (`tasksMaterializeFailed`); 409 `PROJECT_STAGE_TASKS_NOT_RETRYABLE` otherwise.
   */
  retryStageTasks(projectId: string, stageId: string): Promise<MaterializeStageTasksResult> {
    return data(
      apiClient.post<{ data: MaterializeStageTasksResult }>(`${BASE}/${projectId}/stages/${stageId}/materialize-tasks`),
    );
  },

  /** The Project's Tasks by Stage; `tasksAvailable: false` while Tasks is off or unreadable for the caller. */
  projectTasks(projectId: string): Promise<ProjectTasksResponse> {
    return data(apiClient.get<{ data: ProjectTasksResponse }>(`${BASE}/${projectId}/tasks`));
  },

  /** A new Task in one of the Project's Stages. */
  addStageTask(projectId: string, stageId: string, title: string): Promise<TaskSummary> {
    return data(
      apiClient.post<{ data: TaskSummary }>(TASKS_BASE, {
        title,
        context: { contextType: 'project', contextId: projectId, contextGroupId: stageId },
      }),
    );
  },

  stageHistory(projectId: string): Promise<ProjectStageEntry[]> {
    return data(apiClient.get<{ data: ProjectStageEntry[] }>(`${BASE}/${projectId}/stage-history`));
  },

  // --- §2.4 Collaboration (User Story 7) ------------------------------------

  listComments(projectId: string, kind: ProjectCommentKind): Promise<ProjectComment[]> {
    return data(apiClient.get<{ data: ProjectComment[] }>(`${BASE}/${projectId}/comments?kind=${kind}`));
  },

  addComment(projectId: string, kind: ProjectCommentKind, body: string): Promise<ProjectComment> {
    return data(apiClient.post<{ data: ProjectComment }>(`${BASE}/${projectId}/comments`, { kind, body }));
  },

  /** A note, by its author; a message never changes. */
  updateComment(projectId: string, commentId: string, body: string): Promise<ProjectComment> {
    return data(apiClient.patch<{ data: ProjectComment }>(`${BASE}/${projectId}/comments/${commentId}`, { body }));
  },

  deleteComment(projectId: string, commentId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${projectId}/comments/${commentId}`);
  },

  /** The caller has read the thread up to and including this message; answers what is left unread. */
  markMessagesRead(projectId: string, throughMessageId: string): Promise<{ unreadMessageCount: number }> {
    return data(
      apiClient.post<{ data: { unreadMessageCount: number } }>(`${BASE}/${projectId}/messages/read`, {
        throughMessageId,
      }),
    );
  },

  /** Each with a short-lived download link: read again right before one is opened. */
  listAttachments(projectId: string): Promise<ProjectAttachment[]> {
    return data(apiClient.get<{ data: ProjectAttachment[] }>(`${BASE}/${projectId}/attachments`));
  },

  /** The path of the Project's own upload, behind `projects:write` alone (the kit's `uploadAttachment`). */
  attachmentUploadPath(projectId: string): string {
    return `${BASE}/${projectId}/attachments/upload`;
  },

  removeAttachment(projectId: string, attachmentId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${projectId}/attachments/${attachmentId}`);
  },

  history(projectId: string, cursor: string | null): Promise<RecordHistoryPage> {
    const qs = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
    if (cursor) qs.set('cursor', cursor);
    return apiClient.get<RecordHistoryPage>(`${BASE}/${projectId}/history?${qs.toString()}`);
  },

  /** The people who may see the Project — or, before there is one, who may read Projects. */
  lookupMentionable(projectId: string | null, query = ''): Promise<ProjectMentionableOption[]> {
    const qs = new URLSearchParams();
    if (projectId) qs.set('projectId', projectId);
    if (query.trim()) qs.set('q', query.trim());
    const tail = qs.toString();
    return data(apiClient.get<{ data: ProjectMentionableOption[] }>(`${BASE}/lookups/mentionable${tail ? `?${tail}` : ''}`));
  },

  /**
   * The `@@` document list — answered unwrapped, CRM's shape (FR-044). Before
   * there is a Project, `organizationIds` names the Organizations chosen on the
   * create form; beside a Project the server ignores it, so none is sent.
   */
  lookupDocuments(
    projectId: string | null,
    query = '',
    organizationIds: readonly string[] = [],
  ): Promise<RecordDocumentLookupResponse> {
    const qs = new URLSearchParams();
    if (projectId) qs.set('projectId', projectId);
    else for (const organizationId of organizationIds) qs.append('organizationIds', organizationId);
    if (query.trim()) qs.set('q', query.trim());
    const tail = qs.toString();
    return apiClient.get<RecordDocumentLookupResponse>(`${BASE}/lookups/documents${tail ? `?${tail}` : ''}`);
  },

  searchProducts(query: string): Promise<MentionableProduct[]> {
    const qs = new URLSearchParams({ page: '0', pageSize: '20' });
    if (query.trim()) qs.set('q', query.trim());
    return data(apiClient.get<{ data: MentionableProduct[] }>(`${PRODUCTS_BASE}?${qs.toString()}`));
  },

  // --- §2.5 Configuration (reads) ------------------------------------------

  /**
   * The Project Roles, each with a `label` in the reader's language. `active`
   * leaves archived Roles out — what a picker offers; a Project's screen asks
   * for all of them, because it still shows the ones it uses.
   */
  listRoles(options: { active?: boolean } = {}): Promise<ProjectRole[]> {
    return data(apiClient.get<{ data: ProjectRole[] }>(`${BASE}/roles${options.active ? '?active=true' : ''}`));
  },

  listLossReasons(options: { active?: boolean } = {}): Promise<ProjectLossReason[]> {
    return data(
      apiClient.get<{ data: ProjectLossReason[] }>(`${BASE}/loss-reasons${options.active ? '?active=true' : ''}`),
    );
  },

  // --- §2.5 Project Roles and loss reasons — writes (User Story 4) -----------

  /** `kind` is the dictionary's path segment; every write is `projects:configure`. */
  createDictionaryEntry(kind: ProjectDictionaryKind, body: CreateProjectRoleBody): Promise<ProjectRole> {
    return data(apiClient.post<{ data: ProjectRole }>(`${BASE}/${kind}`, body));
  },

  updateDictionaryEntry(kind: ProjectDictionaryKind, id: string, body: UpdateProjectRoleBody): Promise<ProjectRole> {
    return data(apiClient.patch<{ data: ProjectRole }>(`${BASE}/${kind}/${id}`, body));
  },

  archiveDictionaryEntry(kind: ProjectDictionaryKind, id: string): Promise<ProjectRole> {
    return data(apiClient.post<{ data: ProjectRole }>(`${BASE}/${kind}/${id}/archive`));
  },

  restoreDictionaryEntry(kind: ProjectDictionaryKind, id: string): Promise<ProjectRole> {
    return data(apiClient.post<{ data: ProjectRole }>(`${BASE}/${kind}/${id}/restore`));
  },

  /** 409 for a built-in row or one a Project or Template uses. */
  deleteDictionaryEntry(kind: ProjectDictionaryKind, id: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${kind}/${id}`);
  },

  // --- §2.5 Templates (User Story 3) -----------------------------------------

  /** `active` leaves archived Templates out — what the create screen offers. */
  listTemplates(options: { active?: boolean } = {}): Promise<ProjectTemplateSummary[]> {
    return data(
      apiClient.get<{ data: ProjectTemplateSummary[] }>(`${BASE}/templates${options.active ? '?active=true' : ''}`),
    );
  },

  getTemplate(id: string): Promise<ProjectTemplateDetail> {
    return data(apiClient.get<{ data: ProjectTemplateDetail }>(`${BASE}/templates/${id}`));
  },

  createTemplate(body: ProjectTemplateBody): Promise<ProjectTemplateDetail> {
    return data(apiClient.post<{ data: ProjectTemplateDetail }>(`${BASE}/templates`, body));
  },

  /** The whole Template replaced in one request. */
  saveTemplate(id: string, body: ProjectTemplateBody): Promise<ProjectTemplateDetail> {
    return data(apiClient.put<{ data: ProjectTemplateDetail }>(`${BASE}/templates/${id}`, body));
  },

  duplicateTemplate(id: string): Promise<ProjectTemplateDetail> {
    return data(apiClient.post<{ data: ProjectTemplateDetail }>(`${BASE}/templates/${id}/duplicate`));
  },

  archiveTemplate(id: string): Promise<ProjectTemplateDetail> {
    return data(apiClient.post<{ data: ProjectTemplateDetail }>(`${BASE}/templates/${id}/archive`));
  },

  restoreTemplate(id: string): Promise<ProjectTemplateDetail> {
    return data(apiClient.post<{ data: ProjectTemplateDetail }>(`${BASE}/templates/${id}/restore`));
  },
};
