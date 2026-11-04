import type { ReturnableResponse as ContractReturnableResponse } from '@endora-commerce/contracts';
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
  /**
   * The member who filed the case (feature 170, `contracts/storefront-api.md` §5). A holder of
   * `returns.view_organization` lists colleagues' cases too; their follow-up actions stay the
   * filer's (FR-053, Q-R2 = A).
   */
  customerAccountId: string;
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

/**
 * `GET /api/v1/orders/:orderId/returnable` — derived from the contract rather than copied, so
 * the reason union and the line fields cannot drift from it (feature 155 adds
 * `no_returnable_lines` and the per-line returnability, which a hand-written copy lacked).
 *
 * Feature 155 (`contracts/returns-api.md` §2): each line says whether it may be included in a
 * `return` case (`returnable`, with `notReturnableReason` when not); complaints are never
 * restricted. `eligible: false` now means "no `return`-kind case" — with
 * `reason: 'no_returnable_lines'` a complaint is still accepted, so a caller branches on
 * `reason`, never on `eligible` alone.
 */
export type ReturnableResponse = ContractReturnableResponse;
export type ReturnableLine = ReturnableResponse['lines'][number];

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
