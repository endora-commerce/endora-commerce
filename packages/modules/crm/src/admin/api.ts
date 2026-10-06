import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CreateOpportunityLinkRequest,
  OpportunityAssigneeOption,
  OpportunityContactOption,
  OpportunityOrganizationOption,
  OpportunitySalesChannelOption,
  CreateOpportunityRequest,
  CreateOpportunityStatusRequest,
  CreateOpportunityTagRequest,
  OpportunityAttachment,
  OpportunityComment,
  OpportunityCommentKind,
  OpportunityBoard,
  OpportunityDetail,
  OpportunityHistoryEntry,
  OpportunityLink,
  OpportunityQuoteRequestOption,
  OpportunityStatusKind,
  OpportunitySummary,
  OpportunityTag,
  OpportunityTransitionResult,
  OpportunityWorkflow,
  OrderStatusMapping,
  Pagination,
  PropagationOutcome,
  SetOpportunityTransitionsRequest,
  SetValueCountingStatusesRequest,
  UpdateOpportunityRequest,
  UpdateOpportunityStatusRequest,
  UpdateOpportunityTagRequest,
} from '@endora-commerce/contracts';

/**
 * The HTTP calls of the CRM admin screens
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §1–§4, §10).
 *
 * Every shape is `@endora-commerce/contracts`' — the schemas the backend
 * validates with — so a screen and a route cannot disagree about a field
 * without one of them failing to compile.
 *
 * Two reads are **not** CRM's: the Order statuses a mapping is chosen from and
 * the Orders an Opportunity can be linked to come from `orders`' own admin
 * endpoints, under `orders:read` — the code `crm:read` names in its `requires`.
 * CRM does not proxy them (§4), and naming the endpoint rather than importing
 * that module's client is the sanctioned way for one module's screen to read
 * another's data. Everything a **picker** chooses from — Organizations, Sales
 * Channels, assignees, contact persons — is CRM's own (§10a, research N-D4).
 */

const BASE = '/api/v1/admin/crm';
const ORDERS_BASE = '/api/v1/admin/orders';

export type OpportunitySort = 'createdAt' | 'updatedAt' | 'value' | 'expectedCloseDate' | 'number';

/**
 * The filters the list and the board share (`contracts/admin-api.md` §1, §10).
 * A filter both endpoints accept is added **here** and to
 * {@link appendSharedFilters}, and both screens can then send it.
 */
export interface OpportunityFilterParams {
  q?: string;
  organizationId?: string;
  /** `me`, `unassigned`, or an administrator's id. */
  assignedAdminUserId?: string;
  /** Every tag named must be carried (AND). */
  tagId?: readonly string[];
  salesChannelId?: string;
  createdFrom?: string;
  createdTo?: string;
}

/** The list's own parameters on top of the shared filters. */
export interface OpportunityListParams extends OpportunityFilterParams {
  state?: OpportunityStatusKind;
  statusCode?: readonly string[];
  sort?: OpportunitySort;
  order?: 'asc' | 'desc';
  cursor?: string;
  limit?: number;
}

/** The board takes the shared filters and nothing about status — its columns are the statuses. */
export interface OpportunityBoardParams extends OpportunityFilterParams {
  perColumn?: number;
}

export interface OpportunityListPage {
  data: OpportunitySummary[];
  pagination: Pagination;
}

/** An Order status as the mapping picker and the linked-order rows label it. */
export interface OrderStatusOption {
  code: string;
  name: Record<string, string>;
  defaultName?: string;
  color?: string;
}

/** An Order as the link picker offers it. */
export interface LinkableOrder {
  id: string;
  businessId: string;
  status: string;
  total: number;
  currency: string;
}

function appendSharedFilters(qs: URLSearchParams, params: OpportunityFilterParams): void {
  if (params.organizationId) qs.set('organizationId', params.organizationId);
  if (params.assignedAdminUserId) qs.set('assignedAdminUserId', params.assignedAdminUserId);
  for (const tagId of params.tagId ?? []) qs.append('tagId', tagId);
  if (params.salesChannelId) qs.set('salesChannelId', params.salesChannelId);
  if (params.createdFrom) qs.set('createdFrom', params.createdFrom);
  if (params.createdTo) qs.set('createdTo', params.createdTo);
}

function queryTail(qs: URLSearchParams): string {
  const tail = qs.toString();
  return tail ? `?${tail}` : '';
}

function listQuery(params: OpportunityListParams): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.state) qs.set('state', params.state);
  for (const code of params.statusCode ?? []) qs.append('statusCode', code);
  appendSharedFilters(qs, params);
  if (params.sort) qs.set('sort', params.sort);
  if (params.order) qs.set('order', params.order);
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  return queryTail(qs);
}

function boardQuery(params: OpportunityBoardParams): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  appendSharedFilters(qs, params);
  if (params.perColumn) qs.set('perColumn', String(params.perColumn));
  return queryTail(qs);
}

function data<T>(promise: Promise<{ data: T }>): Promise<T> {
  return promise.then((envelope) => envelope.data);
}

export const crmApi = {
  // --- §1 Opportunities ----------------------------------------------------

  listOpportunities(params: OpportunityListParams = {}): Promise<OpportunityListPage> {
    return apiClient.get<OpportunityListPage>(`${BASE}/opportunities${listQuery(params)}`);
  },

  getOpportunity(id: string): Promise<OpportunityDetail> {
    return data(apiClient.get<{ data: OpportunityDetail }>(`${BASE}/opportunities/${id}`));
  },

  createOpportunity(body: CreateOpportunityRequest): Promise<OpportunityDetail> {
    return data(apiClient.post<{ data: OpportunityDetail }>(`${BASE}/opportunities`, body));
  },

  /**
   * Edit an Opportunity. `version` is the one the edited values were read at,
   * sent as `If-Match`: the server answers 409 `VERSION_CONFLICT` when somebody
   * else saved in between, and nothing is written.
   */
  updateOpportunity(
    id: string,
    body: UpdateOpportunityRequest,
    version: number,
  ): Promise<OpportunityDetail> {
    return data(
      apiClient.patch<{ data: OpportunityDetail }>(`${BASE}/opportunities/${id}`, body, {
        headers: { 'If-Match': `"${version}"` },
      }),
    );
  },

  /** Gated `crm:configure`: the Opportunity goes with its links and its history. */
  deleteOpportunity(id: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/opportunities/${id}`);
  },

  // --- §2 Transition -------------------------------------------------------

  /** `reason` is optional and recorded with the status change. */
  transition(id: string, to: string, reason?: string): Promise<OpportunityTransitionResult> {
    return data(
      apiClient.post<{ data: OpportunityTransitionResult }>(
        `${BASE}/opportunities/${id}/transition`,
        reason ? { to, reason } : { to },
      ),
    );
  },

  retryPropagation(id: string, propagationId: string): Promise<PropagationOutcome> {
    return data(
      apiClient.post<{ data: PropagationOutcome }>(
        `${BASE}/opportunities/${id}/propagations/${propagationId}/retry`,
      ),
    );
  },

  dismissPropagation(id: string, propagationId: string): Promise<void> {
    return apiClient.post<void>(
      `${BASE}/opportunities/${id}/propagations/${propagationId}/dismiss`,
    );
  },

  // --- §5 Assignment -------------------------------------------------------

  /** Assign, reassign or — with `null` — unassign. Answers the Opportunity. */
  assign(id: string, adminUserId: string | null): Promise<OpportunityDetail> {
    return data(
      apiClient.post<{ data: OpportunityDetail }>(`${BASE}/opportunities/${id}/assign`, {
        adminUserId,
      }),
    );
  },

  // --- §3 Links ------------------------------------------------------------

  addLink(id: string, body: CreateOpportunityLinkRequest): Promise<OpportunityLink> {
    return data(
      apiClient.post<{ data: OpportunityLink }>(`${BASE}/opportunities/${id}/links`, body),
    );
  },

  setLinkSync(id: string, linkId: string, syncStatus: boolean): Promise<OpportunityLink> {
    return data(
      apiClient.patch<{ data: OpportunityLink }>(`${BASE}/opportunities/${id}/links/${linkId}`, {
        syncStatus,
      }),
    );
  },

  removeLink(id: string, linkId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/opportunities/${id}/links/${linkId}`);
  },

  // --- §4 Workflow configuration -------------------------------------------

  getWorkflow(): Promise<OpportunityWorkflow> {
    return data(apiClient.get<{ data: OpportunityWorkflow }>(`${BASE}/workflow`));
  },

  createStatus(body: CreateOpportunityStatusRequest): Promise<OpportunityWorkflow> {
    return data(apiClient.post<{ data: OpportunityWorkflow }>(`${BASE}/statuses`, body));
  },

  updateStatus(code: string, body: UpdateOpportunityStatusRequest): Promise<OpportunityWorkflow> {
    return data(apiClient.patch<{ data: OpportunityWorkflow }>(`${BASE}/statuses/${code}`, body));
  },

  deleteStatus(code: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/statuses/${code}`);
  },

  setTransitions(body: SetOpportunityTransitionsRequest): Promise<OpportunityWorkflow> {
    return data(apiClient.put<{ data: OpportunityWorkflow }>(`${BASE}/transitions`, body));
  },

  setOrderStatusMappings(mappings: OrderStatusMapping[]): Promise<OpportunityWorkflow> {
    return data(
      apiClient.put<{ data: OpportunityWorkflow }>(`${BASE}/order-status-mappings`, { mappings }),
    );
  },

  // --- §6 Notes and messages -----------------------------------------------

  /** Oldest first. `kind` is required by the endpoint: the two are separate lists. */
  listComments(id: string, kind: OpportunityCommentKind): Promise<OpportunityComment[]> {
    return data(
      apiClient.get<{ data: OpportunityComment[] }>(
        `${BASE}/opportunities/${id}/comments?kind=${kind}`,
      ),
    );
  },

  addComment(id: string, kind: OpportunityCommentKind, body: string): Promise<OpportunityComment> {
    return data(
      apiClient.post<{ data: OpportunityComment }>(`${BASE}/opportunities/${id}/comments`, {
        kind,
        body,
      }),
    );
  },

  /** A note, by its author. A message answers 409 `CRM_MESSAGE_IMMUTABLE` whoever asks. */
  updateComment(id: string, commentId: string, body: string): Promise<OpportunityComment> {
    return data(
      apiClient.patch<{ data: OpportunityComment }>(
        `${BASE}/opportunities/${id}/comments/${commentId}`,
        { body },
      ),
    );
  },

  deleteComment(id: string, commentId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/opportunities/${id}/comments/${commentId}`);
  },

  // --- §7 Attachments ------------------------------------------------------

  /**
   * Oldest first. Each carries `url`, a signed link valid for a few minutes —
   * read the list again right before opening one.
   */
  listAttachments(id: string): Promise<OpportunityAttachment[]> {
    return data(
      apiClient.get<{ data: OpportunityAttachment[] }>(`${BASE}/opportunities/${id}/attachments`),
    );
  },

  /** Link a **private** asset of the media library; a public one is refused with 422. */
  addAttachment(id: string, assetId: string): Promise<OpportunityAttachment> {
    return data(
      apiClient.post<{ data: OpportunityAttachment }>(`${BASE}/opportunities/${id}/attachments`, {
        assetId,
      }),
    );
  },

  /** Removes the link; the file stays in the media library. */
  removeAttachment(id: string, attachmentId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/opportunities/${id}/attachments/${attachmentId}`);
  },

  // --- §8 Tags --------------------------------------------------------------

  /** The platform's tag list, by name, each with how many visible Opportunities carry it. */
  listTags(): Promise<OpportunityTag[]> {
    return data(apiClient.get<{ data: OpportunityTag[] }>(`${BASE}/tags`));
  },

  createTag(body: CreateOpportunityTagRequest): Promise<OpportunityTag> {
    return data(apiClient.post<{ data: OpportunityTag }>(`${BASE}/tags`, body));
  },

  updateTag(id: string, body: UpdateOpportunityTagRequest): Promise<OpportunityTag> {
    return data(apiClient.patch<{ data: OpportunityTag }>(`${BASE}/tags/${id}`, body));
  },

  /** Takes the tag off every Opportunity that carried it. */
  deleteTag(id: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/tags/${id}`);
  },

  /** Replaces the Opportunity's whole tag set. Answers the Opportunity. */
  setOpportunityTags(id: string, tagIds: readonly string[]): Promise<OpportunityDetail> {
    return data(
      apiClient.put<{ data: OpportunityDetail }>(`${BASE}/opportunities/${id}/tags`, { tagIds }),
    );
  },

  // --- §10 Board ------------------------------------------------------------

  /** One column per status, with its figures and its first cards. A read; a move is `transition`. */
  getBoard(params: OpportunityBoardParams = {}): Promise<OpportunityBoard> {
    return data(apiClient.get<{ data: OpportunityBoard }>(`${BASE}/board${boardQuery(params)}`));
  },

  // --- §10a Lookups — what the pickers choose from ----------------------------

  lookupOrganizations(query = ''): Promise<OpportunityOrganizationOption[]> {
    return data(
      apiClient.get<{ data: OpportunityOrganizationOption[] }>(
        `${BASE}/lookups/organizations${query ? `?q=${encodeURIComponent(query)}` : ''}`,
      ),
    );
  },

  /**
   * The name of one Organization, or `null` when it cannot be read — a label
   * for a preselection, never a precondition of the write that follows.
   */
  organizationName(organizationId: string): Promise<string | null> {
    return apiClient
      .get<{ data: OpportunityOrganizationOption[] }>(
        `${BASE}/lookups/organizations?id=${organizationId}`,
      )
      .then((envelope) => envelope.data[0]?.name ?? null)
      .catch(() => null);
  },

  lookupSalesChannels(): Promise<OpportunitySalesChannelOption[]> {
    return data(
      apiClient.get<{ data: OpportunitySalesChannelOption[] }>(`${BASE}/lookups/sales-channels`),
    );
  },

  lookupAssignees(query = ''): Promise<OpportunityAssigneeOption[]> {
    return data(
      apiClient.get<{ data: OpportunityAssigneeOption[] }>(
        `${BASE}/lookups/assignees${query ? `?q=${encodeURIComponent(query)}` : ''}`,
      ),
    );
  },

  /** Gated `crm:write`: a contact person is chosen on the forms only. */
  lookupContacts(organizationId: string, query = ''): Promise<OpportunityContactOption[]> {
    const qs = new URLSearchParams({ organizationId });
    if (query) qs.set('q', query);
    return data(
      apiClient.get<{ data: OpportunityContactOption[] }>(
        `${BASE}/lookups/contacts?${qs.toString()}`,
      ),
    );
  },

  // --- Wave 2: value, Quote Requests, history (User Stories 8, 11) ----------

  /**
   * The Organization's Quote Requests that can be linked — CRM's own lookup,
   * behind `crm:write` (research N-H2). Rejects with 503 `MODULE_DISABLED`
   * while `quote_requests` is off.
   */
  lookupQuoteRequests(
    organizationId: string,
    query = '',
  ): Promise<OpportunityQuoteRequestOption[]> {
    const qs = new URLSearchParams({ organizationId });
    const q = query.trim();
    if (q) qs.set('q', q);
    return data(
      apiClient.get<{ data: OpportunityQuoteRequestOption[] }>(
        `${BASE}/lookups/quote-requests?${qs.toString()}`,
      ),
    );
  },

  /**
   * Answers **202**: the set is saved, and every computed Opportunity is
   * recalculated afterwards, by a queue job — the figures on screen are the
   * previous configuration's until it has run.
   */
  setValueCountingStatuses(body: SetValueCountingStatusesRequest): Promise<OpportunityWorkflow> {
    return data(
      apiClient.put<{ data: OpportunityWorkflow }>(`${BASE}/value-counting-statuses`, body),
    );
  },

  /** Newest first; `cursor` is the one the previous page answered. */
  getHistory(
    id: string,
    params: { cursor?: string; limit?: number } = {},
  ): Promise<{ data: OpportunityHistoryEntry[]; pagination: Pagination }> {
    const qs = new URLSearchParams();
    if (params.cursor) qs.set('cursor', params.cursor);
    if (params.limit) qs.set('limit', String(params.limit));
    return apiClient.get<{ data: OpportunityHistoryEntry[]; pagination: Pagination }>(
      `${BASE}/opportunities/${id}/history${queryTail(qs)}`,
    );
  },

  // --- Other modules' endpoints, by path --------------------------------------

  listOrderStatuses(): Promise<OrderStatusOption[]> {
    return apiClient
      .get<{ data: { statuses: OrderStatusOption[] } }>(`${ORDERS_BASE}/statuses`)
      .then((envelope) => envelope.data.statuses);
  },

  /** Orders of one Organization, by number — what the link picker searches. */
  searchOrders(organizationId: string, query: string): Promise<LinkableOrder[]> {
    const qs = new URLSearchParams();
    qs.set('organizationId', organizationId);
    const q = query.trim();
    if (q) qs.set('q', q);
    qs.set('page', '1');
    qs.set('pageSize', '20');
    return apiClient
      .get<{ data: LinkableOrder[] }>(`${ORDERS_BASE}?${qs.toString()}`)
      .then((envelope) => envelope.data);
  },
};
