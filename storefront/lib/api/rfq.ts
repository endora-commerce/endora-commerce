import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Storefront RFQ bindings (T086, T087, T088 / FR-016 .. FR-026).
 *
 * The backend keeps a single "current" draft per (customer, organization);
 * additions go to /quote-requests/current/items and submission flips the
 * draft into a real, immutable RFQ. After the supplier quotes, the buyer
 * accepts (which converts to an Order) or rejects (with a reason).
 */

export type RfqStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'quoted'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface RfqItem {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  requesterNote: string | null;
  quotedUnitPrice: number | null;
  quotedDiscountPercent: number | null;
}

export interface RfqQuoteTerms {
  leadTimeDays: number;
  validityDays: number;
  deliveryTerms: string | null;
  remarks: string | null;
}

export interface RfqSummary {
  id: string;
  organizationId: string;
  customerAccountId: string;
  assignedAdminUserId?: string;
  status: RfqStatus;
  requesterNote: string | null;
  items: RfqItem[];
  quoteTerms: RfqQuoteTerms | null;
  submittedAt: string | null;
  quotedAt: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export async function getCurrentRfq(sessionCookie: string): Promise<RfqSummary> {
  return apiGetAuthed<RfqSummary>({
    path: '/api/v1/quote-requests/current',
    sessionCookie,
  });
}

export async function listRfqs(sessionCookie: string): Promise<RfqSummary[]> {
  return apiGetAuthed<RfqSummary[]>({
    path: '/api/v1/quote-requests',
    sessionCookie,
  });
}

export async function getRfqById(sessionCookie: string, id: string): Promise<RfqSummary> {
  return apiGetAuthed<RfqSummary>({
    path: `/api/v1/quote-requests/${id}`,
    sessionCookie,
  });
}

export async function addRfqItem(
  sessionCookie: string,
  payload: { productId: string; variantId?: string; quantity: number; requesterNote?: string },
): Promise<RfqSummary> {
  const result = await apiMutate<RfqSummary>({
    method: 'POST',
    path: '/api/v1/quote-requests/current/items',
    body: payload,
    sessionCookie,
  });
  return result.data!;
}

export async function updateRfqItem(
  sessionCookie: string,
  itemId: string,
  payload: { quantity?: number; requesterNote?: string | null },
): Promise<RfqSummary> {
  const result = await apiMutate<RfqSummary>({
    method: 'PATCH',
    path: `/api/v1/quote-requests/current/items/${itemId}`,
    body: payload,
    sessionCookie,
  });
  return result.data!;
}

export async function removeRfqItem(
  sessionCookie: string,
  itemId: string,
): Promise<RfqSummary> {
  const result = await apiMutate<RfqSummary>({
    method: 'DELETE',
    path: `/api/v1/quote-requests/current/items/${itemId}`,
    sessionCookie,
  });
  return result.data!;
}

export async function submitRfq(
  sessionCookie: string,
  payload?: { requesterNote?: string },
): Promise<RfqSummary> {
  const result = await apiMutate<RfqSummary>({
    method: 'POST',
    path: '/api/v1/quote-requests/current/submit',
    body: payload ?? {},
    sessionCookie,
  });
  return result.data!;
}

export async function acceptRfq(
  sessionCookie: string,
  id: string,
  payload?: { notes?: string },
): Promise<RfqSummary> {
  const result = await apiMutate<RfqSummary>({
    method: 'POST',
    path: `/api/v1/quote-requests/${id}/accept`,
    body: payload ?? {},
    sessionCookie,
  });
  return result.data!;
}

export async function rejectRfq(
  sessionCookie: string,
  id: string,
  payload: { reason: 'price' | 'terms' | 'other'; message?: string; requestChanges?: boolean },
): Promise<RfqSummary> {
  const result = await apiMutate<RfqSummary>({
    method: 'POST',
    path: `/api/v1/quote-requests/${id}/reject`,
    body: payload,
    sessionCookie,
  });
  return result.data!;
}
