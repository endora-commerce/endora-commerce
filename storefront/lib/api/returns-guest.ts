import {
  RETURNS_GUEST_SESSION_COOKIE,
  RETURNS_TRACKING_TOKEN_HEADER,
  type CreateGuestComplaintRequest,
  type GuestCaseFiled,
  type GuestCaseView,
  type GuestFormConfig,
  type GuestSession,
  type GuestVerificationAccepted,
  type ReturnAttachmentDto,
  type ReturnCaseCommentDto,
  type ReturnUploadDto,
} from '@endora-commerce/contracts';
import { backendBaseUrl } from '../env.mjs';
import { activeChannelHeaders } from './channel-headers';
import { StorefrontApiError, type RequestContext } from './client';
import type { ReturnFileInput } from './returns';

/**
 * The guest complaint API (`specs/181-guest-complaints/` contracts/guest-api.md G1 – G10).
 *
 * Every call is anonymous by construction (research R-4): it carries the request's channel
 * and language, and at most **one** credential —
 *
 * - the guest session, as the allow-listed `Cookie: b2b_returns_guest=…` and nothing else of
 *   the browser's jar, so a customer session the browser also holds never reaches these
 *   routes (the `b2b_cart_anon` precedent, `lib/session.ts`);
 * - or the tracking token, in the `X-Returns-Tracking-Token` header, never in the backend
 *   URL, so the backend's request log never records it (research R-5).
 *
 * The client address is forwarded as `x-forwarded-for`, as `forms` does, for the per-address
 * limits (research R-8). A refusal is thrown as a {@link StorefrontApiError} with its
 * envelope's `details`.
 */

export interface GuestCallOptions {
  readonly ctx?: RequestContext;
  /** The shopper's address, for the backend's per-address limits. */
  readonly forwardedFor?: string | null;
}

interface Credential {
  readonly guestSession?: string | null;
  readonly trackingToken?: string;
}

async function headersFor(credential: Credential, opts: GuestCallOptions): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(await activeChannelHeaders(opts.ctx)) };
  if (opts.ctx?.locale) headers['Accept-Language'] = opts.ctx.locale;
  if (opts.forwardedFor) headers['x-forwarded-for'] = opts.forwardedFor;
  if (credential.guestSession) headers['Cookie'] = `${RETURNS_GUEST_SESSION_COOKIE}=${encodeURIComponent(credential.guestSession)}`;
  if (credential.trackingToken) headers[RETURNS_TRACKING_TOKEN_HEADER] = credential.trackingToken;
  return headers;
}

async function refusal(response: Response): Promise<StorefrontApiError> {
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string; requestId?: string; details?: unknown };
  } | null;
  const err = payload?.error;
  return new StorefrontApiError(response.status, err?.code ?? 'INTERNAL', err?.message ?? `HTTP ${response.status}`, err?.requestId, err?.details);
}

async function call<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  credential: Credential,
  opts: GuestCallOptions,
  body?: unknown,
): Promise<T> {
  const headers = await headersFor(credential, opts);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${backendBaseUrl()}${path}`, {
    method,
    headers,
    cache: 'no-store',
    ...(payload !== undefined ? { body: payload } : {}),
  });
  if (!response.ok) throw await refusal(response);
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as { data: T }).data;
}

function multipart(input: ReturnFileInput & { readonly lineIndex?: number }): FormData {
  const body = new FormData();
  body.append('type', input.type);
  if (input.lineIndex !== undefined) body.append('lineIndex', String(input.lineIndex));
  body.append('file', input.file, input.filename);
  return body;
}

const GUEST = '/api/v1/returns/guest';
const TRACK = '/api/v1/returns/track';

/** G1 — whether *Continue without an account* is offered (FR-010). Off when it cannot be read. */
export async function getGuestAvailability(opts: GuestCallOptions = {}): Promise<boolean> {
  try {
    return (await call<{ enabled: boolean }>('GET', `${GUEST}/availability`, {}, opts)).enabled === true;
  } catch {
    return false;
  }
}

/** G2 — ask for a link. One answer whatever the address (FR-021). */
export function requestGuestVerification(
  input: { email: string; hp?: string; language?: string },
  opts: GuestCallOptions = {},
): Promise<GuestVerificationAccepted> {
  return call('POST', `${GUEST}/verifications`, {}, opts, input);
}

/** G3 — redeem a link; the caller sets the session cookie from `sessionToken`. */
export function redeemGuestLink(token: string, opts: GuestCallOptions = {}): Promise<GuestSession> {
  return call('POST', `${GUEST}/sessions`, {}, opts, { token });
}

/** G4 — end the session (FR-023). */
export async function leaveGuestSession(guestSession: string, opts: GuestCallOptions = {}): Promise<void> {
  await call<void>('DELETE', `${GUEST}/sessions/current`, { guestSession }, opts);
}

/** G5 — 180's no-order form for the session: the verified address, the reasons, the clauses. */
export function getGuestFormConfig(guestSession: string, opts: GuestCallOptions = {}): Promise<GuestFormConfig> {
  return call('GET', `${GUEST}/form-config`, { guestSession }, opts);
}

/** G6 — a pending upload owned by the session. */
export function uploadGuestFile(guestSession: string, input: ReturnFileInput, opts: GuestCallOptions = {}): Promise<ReturnUploadDto> {
  return call('POST', `${GUEST}/uploads`, { guestSession }, opts, multipart(input));
}

/** G7 — file the complaint. */
export function fileGuestComplaint(
  guestSession: string,
  body: CreateGuestComplaintRequest,
  opts: GuestCallOptions = {},
): Promise<GuestCaseFiled> {
  return call('POST', `${GUEST}/cases`, { guestSession }, opts, body);
}

/** G8 — the case a tracking token opens. */
export function getTrackedCase(trackingToken: string, opts: GuestCallOptions = {}): Promise<GuestCaseView> {
  return call('GET', TRACK, { trackingToken }, opts);
}

/** G9 — a comment through the tracking link. */
export function addTrackedComment(trackingToken: string, body: string, opts: GuestCallOptions = {}): Promise<ReturnCaseCommentDto> {
  return call('POST', `${TRACK}/comments`, { trackingToken }, opts, { body });
}

/** G10 — a file through the tracking link; `lineIndex` names the product it shows. */
export function addTrackedAttachment(
  trackingToken: string,
  input: ReturnFileInput & { readonly lineIndex?: number },
  opts: GuestCallOptions = {},
): Promise<ReturnAttachmentDto> {
  return call('POST', `${TRACK}/attachments`, { trackingToken }, opts, multipart(input));
}

/** G10 — a file of the token's case, unread: the caller streams it. */
export async function openTrackedFile(trackingToken: string, attachmentId: string, opts: GuestCallOptions = {}): Promise<Response> {
  return fetch(`${backendBaseUrl()}${TRACK}/attachments/${encodeURIComponent(attachmentId)}/file`, {
    headers: await headersFor({ trackingToken }, opts),
    cache: 'no-store',
  });
}
