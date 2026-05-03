import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Storefront Quote Requests bindings — feature 008 workflow.
 *
 * The backend exposes seven customer endpoints under
 * `/api/v1/quote-requests/*`:
 *   - GET   /                            list summaries
 *   - GET   /:id                         full detail (with optional comparison block)
 *   - POST  /                             create + submit (one-shot)
 *   - PATCH /:id                          customer-side draft edit
 *   - POST  /:id/accept-revision         accept a sales-rep revision
 *   - POST  /:id/reject-revision         reject a revision
 *   - POST  /:id/resubmit                clone into a new Pending RFQ
 */

export type RfqStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

export interface RfqItem {
  id: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  desiredUnitPrice: number | null;
  agreedUnitPrice: number | null;
  lineNote: string | null;
  lineCurrency: string;
  discountPercent: number | null;
}

export interface RfqEvent {
  id: string;
  eventType: string;
  actorAdminUserId: string | null;
  actorCustomerAccountId: string | null;
  actorRoleLabel: string | null;
  payload: Record<string, unknown>;
  revisionId: string | null;
  createdAt: string;
}

export type RfqDiffEntry =
  | { kind: 'header_note'; before: string | null; after: string | null }
  | {
      kind: 'line_added';
      productId: string;
      productName: string;
      quantity: number;
      agreedUnitPrice: number | null;
    }
  | { kind: 'line_removed'; productId: string; productName: string }
  | {
      kind: 'line_quantity';
      productId: string;
      productName: string;
      before: number;
      after: number;
    }
  | {
      kind: 'line_agreed_unit_price';
      productId: string;
      productName: string;
      before: number | null;
      after: number | null;
    };

export interface RfqComparison {
  diff: RfqDiffEntry[];
  lastSeenRevisionNumber: number;
  currentRevisionNumber: number;
}

export interface RfqDetail {
  id: string;
  organizationId: string;
  customerAccountId: string;
  createdByAdminUserId: string | null;
  assignedAdminUserId: string | null;
  status: RfqStatus;
  awaitingCustomerRevisionAcceptance: boolean;
  currentRevisionNumber: number;
  lastCustomerSeenRevisionNumber: number;
  headerNote: string | null;
  cancellationReason: string | null;
  items: RfqItem[];
  events: RfqEvent[];
  comparisonAgainstLastSeen: RfqComparison | null;
  submittedAt: string | null;
  approvedAt: string | null;
  canceledAt: string | null;
  completedAt: string | null;
  expiredAt: string | null;
  expiresAt: string | null;
  convertedOrderId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RfqSummary {
  id: string;
  organizationId: string;
  customerAccountId: string;
  status: RfqStatus;
  awaitingCustomerRevisionAcceptance: boolean;
  lineCount: number;
  totalAtCustomerPrice: number | null;
  totalAtAgreedPrice: number | null;
  currency: string;
  submittedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  originalRequester?: { customerAccountId: string; displayName: string | null };
}

export interface CreateRfqLine {
  productId: string;
  variantId?: string;
  quantity: number;
  desiredUnitPrice?: number;
  lineNote?: string;
}

export async function listRfqs(sessionCookie: string): Promise<RfqSummary[]> {
  return apiGetAuthed<RfqSummary[]>({
    path: '/api/v1/quote-requests',
    sessionCookie,
  });
}

export async function getRfqById(sessionCookie: string, id: string): Promise<RfqDetail> {
  return apiGetAuthed<RfqDetail>({
    path: `/api/v1/quote-requests/${id}`,
    sessionCookie,
  });
}

export async function createRfq(
  sessionCookie: string,
  body: { headerNote?: string; items: CreateRfqLine[] },
): Promise<RfqDetail> {
  const result = await apiMutate<RfqDetail>({
    method: 'POST',
    path: '/api/v1/quote-requests',
    body,
    sessionCookie,
  });
  return result.data!;
}

export async function patchRfqDraft(
  sessionCookie: string,
  id: string,
  body: { headerNote?: string | null; items?: CreateRfqLine[] },
  expectedVersion: number,
): Promise<RfqDetail> {
  const result = await apiMutate<RfqDetail>({
    method: 'PATCH',
    path: `/api/v1/quote-requests/${id}`,
    body,
    sessionCookie,
    headers: { 'if-match': `"${expectedVersion}"` },
  });
  return result.data!;
}

export async function acceptRevision(
  sessionCookie: string,
  id: string,
  expectedRevisionNumber: number,
): Promise<RfqDetail> {
  const result = await apiMutate<RfqDetail>({
    method: 'POST',
    path: `/api/v1/quote-requests/${id}/accept-revision`,
    body: { expectedRevisionNumber },
    sessionCookie,
  });
  return result.data!;
}

export async function rejectRevision(
  sessionCookie: string,
  id: string,
  expectedRevisionNumber: number,
  reason?: string,
): Promise<RfqDetail> {
  const body: Record<string, unknown> = { expectedRevisionNumber };
  if (reason) body.reason = reason;
  const result = await apiMutate<RfqDetail>({
    method: 'POST',
    path: `/api/v1/quote-requests/${id}/reject-revision`,
    body,
    sessionCookie,
  });
  return result.data!;
}

export async function resubmitRfq(
  sessionCookie: string,
  id: string,
  headerNote?: string,
): Promise<RfqDetail> {
  const body = headerNote ? { headerNote } : {};
  const result = await apiMutate<RfqDetail>({
    method: 'POST',
    path: `/api/v1/quote-requests/${id}/resubmit`,
    body,
    sessionCookie,
  });
  return result.data!;
}
