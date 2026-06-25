import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Returns / RMA API bindings (feature 046, US1). All endpoints require an
 * authenticated `b2b_session`; ownership is enforced by the backend.
 */

export interface ReturnCaseSummary {
  id: string;
  rmaNumber: string | null;
  kind: 'return' | 'complaint';
  orderId: string;
  statusCode: string;
  statusLabel: string;
  totalRefundAmount: number;
  currency: string;
  submittedAt: string;
}

export interface ReturnCaseItem {
  id: string;
  productName: string;
  quantity: number;
  defaultRefundAmount: number;
  approvedRefundAmount: number;
}

export interface ReturnCaseComment {
  id: string;
  authorKind: 'admin' | 'customer';
  body: string;
  isCustomerVisible: boolean;
  createdAt: string;
}

export interface ReturnCaseDetail extends ReturnCaseSummary {
  resolutionType: 'refund' | 'credit' | 'replacement' | 'repair' | null;
  rejectionReason: string | null;
  freeReturnEligible: boolean;
  items: ReturnCaseItem[];
  comments: ReturnCaseComment[];
}

export interface ReturnableLine {
  orderItemId: string;
  productId: string;
  name: string;
  purchasedQty: number;
  remainingReturnableQty: number;
  paidUnitAmount: number;
  currency: string;
}

export interface ReturnableResponse {
  eligible: boolean;
  reason?: 'order_not_completing' | 'window_passed' | 'fully_returned';
  freeReturnEligible: boolean;
  lines: ReturnableLine[];
}

export interface ReturnReason {
  id: string;
  label: Record<string, string>;
  appliesTo: 'return' | 'complaint' | 'both';
  isActive: boolean;
  weight: number;
}

export interface CreateReturnCaseInput {
  orderId: string;
  kind: 'return' | 'complaint';
  lines: Array<{ orderItemId: string; quantity: number; reasonId: string; description?: string }>;
  comment?: string;
}

export async function listMyReturns(sessionCookie: string): Promise<ReturnCaseSummary[]> {
  return apiGetAuthed<ReturnCaseSummary[]>({ path: '/api/v1/returns', sessionCookie });
}

export async function getMyReturn(sessionCookie: string, id: string): Promise<ReturnCaseDetail> {
  return apiGetAuthed<ReturnCaseDetail>({ path: `/api/v1/returns/${id}`, sessionCookie });
}

export async function getReturnable(sessionCookie: string, orderId: string): Promise<ReturnableResponse> {
  return apiGetAuthed<ReturnableResponse>({ path: `/api/v1/orders/${orderId}/returnable`, sessionCookie });
}

export async function listReturnReasons(
  sessionCookie: string,
  kind?: 'return' | 'complaint',
): Promise<ReturnReason[]> {
  const qs = kind ? `?kind=${kind}` : '';
  return apiGetAuthed<ReturnReason[]>({ path: `/api/v1/returns/reasons${qs}`, sessionCookie });
}

export async function createReturnCase(
  sessionCookie: string,
  input: CreateReturnCaseInput,
): Promise<ReturnCaseDetail> {
  const result = await apiMutate<ReturnCaseDetail>({
    method: 'POST',
    path: '/api/v1/returns',
    body: input,
    sessionCookie,
  });
  return result.data!;
}

export async function addReturnComment(
  sessionCookie: string,
  id: string,
  body: string,
): Promise<ReturnCaseComment> {
  const result = await apiMutate<ReturnCaseComment>({
    method: 'POST',
    path: `/api/v1/returns/${id}/comments`,
    body: { body },
    sessionCookie,
  });
  return result.data!;
}
