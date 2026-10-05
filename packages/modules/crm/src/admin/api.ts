import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CreateOpportunityLinkRequest,
  CreateOpportunityRequest,
  CreateOpportunityStatusRequest,
  OpportunityBoard,
  OpportunityDetail,
  OpportunityLink,
  OpportunityStatusKind,
  OpportunitySummary,
  OpportunityTransitionResult,
  OpportunityWorkflow,
  OrderStatusMapping,
  Pagination,
  PropagationOutcome,
  SetOpportunityTransitionsRequest,
  UpdateOpportunityRequest,
  UpdateOpportunityStatusRequest,
} from '@endora-commerce/contracts';

/**
 * The HTTP calls of the CRM admin screens
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §1–§4, §10).
 *
 * Every shape is `@endora-commerce/contracts`' — the schemas the backend
 * validates with — so a screen and a route cannot disagree about a field
 * without one of them failing to compile.
 *
 * Three reads are **not** CRM's: the Order statuses a mapping is chosen from
 * and the Orders an Opportunity can be linked to come from `orders`' own admin
 * endpoints, and the name of a preselected Organization from `organizations`'.
 * CRM does not proxy them (§4), and naming the endpoint rather than importing
 * that module's client is the sanctioned way for one module's screen to read
 * another's data.
 */

const BASE = '/api/v1/admin/crm';
const ORDERS_BASE = '/api/v1/admin/orders';

export type OpportunitySort = 'createdAt' | 'updatedAt' | 'value' | 'expectedCloseDate' | 'number';

/**
 * The filters the list and the board share (`contracts/admin-api.md` §1, §10).
 *
 * `assignedAdminUserId` and `tagId` are deliberately absent: both endpoints
 * answer 422 for them until their stories land, so a type that cannot carry
 * them is the guard. The story that serves one adds it **here** and to
 * {@link appendSharedFilters}, and both screens can then send it.
 */
export interface OpportunityFilterParams {
  q?: string;
  organizationId?: string;
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

  // --- §10 Board ------------------------------------------------------------

  /** One column per status, with its figures and its first cards. A read; a move is `transition`. */
  getBoard(params: OpportunityBoardParams = {}): Promise<OpportunityBoard> {
    return data(apiClient.get<{ data: OpportunityBoard }>(`${BASE}/board${boardQuery(params)}`));
  },

  // --- Other modules' endpoints, by path --------------------------------------

  /**
   * The name of one Organization, or `null` when it cannot be read — a label
   * for a preselection, never a precondition of the write that follows.
   */
  organizationName(organizationId: string): Promise<string | null> {
    return apiClient
      .get<{ data: { name?: string } }>(`/api/v1/admin/organizations/${organizationId}`)
      .then((envelope) => envelope.data.name ?? null)
      .catch(() => null);
  },

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
