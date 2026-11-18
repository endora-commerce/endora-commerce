import type {
  CreateReturnCaseRequest,
  ReturnAttachmentDto,
  ReturnCaseDetail as ContractReturnCaseDetail,
  ReturnFormConfig,
  ReturnUploadDto,
  ReturnableResponse as ContractReturnableResponse,
  ShownClause,
} from '@endora-commerce/contracts';
import { backendBaseUrl } from '../env.mjs';
import type { RequestContext } from './client';
import { StorefrontApiError } from './client';
import { activeChannelHeaders } from './channel-headers';
import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Returns / RMA API bindings (feature 046, US1). All endpoints require an
 * authenticated `b2b_session`; ownership is enforced by the backend.
 */

export interface ReturnCaseSummary {
  id: string;
  rmaNumber: string | null;
  kind: 'return' | 'complaint';
  /** `null` for a complaint about a product bought elsewhere (`specs/180-off-platform-complaints/`). */
  orderId: string | null;
  /** The RMA number, else `#` and the first eight characters of the id (180 FR-A44). */
  reference: string;
  offPlatform: boolean;
  /** The first line's product name; the list adds "+N more" from `lineCount` (180 D-3). */
  productLabel: string;
  lineCount: number;
  purchaseDate: string | null;
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
  productId?: string | null;
  productName: string;
  description?: string | null;
  serialNumber?: string | null;
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
  resolutionType: 'refund' | 'credit' | 'replacement' | 'repair' | 'settled_outside' | null;
  rejectionReason: string | null;
  freeReturnEligible: boolean;
  items: ReturnCaseItem[];
  comments: ReturnCaseComment[];
  /**
   * Issue #876 — what the case refunds of the order's delivery and payment surcharge: a
   * consumer's withdrawal from the whole order refunds both. Absent from an older backend.
   */
  chargeRefunds?: ContractReturnCaseDetail['chargeRefunds'];
  // `specs/180-off-platform-complaints/` phase B.
  purchase?: ContractReturnCaseDetail['purchase'];
  contact?: ContractReturnCaseDetail['contact'];
  returnAddress?: ContractReturnCaseDetail['returnAddress'];
  attachments?: ReturnAttachmentDto[];
  acceptedClauses?: ShownClause[];
  clausesAcceptedAt?: string | null;
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

/** `POST /api/v1/returns` — a case against an order, or a complaint without one (180 §C3). */
export type CreateReturnCaseInput = CreateReturnCaseRequest;

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
  ctx?: RequestContext,
): Promise<ReturnCaseDetail> {
  const result = await apiMutate<ReturnCaseDetail>({
    method: 'POST',
    path: '/api/v1/returns',
    body: input,
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
  return result.data!;
}

/** `GET /api/v1/returns/form-config` — what the form needs for the request's channel (180 §C1). */
export async function getReturnFormConfig(
  sessionCookie: string,
  query: { kind?: 'return' | 'complaint'; orderId?: string } = {},
): Promise<ReturnFormConfig> {
  const qs = new URLSearchParams();
  if (query.kind) qs.set('kind', query.kind);
  if (query.orderId) qs.set('orderId', query.orderId);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  return apiGetAuthed<ReturnFormConfig>({ path: `/api/v1/returns/form-config${suffix}`, sessionCookie });
}

/** One file as a route handler read it from the customer's post. */
export interface ReturnFileInput {
  readonly file: Blob;
  readonly filename: string;
  readonly type: 'photo' | 'proof_of_purchase' | 'other';
  /** The case line a file added later shows (180 §C4); absent for the whole case. */
  readonly returnCaseItemId?: string;
}

/** A multipart post to the backend with the customer's session, the channel and the language. */
async function postFile<T>(path: string, sessionCookie: string, input: ReturnFileInput, ctx?: RequestContext): Promise<T> {
  const body = new FormData();
  body.append('type', input.type);
  if (input.returnCaseItemId) body.append('returnCaseItemId', input.returnCaseItemId);
  body.append('file', input.file, input.filename);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Cookie: `b2b_session=${sessionCookie}`,
    ...(await activeChannelHeaders(ctx)),
  };
  if (ctx?.locale) headers['Accept-Language'] = ctx.locale;
  const response = await fetch(`${backendBaseUrl()}${path}`, { method: 'POST', headers, body, cache: 'no-store' });
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string; requestId?: string; details?: Record<string, unknown> } }
    | null;
  if (!response.ok) {
    const err = payload?.error;
    throw new StorefrontApiError(response.status, err?.code ?? 'INTERNAL', err?.message ?? `HTTP ${response.status}`, err?.requestId, err?.details);
  }
  return payload!.data as T;
}

/** `POST /api/v1/returns/uploads` — a pending upload the filing claims (180 §C2). */
export function uploadReturnFile(sessionCookie: string, input: ReturnFileInput, ctx?: RequestContext): Promise<ReturnUploadDto> {
  return postFile<ReturnUploadDto>('/api/v1/returns/uploads', sessionCookie, input, ctx);
}

/** `POST /api/v1/returns/:id/attachments` — a file added to an open case (180 §C4). */
export function addReturnAttachment(
  sessionCookie: string,
  id: string,
  input: ReturnFileInput,
  ctx?: RequestContext,
): Promise<ReturnAttachmentDto> {
  return postFile<ReturnAttachmentDto>(`/api/v1/returns/${id}/attachments`, sessionCookie, input, ctx);
}

/** `GET /api/v1/returns/:id/attachments/:attachmentId/file`, unread — the caller streams it (180 §C5). */
export async function openReturnAttachment(
  sessionCookie: string,
  id: string,
  attachmentId: string,
  ctx?: RequestContext,
): Promise<Response> {
  const headers: Record<string, string> = { Cookie: `b2b_session=${sessionCookie}`, ...(await activeChannelHeaders(ctx)) };
  return fetch(`${backendBaseUrl()}/api/v1/returns/${id}/attachments/${attachmentId}/file`, { headers, cache: 'no-store' });
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
